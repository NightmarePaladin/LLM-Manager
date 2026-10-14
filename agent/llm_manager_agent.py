#!/usr/bin/env python3
"""LLM-Manager monitoring agent.

Collects CPU, RAM, disk and network readings with psutil and POSTs them to the
LLM-Manager ingestion endpoint every 30 seconds. Unavailable metrics are sent as
null, never as zero. The agent only holds its own per-server token: it has no
Supabase credentials. Works on standard Linux, Proxmox VE hosts, VMs and LXC
containers without root.

Configuration (environment variables, usually from a systemd EnvironmentFile):
  LLM_MANAGER_API_URL    https://<your-domain>/api/telemetry   (required to send)
  LLM_MANAGER_TOKEN      agent token from the server's page     (required to send)
  LLM_MANAGER_SERVER_ID  server UUID from the server's page     (required to send)
  LLM_MANAGER_INTERVAL   seconds between reports (default 30)
  LLM_MANAGER_DISK_PATH  mount point to report (default /)
  LLM_MANAGER_OLLAMA_URL Ollama API base, e.g. http://127.0.0.1:11434 (default: Ollama monitoring off)

Usage:
  llm_manager_agent.py --dry-run     print one reading, send nothing
  llm_manager_agent.py --once        send one reading and exit
  llm_manager_agent.py               run forever
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

import psutil

AGENT_VERSION = "0.2.0"
DEFAULT_INTERVAL = 30.0
REQUEST_TIMEOUT = 10.0
WARMUP_SECONDS = 3.0
# Used only when no physical NIC is found (e.g. inside an LXC container).
VIRTUAL_NIC_PREFIXES = ("lo", "docker", "br-", "virbr", "veth", "tap", "fwbr", "fwpr", "fwln", "vmbr", "bond")

log = logging.getLogger("llm-manager-agent")


def _pct(value):
    return None if value is None else round(float(value), 1)


def _nic_names() -> list[str]:
    """NICs whose traffic should be summed, avoiding double counting.

    On Proxmox hosts a physical NIC, its bridge (vmbr0) and every guest's
    tap/veth all see the same packets. Physical NICs have /sys/class/net/<n>/device;
    if none exist (LXC containers only see a veth), fall back to a prefix filter.
    """
    names = list(psutil.net_io_counters(pernic=True).keys())
    physical = [n for n in names if os.path.exists(f"/sys/class/net/{n}/device")]
    if physical:
        return physical
    return [n for n in names if not n.startswith(VIRTUAL_NIC_PREFIXES)]


class NetworkRate:
    """Turns cumulative byte counters into bytes/second between samples."""

    def __init__(self) -> None:
        self._last: tuple[float, int, int] | None = None

    def sample(self) -> tuple[float | None, float | None]:
        try:
            per_nic = psutil.net_io_counters(pernic=True)
            names = [n for n in _nic_names() if n in per_nic]
            if not names:
                self._last = None
                return None, None
            rx = sum(per_nic[n].bytes_recv for n in names)
            tx = sum(per_nic[n].bytes_sent for n in names)
        except Exception as exc:  # noqa: BLE001 - sensor failure must not stop the agent
            log.warning("network counters unavailable: %s", exc)
            self._last = None
            return None, None

        now = time.monotonic()
        previous, self._last = self._last, (now, rx, tx)
        if previous is None:
            return None, None  # first sample has no baseline
        elapsed = now - previous[0]
        d_rx, d_tx = rx - previous[1], tx - previous[2]
        if elapsed <= 0 or d_rx < 0 or d_tx < 0:  # counter reset or wrap
            return None, None
        return round(d_rx / elapsed, 1), round(d_tx / elapsed, 1)


def _get_json(url: str, timeout: float = 3.0):
    req = urllib.request.Request(url, headers={"User-Agent": f"llm-manager-agent/{AGENT_VERSION}"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if resp.status != 200:
            raise ValueError(f"HTTP {resp.status}")
        return json.load(resp)


def _text(value, limit: int):
    return value[:limit] if isinstance(value, str) and value else None


def _int(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def collect_ollama(base_url: str) -> dict:
    """Ollama status and currently loaded models.

    ollama_up is True/False when Ollama monitoring is configured (False means the
    API did not answer). Models are None when unavailable, [] when nothing is
    loaded. Everything is None when monitoring is not configured.
    """
    if not base_url:
        return {"ollama_up": None, "ollama_version": None, "ollama_models": None}
    base = base_url.rstrip("/")
    try:
        version = _get_json(f"{base}/api/version").get("version")
    except Exception as exc:  # noqa: BLE001 - refused, timeout, bad JSON: service not answering
        log.debug("ollama not answering: %s", exc)
        return {"ollama_up": False, "ollama_version": None, "ollama_models": None}

    models = None
    try:
        raw = _get_json(f"{base}/api/ps").get("models") or []
        models = []
        for m in raw[:20]:
            details = m.get("details") or {}
            models.append(
                {
                    "name": _text(m.get("name") or m.get("model"), 100) or "unknown",
                    "size_bytes": _int(m.get("size")),
                    "size_vram_bytes": _int(m.get("size_vram")),
                    "parameter_size": _text(details.get("parameter_size"), 32),
                    "quantization": _text(details.get("quantization_level"), 32),
                    "expires_at": _text(m.get("expires_at"), 64),
                }
            )
    except Exception as exc:  # noqa: BLE001
        log.warning("ollama model list unavailable: %s", exc)
    return {"ollama_up": True, "ollama_version": _text(version, 32), "ollama_models": models}


def collect(net: NetworkRate, disk_path: str, cpu_interval: float | None = None, ollama_url: str = "") -> dict:
    """Gather one reading. Each metric fails independently to None."""
    metrics: dict = {"agent_version": AGENT_VERSION}

    try:
        metrics["cpu_percent"] = _pct(psutil.cpu_percent(interval=cpu_interval))
    except Exception as exc:  # noqa: BLE001
        log.warning("cpu unavailable: %s", exc)
        metrics["cpu_percent"] = None

    try:
        vm = psutil.virtual_memory()
        metrics.update(ram_percent=_pct(vm.percent), ram_used_bytes=int(vm.total - vm.available), ram_total_bytes=int(vm.total))
    except Exception as exc:  # noqa: BLE001
        log.warning("ram unavailable: %s", exc)
        metrics.update(ram_percent=None, ram_used_bytes=None, ram_total_bytes=None)

    try:
        du = psutil.disk_usage(disk_path)
        metrics.update(disk_percent=_pct(du.percent), disk_used_bytes=int(du.used), disk_total_bytes=int(du.total))
    except Exception as exc:  # noqa: BLE001
        log.warning("disk %s unavailable: %s", disk_path, exc)
        metrics.update(disk_percent=None, disk_used_bytes=None, disk_total_bytes=None)

    rx, tx = net.sample()
    metrics.update(net_rx_bps=rx, net_tx_bps=tx)

    try:
        metrics["uptime_seconds"] = max(0, int(time.time() - psutil.boot_time()))
    except Exception:  # noqa: BLE001
        metrics["uptime_seconds"] = None

    metrics.update(collect_ollama(ollama_url))
    return metrics


def validate_url(url: str) -> str:
    """Require HTTPS (plain HTTP only for localhost development)."""
    parsed = urllib.parse.urlparse(url)
    local = parsed.hostname in ("localhost", "127.0.0.1", "::1")
    if parsed.scheme == "https" or (parsed.scheme == "http" and local):
        return url
    raise ValueError("LLM_MANAGER_API_URL must use https:// (http:// is allowed only for localhost)")


PLACEHOLDERS = ("your-production-domain", "paste_token_here", "00000000-0000-0000-0000-000000000000")


def check_not_placeholder(cfg: dict) -> None:
    """Refuse to send credentials anywhere if the example config was not edited."""
    for key in ("url", "token", "server_id"):
        if any(p in cfg[key] for p in PLACEHOLDERS):
            raise ValueError(f"{key} still contains the example placeholder; edit /etc/llm-manager-agent.env")


def send(url: str, token: str, server_id: str, metrics: dict) -> tuple[bool, str]:
    """POST one reading. Returns (ok, message). Never includes the token."""
    body = json.dumps({"server_id": server_id, "metrics": metrics}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": f"llm-manager-agent/{AGENT_VERSION}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            return 200 <= resp.status < 300, f"HTTP {resp.status}"
    except urllib.error.HTTPError as exc:
        hint = {401: " (token or server id rejected)", 429: " (reporting too fast)"}.get(exc.code, "")
        return False, f"HTTP {exc.code}{hint}"
    except Exception as exc:  # noqa: BLE001 - DNS, TLS, timeout, connection refused
        return False, f"{type(exc).__name__}: {exc}"


def load_config() -> dict:
    cfg = {
        "url": os.environ.get("LLM_MANAGER_API_URL", ""),
        "token": os.environ.get("LLM_MANAGER_TOKEN", ""),
        "server_id": os.environ.get("LLM_MANAGER_SERVER_ID", ""),
        "interval": os.environ.get("LLM_MANAGER_INTERVAL", str(DEFAULT_INTERVAL)),
        "disk_path": os.environ.get("LLM_MANAGER_DISK_PATH", "/"),
        "ollama_url": os.environ.get("LLM_MANAGER_OLLAMA_URL", "").strip(),
    }
    try:
        cfg["interval"] = max(10.0, float(cfg["interval"]))  # server rate-limits below 5 s
    except ValueError:
        raise ValueError("LLM_MANAGER_INTERVAL must be a number of seconds") from None
    return cfg


def main() -> int:
    parser = argparse.ArgumentParser(description="LLM-Manager monitoring agent")
    parser.add_argument("--dry-run", action="store_true", help="print one reading and exit without sending")
    parser.add_argument("--once", action="store_true", help="send one reading and exit")
    parser.add_argument("-v", "--verbose", action="store_true", help="log every successful report")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)

    try:
        cfg = load_config()
    except ValueError as exc:
        log.error("%s", exc)
        return 2

    net = NetworkRate()
    psutil.cpu_percent(interval=None)  # prime: the first call has no baseline
    net.sample()

    if args.dry_run:
        time.sleep(WARMUP_SECONDS)  # gives CPU and network a real measurement window
        print(json.dumps({"server_id": cfg["server_id"] or "<unset>", "metrics": collect(net, cfg["disk_path"], ollama_url=cfg["ollama_url"])}, indent=2))
        return 0

    missing = [n for n, k in (("LLM_MANAGER_API_URL", "url"), ("LLM_MANAGER_TOKEN", "token"), ("LLM_MANAGER_SERVER_ID", "server_id")) if not cfg[k]]
    if missing:
        log.error("missing configuration: %s", ", ".join(missing))
        return 2
    try:
        validate_url(cfg["url"])
        check_not_placeholder(cfg)
        uuid.UUID(cfg["server_id"])
        if cfg["ollama_url"] and urllib.parse.urlparse(cfg["ollama_url"]).scheme not in ("http", "https"):
            raise ValueError("LLM_MANAGER_OLLAMA_URL must start with http:// or https://")
    except ValueError as exc:
        log.error("invalid configuration: %s", exc)
        return 2

    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())

    log.info("agent %s started: reporting every %gs to %s", AGENT_VERSION, cfg["interval"], urllib.parse.urlparse(cfg["url"]).netloc)
    failing = False

    def report() -> bool:
        nonlocal failing
        ok, message = send(cfg["url"], cfg["token"], cfg["server_id"], collect(net, cfg["disk_path"], ollama_url=cfg["ollama_url"]))
        if ok:
            if failing or args.verbose:
                log.info("report sent (%s)", message)
            failing = False
        elif not failing or args.once:
            log.warning("report failed: %s (will keep retrying every %gs)", message, cfg["interval"])
            failing = True
        return ok

    if args.once:
        time.sleep(WARMUP_SECONDS)
        return 0 if report() else 1

    # Short warm-up so the first CPU/network reading has a real measurement window.
    next_run = time.monotonic() + WARMUP_SECONDS
    while not stop.wait(max(0.0, next_run - time.monotonic())):
        report()
        next_run += cfg["interval"]
        if next_run < time.monotonic():  # fell behind (suspend, long outage)
            next_run = time.monotonic() + cfg["interval"]

    log.info("agent stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())

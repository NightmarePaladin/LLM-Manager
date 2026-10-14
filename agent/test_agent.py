"""Tests for the monitoring agent's Ollama collection. Run: python -m unittest agent/test_agent.py"""

import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest import mock
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import llm_manager_agent as agent  # noqa: E402

PS_RESPONSE = {
    "models": [
        {
            "name": "llama3:8b",
            "model": "llama3:8b",
            "size": 6_000_000_000,
            "size_vram": 5_500_000_000,
            "expires_at": "2026-10-14T12:00:00Z",
            "details": {"parameter_size": "8.0B", "quantization_level": "Q4_0", "family": "llama"},
        },
        {"name": "tiny", "size": 100, "size_vram": 0, "details": {}},
    ]
}


def stop(server):
    server.shutdown()
    server.server_close()


def serve(routes):
    """routes: path -> (status, body). Returns (server, base_url)."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            status, body = routes.get(self.path, (404, {}))
            payload = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_port}"


class OllamaCollection(unittest.TestCase):
    def test_not_configured_reports_everything_unavailable(self):
        self.assertEqual(agent.collect_ollama(""), {"ollama_up": None, "ollama_version": None, "ollama_models": None})

    def test_running_with_loaded_models(self):
        server, url = serve({"/api/version": (200, {"version": "0.12.3"}), "/api/ps": (200, PS_RESPONSE)})
        self.addCleanup(stop, server)
        out = agent.collect_ollama(url)
        self.assertIs(out["ollama_up"], True)
        self.assertEqual(out["ollama_version"], "0.12.3")
        self.assertEqual(len(out["ollama_models"]), 2)
        first = out["ollama_models"][0]
        self.assertEqual(first["name"], "llama3:8b")
        self.assertEqual(first["size_bytes"], 6_000_000_000)
        self.assertEqual(first["size_vram_bytes"], 5_500_000_000)
        self.assertEqual(first["parameter_size"], "8.0B")
        self.assertEqual(first["quantization"], "Q4_0")
        self.assertEqual(out["ollama_models"][1]["size_vram_bytes"], 0)  # a real zero is kept
        self.assertIsNone(out["ollama_models"][1]["parameter_size"])  # missing is None

    def test_running_with_nothing_loaded_is_an_empty_list_not_none(self):
        server, url = serve({"/api/version": (200, {"version": "0.12.3"}), "/api/ps": (200, {"models": []})})
        self.addCleanup(stop, server)
        out = agent.collect_ollama(url)
        self.assertIs(out["ollama_up"], True)
        self.assertEqual(out["ollama_models"], [])

    def test_unreachable_is_down(self):
        out = agent.collect_ollama("http://127.0.0.1:1")
        self.assertEqual(out, {"ollama_up": False, "ollama_version": None, "ollama_models": None})

    def test_bad_version_response_is_down(self):
        server, url = serve({"/api/version": (500, {})})
        self.addCleanup(stop, server)
        self.assertIs(agent.collect_ollama(url)["ollama_up"], False)

    def test_model_list_failure_keeps_up_but_models_unavailable(self):
        server, url = serve({"/api/version": (200, {"version": "0.12.3"}), "/api/ps": (200, b"not json")})
        self.addCleanup(stop, server)
        out = agent.collect_ollama(url)
        self.assertIs(out["ollama_up"], True)
        self.assertIsNone(out["ollama_models"])

    def test_limits_and_sanitises(self):
        many = {"models": [{"name": "m" * 500, "size": -5, "size_vram": "big", "details": {}}] * 30}
        server, url = serve({"/api/version": (200, {"version": "v" * 100}), "/api/ps": (200, many)})
        self.addCleanup(stop, server)
        out = agent.collect_ollama(url + "/")  # trailing slash tolerated
        self.assertEqual(len(out["ollama_models"]), 20)
        self.assertEqual(len(out["ollama_models"][0]["name"]), 100)
        self.assertEqual(len(out["ollama_version"]), 32)
        self.assertIsNone(out["ollama_models"][0]["size_bytes"])
        self.assertIsNone(out["ollama_models"][0]["size_vram_bytes"])


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def make_card(root, name, vendor, vram_total=None, vram_used=None, busy=None, temps=None):
    dev = os.path.join(root, "class", "drm", name, "device")
    write(os.path.join(dev, "vendor"), vendor + "\n")
    if vram_total is not None:
        write(os.path.join(dev, "mem_info_vram_total"), f"{vram_total}\n")
    if vram_used is not None:
        write(os.path.join(dev, "mem_info_vram_used"), f"{vram_used}\n")
    if busy is not None:
        write(os.path.join(dev, "gpu_busy_percent"), f"{busy}\n")
    for i, (label, milli) in enumerate((temps or {}).items(), start=1):
        hw = os.path.join(dev, "hwmon", "hwmon3")
        write(os.path.join(hw, f"temp{i}_input"), f"{milli}\n")
        if label:
            write(os.path.join(hw, f"temp{i}_label"), label + "\n")


class GpuCollection(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_reads_amd_dgpu_utilisation_vram_and_temps(self):
        make_card(self.root, "card1", "0x1002", 17_163_091_968, 4_000_000_000, 37,
                  {"edge": 52000, "junction": 61000, "mem": 70000})
        out = agent.collect_gpu(self.root)
        self.assertEqual(out["gpu_percent"], 37.0)
        self.assertEqual(out["vram_total_bytes"], 17_163_091_968)
        self.assertEqual(out["vram_used_bytes"], 4_000_000_000)
        self.assertEqual(out["gpu_temp_c"], 52.0)
        self.assertEqual(out["gpu_hotspot_c"], 61.0)

    def test_idle_gpu_zero_percent_is_a_real_zero(self):
        make_card(self.root, "card1", "0x1002", 1000, 0, 0, {"edge": 40000})
        out = agent.collect_gpu(self.root)
        self.assertEqual(out["gpu_percent"], 0.0)
        self.assertEqual(out["vram_used_bytes"], 0)

    def test_prefers_the_gpu_with_the_most_vram_over_an_igpu(self):
        make_card(self.root, "card0", "0x1002", 536_870_912, 100, 5, {"edge": 45000})  # iGPU
        make_card(self.root, "card1", "0x1002", 17_163_091_968, 200, 60, {"edge": 55000})
        out = agent.collect_gpu(self.root)
        self.assertEqual(out["vram_total_bytes"], 17_163_091_968)
        self.assertEqual(out["gpu_percent"], 60.0)

    def test_ignores_non_amd_cards_and_connector_entries(self):
        make_card(self.root, "card0", "0x10de", 8_000_000_000, 1, 50, {"edge": 50000})  # NVIDIA
        make_card(self.root, "card0-DP-1", "0x1002", 99, 1, 50)  # connector, not a card
        out = agent.collect_gpu(self.root)
        self.assertTrue(all(v is None for v in out.values()))

    def test_missing_sysfs_or_files_are_none_not_zero(self):
        self.assertTrue(all(v is None for v in agent.collect_gpu(os.path.join(self.root, "nope")).values()))
        make_card(self.root, "card1", "0x1002")  # AMD card exposing nothing
        out = agent.collect_gpu(self.root)
        self.assertTrue(all(v is None for v in out.values()))

    def test_unlabelled_temperature_falls_back_to_first_and_rejects_nonsense(self):
        make_card(self.root, "card1", "0x1002", 1000, 1, 1, {"": 48000})
        self.assertEqual(agent.collect_gpu(self.root)["gpu_temp_c"], 48.0)
        bad = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, bad, True)
        make_card(bad, "card1", "0x1002", 1000, 1, 1, {"edge": 999000, "junction": -300000})
        out = agent.collect_gpu(bad)
        self.assertIsNone(out["gpu_temp_c"])
        self.assertIsNone(out["gpu_hotspot_c"])

    def test_out_of_range_values_are_unavailable(self):
        make_card(self.root, "card1", "0x1002", 1000, 5000, 250, {})  # used > total, busy > 100
        out = agent.collect_gpu(self.root)
        self.assertIsNone(out["gpu_percent"])
        self.assertIsNone(out["vram_used_bytes"])


def sensors(**chips):
    return {name: [SimpleNamespace(label=label, current=cur) for label, cur in entries] for name, entries in chips.items()}


class CpuTemperature(unittest.TestCase):
    def check(self, value):
        with mock.patch.object(agent.psutil, "sensors_temperatures", create=True, return_value=value):
            return agent.collect_cpu_temp()

    def test_amd_k10temp_prefers_tdie_then_tctl(self):
        self.assertEqual(self.check(sensors(k10temp=[("Tctl", 71.0), ("Tdie", 55.5)])), 55.5)
        self.assertEqual(self.check(sensors(k10temp=[("Tctl", 71.0), ("Tccd1", 60.0)])), 71.0)

    def test_intel_coretemp_uses_package(self):
        self.assertEqual(self.check(sensors(coretemp=[("Core 0", 50.0), ("Package id 0", 58.0)])), 58.0)

    def test_no_sensors_is_none(self):
        self.assertIsNone(self.check({}))
        self.assertIsNone(self.check(sensors(acpitz=[("", 30.0)])))

    def test_platform_without_sensor_support_is_none(self):
        with mock.patch.object(agent.psutil, "sensors_temperatures", create=True, side_effect=NotImplementedError):
            self.assertIsNone(agent.collect_cpu_temp())


class CollectIncludesOllama(unittest.TestCase):
    def test_default_collect_has_null_ollama_fields(self):
        m = agent.collect(agent.NetworkRate(), "/")
        self.assertIsNone(m["ollama_up"])
        self.assertIsNone(m["ollama_models"])
        for key in ("cpu_temp_c", "gpu_percent", "vram_used_bytes", "vram_total_bytes", "gpu_temp_c", "gpu_hotspot_c"):
            self.assertIn(key, m)


if __name__ == "__main__":
    unittest.main()

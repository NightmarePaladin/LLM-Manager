# LLM-Manager monitoring agent

A small standalone Python 3 script that reports CPU, RAM, disk and network readings to LLM-Manager every 30 seconds. It runs on standard Linux servers, Proxmox VE hosts, Linux VMs and LXC containers, and does not need root. It holds only its own per-server token: no Supabase credentials.

Metrics it cannot read are sent as `null` and shown as "n/a" in the dashboard, never as 0. Network rates are measured between reports, so the first report after a restart has no network values.

## Before you start (in the dashboard)

1. Sign in, open the server's page and find **Monitoring agent**.
2. Click **Generate agent token** and copy the token (shown once) and the **Server ID**.

## Get the files onto the server

Run this on the Linux server first (the later steps assume you are in this folder):

```bash
mkdir -p ~/llm-agent && cd ~/llm-agent && for f in llm_manager_agent.py requirements.txt llm-manager-agent.service llm-manager-agent.env.example; do curl -fsSLO "https://raw.githubusercontent.com/NightmarePaladin/LLM-Manager/main/agent/$f"; done
```

## Install on Steve (Ubuntu/Debian style Linux)

```bash
sudo apt install -y python3 python3-venv
sudo useradd --system --no-create-home --shell /usr/sbin/nologin llm-agent

sudo mkdir -p /opt/llm-manager-agent
sudo cp llm_manager_agent.py requirements.txt /opt/llm-manager-agent/
sudo python3 -m venv /opt/llm-manager-agent/venv
sudo /opt/llm-manager-agent/venv/bin/pip install -r /opt/llm-manager-agent/requirements.txt
```

Easiest: on the server's page in the dashboard, click **Generate agent token** and copy the **One-command setup** box. Pasting it on the server creates or updates `/etc/llm-manager-agent.env` (root-only), keeps other settings, and restarts the agent. Or create the config by hand (keep it root-only, since it contains the token):

```bash
sudo cp llm-manager-agent.env.example /etc/llm-manager-agent.env
sudo chmod 600 /etc/llm-manager-agent.env
sudo nano /etc/llm-manager-agent.env     # set API URL, SERVER_ID and TOKEN
```

`LLM_MANAGER_API_URL` must be your production URL ending in `/api/telemetry`. HTTPS is required (plain HTTP is accepted only for `localhost` development).

## Check it first (nothing is sent)

```bash
/opt/llm-manager-agent/venv/bin/python /opt/llm-manager-agent/llm_manager_agent.py --dry-run
```

It prints one JSON reading and exits. No config is needed for a dry run.

## Start automatically with systemd

```bash
sudo cp llm-manager-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now llm-manager-agent
systemctl status llm-manager-agent
journalctl -u llm-manager-agent -f
```

The agent logs only failures (and recovery), never the token. Within about a minute the server should show **Online** in the dashboard.

## Options and configuration

| Setting | Meaning |
|---|---|
| `LLM_MANAGER_INTERVAL` | Seconds between reports. Default 30, minimum 10. |
| `LLM_MANAGER_DISK_PATH` | Mount point to report. Default `/`. |
| `LLM_MANAGER_OLLAMA_URL` | Ollama API base, e.g. `http://127.0.0.1:11434`. Unset = Ollama is not monitored (shown as a dash, never as "down"). |
| `--dry-run` | Print one reading, send nothing. |
| `--once` | Send one reading and exit (exit code 1 if it failed). |
| `-v` | Log every successful report. |

## Troubleshooting

- Updated the agent file but the dashboard still shows the old agent version? GitHub caches raw files for about 5 minutes after a push. Re-download from a commit-pinned URL (replace `main` in the URL with the commit hash), then check the version: `grep -m1 '^AGENT_VERSION' /opt/llm-manager-agent/llm_manager_agent.py`, and restart the service.

- `401`: token revoked/mistyped or wrong Server ID. Generate a new token.
- `429`: reporting faster than every 5 seconds.
- Stale in the dashboard: no valid report for 90 s. Check `journalctl -u llm-manager-agent` and network access to the Vercel domain.
- Proxmox host: network counts physical NICs only, so bridge and guest traffic is not double counted. In an LXC container, the container's own interface is used.

## Monitor Ollama (optional)

Set `LLM_MANAGER_OLLAMA_URL` to report whether Ollama answers (Running / Down) and which models are loaded in memory (name, size, how much is in VRAM, parameters, quantization). Run this on the server that hosts Ollama, after updating the agent to 0.2.0 or newer:

```bash
sudo sed -i '/^LLM_MANAGER_OLLAMA_URL=/d' /etc/llm-manager-agent.env && echo 'LLM_MANAGER_OLLAMA_URL=http://127.0.0.1:11434' | sudo tee -a /etc/llm-manager-agent.env >/dev/null && sudo systemctl restart llm-manager-agent
```

The agent only reads `/api/version` and `/api/ps`; it never loads or runs models. "No models loaded" is normal when Ollama is idle, because Ollama unloads models after a few minutes.

Tests: `python -m unittest agent/test_agent.py` (needs psutil).

## GPU and temperatures

Collected automatically when available, with no configuration and no root:

- **AMD GPU** (amdgpu driver): utilisation, VRAM used/total, edge and junction temperature, read from `/sys/class/drm`. If a machine has both an integrated and a discrete AMD GPU, the one with the most VRAM is used. Other vendors are ignored.
- **CPU temperature**: via psutil (`k10temp` on AMD, `coretemp` on Intel).

Anything the machine does not expose (VMs, LXC containers, no sensors) is reported as unavailable and shown as `n/a` or hidden, never as zero. Check what a machine reports with `--dry-run`.

## Not yet included

NVIDIA and Intel GPU metrics are not collected.

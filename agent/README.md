# LLM-Manager monitoring agent

A small standalone Python 3 script that reports CPU, RAM, disk and network readings to LLM-Manager every 30 seconds. It runs on standard Linux servers, Proxmox VE hosts, Linux VMs and LXC containers, and does not need root. It holds only its own per-server token: no Supabase credentials.

Metrics it cannot read are sent as `null` and shown as "n/a" in the dashboard, never as 0. Network rates are measured between reports, so the first report after a restart has no network values.

## Before you start (in the dashboard)

1. Sign in, open the server's page and find **Monitoring agent**.
2. Click **Generate agent token** and copy the token (shown once) and the **Server ID**.

## Install on Steve (Ubuntu/Debian style Linux)

```bash
sudo apt install -y python3 python3-venv
sudo useradd --system --no-create-home --shell /usr/sbin/nologin llm-agent

sudo mkdir -p /opt/llm-manager-agent
sudo cp llm_manager_agent.py requirements.txt /opt/llm-manager-agent/
sudo python3 -m venv /opt/llm-manager-agent/venv
sudo /opt/llm-manager-agent/venv/bin/pip install -r /opt/llm-manager-agent/requirements.txt
```

Create the config (keep it root-only, since it contains the token):

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
| `--dry-run` | Print one reading, send nothing. |
| `--once` | Send one reading and exit (exit code 1 if it failed). |
| `-v` | Log every successful report. |

## Troubleshooting

- `401`: token revoked/mistyped or wrong Server ID. Generate a new token.
- `429`: reporting faster than every 5 seconds.
- Stale in the dashboard: no valid report for 90 s. Check `journalctl -u llm-manager-agent` and network access to the Vercel domain.
- Proxmox host: network counts physical NICs only, so bridge and guest traffic is not double counted. In an LXC container, the container's own interface is used.

## Not yet included

Ollama status/models, AMD GPU and VRAM, and temperatures are planned and are not collected yet.

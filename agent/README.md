# LLM-Manager monitoring agent

A small standalone Python 3 script that reports CPU, RAM, disk and network readings to LLM-Manager every 30 seconds. It runs on Linux servers (including Proxmox VE hosts, VMs and LXC containers) and on Windows. It holds only its own per-server token: no Supabase credentials.

Metrics it cannot read are sent as `null` and shown as "n/a" in the dashboard, never as 0. Network rates are measured between reports, so the first report after a restart has no network values.

## Quick install (recommended)

1. Sign in, open the server's page and find **Monitoring agent**.
2. Click **Generate agent token**. The token is shown once.
3. Under **Install on**, pick the machine's platform, tick **This machine runs Ollama** if it does, and copy the **Install command**.
4. Paste it on that machine:
   - **Linux**: in any terminal. It uses `sudo` only when you are not root.
   - **Windows**: in PowerShell opened with **Run as administrator**.

The command downloads the installer pinned to the exact version of the dashboard you are using, checks the dashboard URL, and installs everything. Within about a minute the server shows **Online**. Re-running the command later updates the agent and settings; it is safe to run again.

| Platform in the dropdown | What the installer does |
|---|---|
| Linux, auto-detect | Reads `/etc/os-release` and uses apt, dnf/yum, pacman or zypper |
| Debian / Ubuntu / Mint / Pop!_OS / Raspberry Pi OS / Proxmox | apt: `python3`, `python3-venv` if missing |
| Fedora / RHEL / Rocky / AlmaLinux / CentOS / Amazon Linux | dnf (or yum on older systems): `python3`, `python3-pip` if missing |
| Arch / Manjaro / EndeavourOS | pacman: `python` if missing |
| openSUSE / SUSE Linux Enterprise | zypper: `python3`, `python3-pip` if missing |
| Windows 10 / 11 / Server | winget installs Python 3.12 if missing; scheduled task starts the agent at boot |
| Linux, agent already installed | only creates or updates `/etc/llm-manager-agent.env` and restarts the service |

Linux requirements: **systemd** and Python 3.8 or newer. Alpine Linux (OpenRC) is not supported by the installer; run the agent manually instead (see "Manual setup"). On Red Hat 8 family systems the default `python3` is 3.6; install `python3.11` first.

What gets installed:

- **Linux**: `/opt/llm-manager-agent/` (own Python venv, root-owned), `/etc/llm-manager-agent.env` (root-only, holds the token), `llm-manager-agent.service`, and an unprivileged `llm-agent` user the service runs as.
- **Windows**: `C:\ProgramData\LLM-Manager-Agent\` (venv, agent, `agent.env` readable only by SYSTEM and Administrators, `agent.log`) and the scheduled task `LLM-Manager Agent` (SYSTEM, at startup, restarts on failure).

The token is never printed. The Linux command starts with a space so bash keeps it out of your history; PowerShell does not save commands containing "token" to its history.

### Uninstall

Linux:

```bash
sudo systemctl disable --now llm-manager-agent
sudo rm -rf /opt/llm-manager-agent /etc/llm-manager-agent.env /etc/systemd/system/llm-manager-agent.service
sudo userdel llm-agent
```

Windows (elevated PowerShell):

```powershell
Unregister-ScheduledTask -TaskName 'LLM-Manager Agent' -Confirm:$false
Remove-Item -Recurse -Force "$env:ProgramData\LLM-Manager-Agent"
```

Also revoke the token on the server's page in the dashboard.

## Settings

| Setting | Meaning |
|---|---|
| `LLM_MANAGER_API_URL` | `https://<your-domain>/api/telemetry` (HTTPS required; HTTP only for `localhost`) |
| `LLM_MANAGER_SERVER_ID` | The server's ID from the dashboard |
| `LLM_MANAGER_TOKEN` | The server's agent token |
| `LLM_MANAGER_INTERVAL` | Seconds between reports. Default 30, minimum 10. |
| `LLM_MANAGER_DISK_PATH` | Mount point (or drive) to report. Default `/` on Linux, the system drive on Windows. |
| `LLM_MANAGER_OLLAMA_URL` | Ollama API base, e.g. `http://127.0.0.1:11434`. Unset = Ollama is not monitored (shown as a dash, never as "down"). |

They come from environment variables, a systemd `EnvironmentFile`, or a `KEY=VALUE` file passed with `--config FILE` (real environment variables win over the file). On Windows the agent also finds `%ProgramData%\LLM-Manager-Agent\agent.env` by itself.

| Option | Meaning |
|---|---|
| `--dry-run` | Print one reading, send nothing. No settings needed. |
| `--once` | Send one reading and exit (exit code 1 if it failed). |
| `--config FILE` | Read settings from a `KEY=VALUE` file. |
| `--log-file FILE` | Also log to a rotating file (1 MB x 3). |
| `-v` | Log every successful report. |

The agent logs only failures and recovery, never the token.

## Check what a machine reports (nothing is sent)

Linux: `/opt/llm-manager-agent/venv/bin/python /opt/llm-manager-agent/llm_manager_agent.py --dry-run`

Windows: `& "$env:ProgramData\LLM-Manager-Agent\venv\Scripts\python.exe" "$env:ProgramData\LLM-Manager-Agent\llm_manager_agent.py" --dry-run`

## What is collected

- **Everywhere**: CPU %, RAM, disk, network download/upload, uptime.
- **Linux, AMD GPU** (amdgpu driver): utilisation, VRAM used/total, edge and junction temperature, from `/sys/class/drm`. With both an integrated and a discrete AMD GPU, the one with the most VRAM is used. Other vendors are ignored.
- **Linux, CPU temperature**: via psutil (`k10temp` on AMD, `coretemp` on Intel). Virtual machines usually expose none.
- **Ollama** (opt-in): whether it answers (Running / Down) and which models are loaded (name, size, share in VRAM, parameters, quantization). The agent only reads `/api/version` and `/api/ps`; it never loads or runs models. "No models loaded" is normal when Ollama is idle, because it unloads models after a few minutes.
- **Windows**: CPU, RAM, disk and network. GPU and temperature sensors are Linux-only for now. Virtual adapters (Hyper-V, WSL, loopback, TAP) are left out of the network totals.

Anything a machine does not expose is reported as unavailable and shown as `n/a` or hidden, never as zero. On a Proxmox host, network counts physical NICs only so bridge and guest traffic is not counted twice; in an LXC container the container's own interface is used.

## Troubleshooting

- `401` in the log: token revoked or mistyped, or wrong Server ID. Generate a new token and run the install command again.
- `429`: reporting faster than every 5 seconds.
- Stale in the dashboard: no valid report for 90 s. Linux: `journalctl -u llm-manager-agent -n 20 --no-pager`. Windows: open `C:\ProgramData\LLM-Manager-Agent\agent.log`.
- The installer says it could not reach the dashboard: check the URL and that the machine has internet access.
- Updated the agent file by hand but the dashboard still shows the old agent version? GitHub caches `main` raw files for about 5 minutes after a push. Use a commit-pinned URL (the install command already does).
- Windows: "run this in PowerShell as Administrator" means the window was not elevated. Right-click PowerShell and choose Run as administrator.
- Windows: if winget is not available, install Python from python.org (tick "Add python.exe to PATH") and run the command again.

## Manual setup (no installer)

Use this for Alpine/OpenRC or if you prefer to do each step yourself. On the machine:

```bash
mkdir -p ~/llm-agent && cd ~/llm-agent
for f in llm_manager_agent.py requirements.txt llm-manager-agent.service llm-manager-agent.env.example; do curl -fsSLO "https://raw.githubusercontent.com/NightmarePaladin/LLM-Manager/main/agent/$f"; done

sudo useradd --system --no-create-home --shell /usr/sbin/nologin llm-agent
sudo mkdir -p /opt/llm-manager-agent
sudo cp llm_manager_agent.py requirements.txt /opt/llm-manager-agent/
sudo python3 -m venv /opt/llm-manager-agent/venv
sudo /opt/llm-manager-agent/venv/bin/pip install -r /opt/llm-manager-agent/requirements.txt

sudo cp llm-manager-agent.env.example /etc/llm-manager-agent.env
sudo chmod 600 /etc/llm-manager-agent.env
sudo nano /etc/llm-manager-agent.env     # set the three settings from the dashboard

sudo cp llm-manager-agent.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now llm-manager-agent
```

Without systemd, run it under your init system with the environment set, for example: `LLM_MANAGER_API_URL=... LLM_MANAGER_SERVER_ID=... LLM_MANAGER_TOKEN=... /opt/llm-manager-agent/venv/bin/python /opt/llm-manager-agent/llm_manager_agent.py`.

## Tests

- Agent: `python -m unittest agent/test_agent.py` (needs psutil).
- Installers and the generated commands: `npm test` (runs `install.sh` under bash with simulated distributions, and `install.ps1` under PowerShell).

## Not yet included

NVIDIA and Intel GPU metrics, and macOS.

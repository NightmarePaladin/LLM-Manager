#!/usr/bin/env bash
# LLM-Manager monitoring agent installer for Linux (systemd distributions).
#
# Installs the agent into /opt/llm-manager-agent (own Python venv, runs as the
# unprivileged "llm-agent" user), writes /etc/llm-manager-agent.env (root-only),
# and enables a systemd service. Safe to re-run: it updates the agent and config.
#
# Settings come from environment variables (the dashboard generates the command):
#   LLM_MANAGER_API_URL, LLM_MANAGER_SERVER_ID, LLM_MANAGER_TOKEN   (required)
#   LLM_MANAGER_OLLAMA_URL   optional, e.g. http://127.0.0.1:11434
#   LLM_MANAGER_AGENT_BASE   where to download agent files (URL or local directory)
#   LLM_MANAGER_PM           force a package manager: apt | dnf | yum | pacman | zypper
#
# Supported: Debian, Ubuntu, Linux Mint, Pop!_OS, Raspberry Pi OS, Proxmox VE (apt);
# Fedora, RHEL, Rocky, AlmaLinux, CentOS Stream, Oracle, Amazon Linux (dnf/yum);
# Arch, Manjaro, EndeavourOS (pacman); openSUSE, SLES (zypper).
# Not supported: distributions without systemd (e.g. Alpine).

set -euo pipefail

INSTALL_DIR="${LLM_MANAGER_INSTALL_DIR:-/opt/llm-manager-agent}"
ENV_FILE="${LLM_MANAGER_ENV_FILE:-/etc/llm-manager-agent.env}"
UNIT_FILE="${LLM_MANAGER_UNIT_FILE:-/etc/systemd/system/llm-manager-agent.service}"
SERVICE_USER="llm-agent"
AGENT_BASE="${LLM_MANAGER_AGENT_BASE:-https://raw.githubusercontent.com/NightmarePaladin/LLM-Manager/main/agent}"
OS_RELEASE="${LLM_MANAGER_OS_RELEASE:-/etc/os-release}"
DRY_RUN="${LLM_MANAGER_INSTALL_DRY_RUN:-0}"
MIN_PY_MINOR=8

SAFE_RE='^[A-Za-z0-9:/._~-]+$'
UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
TOKEN_RE='^lmt_[A-Za-z0-9_-]{43}$'

say() { printf '%s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Runs a state-changing command, or just prints it in dry-run mode.
run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '+ %s\n' "$*"
  else
    "$@"
  fi
}

validate_inputs() {
  local api="${LLM_MANAGER_API_URL:-}" sid="${LLM_MANAGER_SERVER_ID:-}" tok="${LLM_MANAGER_TOKEN:-}" oll="${LLM_MANAGER_OLLAMA_URL:-}"
  [ -n "$api" ] || die "LLM_MANAGER_API_URL is not set (copy the command from the server's page in the dashboard)"
  [ -n "$sid" ] || die "LLM_MANAGER_SERVER_ID is not set"
  [ -n "$tok" ] || die "LLM_MANAGER_TOKEN is not set"
  [[ "$api" =~ $SAFE_RE ]] || die "LLM_MANAGER_API_URL contains unexpected characters"
  case "$api" in
    https://*|http://localhost*|http://127.0.0.1*) ;;
    *) die "LLM_MANAGER_API_URL must start with https:// (http:// is only allowed for localhost)" ;;
  esac
  [[ "$sid" =~ $UUID_RE ]] || die "LLM_MANAGER_SERVER_ID is not a valid server id"
  [[ "$tok" =~ $TOKEN_RE ]] || die "LLM_MANAGER_TOKEN does not look like an agent token (lmt_...)"
  case "$api$sid$tok" in
    *your-production-domain*|*paste_token_here*|*00000000-0000-0000-0000-000000000000*)
      die "the settings still contain example placeholders; use the command from the dashboard" ;;
  esac
  if [ -n "$oll" ]; then
    [[ "$oll" =~ $SAFE_RE ]] || die "LLM_MANAGER_OLLAMA_URL contains unexpected characters"
    case "$oll" in http://*|https://*) ;; *) die "LLM_MANAGER_OLLAMA_URL must start with http:// or https://" ;; esac
  fi
}

# Prints apt | dnf | yum | pacman | zypper, or fails for unsupported systems.
detect_pm() {
  local forced="${LLM_MANAGER_PM:-}"
  if [ -n "$forced" ]; then
    case "$forced" in apt|dnf|yum|pacman|zypper) printf '%s\n' "$forced"; return 0 ;; esac
    die "LLM_MANAGER_PM must be one of: apt, dnf, yum, pacman, zypper"
  fi

  local id="" like=""
  if [ -r "$OS_RELEASE" ]; then
    id="$(. "$OS_RELEASE" >/dev/null 2>&1; printf '%s' "${ID:-}")"
    like="$(. "$OS_RELEASE" >/dev/null 2>&1; printf '%s' "${ID_LIKE:-}")"
  fi
  local ids=" $id $like "
  ids="${ids,,}"

  case "$ids" in
    *" alpine "*) die "Alpine Linux does not use systemd, which this installer needs. Run the agent manually (see agent/README.md)." ;;
    *" debian "*|*" ubuntu "*|*" linuxmint "*|*" raspbian "*|*" pop "*|*" kali "*|*" devuan "*|*" elementary "*|*" zorin "*) printf 'apt\n'; return 0 ;;
    *" fedora "*|*" rhel "*|*" centos "*|*" rocky "*|*" almalinux "*|*" ol "*|*" amzn "*|*" nobara "*)
      if command -v dnf >/dev/null 2>&1; then printf 'dnf\n'; else printf 'yum\n'; fi
      return 0 ;;
    *" arch "*|*" manjaro "*|*" endeavouros "*|*" garuda "*|*" cachyos "*) printf 'pacman\n'; return 0 ;;
    *" opensuse "*|*" opensuse-leap "*|*" opensuse-tumbleweed "*|*" sles "*|*" sled "*|*" suse "*) printf 'zypper\n'; return 0 ;;
  esac

  # Unknown ID: fall back to whichever package manager exists.
  local pm
  for pm in apt-get dnf yum pacman zypper; do
    if command -v "$pm" >/dev/null 2>&1; then
      [ "$pm" = apt-get ] && pm=apt
      printf '%s\n' "$pm"
      return 0
    fi
  done
  die "could not detect your package manager. Set LLM_MANAGER_PM to apt, dnf, yum, pacman or zypper and run again."
}

# Echoes the first usable interpreter (>= 3.$MIN_PY_MINOR with venv + ensurepip), or nothing.
find_python() {
  local py
  for py in python3.13 python3.12 python3.11 python3.10 python3.9 python3 python3.8; do
    if command -v "$py" >/dev/null 2>&1 \
       && "$py" -c "import sys; sys.exit(0 if sys.version_info >= (3, $MIN_PY_MINOR) else 1)" >/dev/null 2>&1 \
       && "$py" -c "import venv, ensurepip" >/dev/null 2>&1; then
      printf '%s\n' "$py"
      return 0
    fi
  done
  return 1
}

install_packages() {
  local pm="$1" need_curl=1
  command -v curl >/dev/null 2>&1 && need_curl=0
  case "$pm" in
    apt)
      local pkgs=(python3 python3-venv ca-certificates)
      [ "$need_curl" = 1 ] && pkgs+=(curl)
      run apt-get update -qq || warn "apt-get update failed; trying to install from the existing package lists"
      run env DEBIAN_FRONTEND=noninteractive apt-get install -y "${pkgs[@]}" ;;
    dnf|yum)
      local pkgs=(python3 python3-pip)
      [ "$need_curl" = 1 ] && pkgs+=(curl)
      run "$pm" install -y "${pkgs[@]}" ;;
    pacman)
      local pkgs=(python)
      [ "$need_curl" = 1 ] && pkgs+=(curl)
      run pacman -S --needed --noconfirm "${pkgs[@]}" \
        || run pacman -Sy --needed --noconfirm "${pkgs[@]}" ;;
    zypper)
      local pkgs=(python3 python3-pip)
      [ "$need_curl" = 1 ] && pkgs+=(curl)
      run zypper --non-interactive install "${pkgs[@]}" ;;
  esac
}

# fetch <file-name> <destination>: downloads from AGENT_BASE (URL) or copies from a local directory.
fetch() {
  local name="$1" dest="$2"
  if [ "$DRY_RUN" = 1 ]; then
    printf '+ fetch %s/%s -> %s\n' "$AGENT_BASE" "$name" "$dest"
    return 0
  fi
  case "$AGENT_BASE" in
    http://*|https://*)
      if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$AGENT_BASE/$name" -o "$dest" || die "could not download $AGENT_BASE/$name"
      elif command -v wget >/dev/null 2>&1; then
        wget -qO "$dest" "$AGENT_BASE/$name" || die "could not download $AGENT_BASE/$name"
      else
        die "neither curl nor wget is available"
      fi ;;
    *) cp "$AGENT_BASE/$name" "$dest" || die "could not copy $AGENT_BASE/$name" ;;
  esac
}

# Sets KEY=VALUE in the env file: replaces an existing line, keeps every other line.
set_config_value() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  chmod 600 "$tmp"
  if [ -f "$ENV_FILE" ]; then grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true; fi
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
}

write_config() {
  if [ "$DRY_RUN" = 1 ]; then
    say "+ write $ENV_FILE (mode 600): LLM_MANAGER_API_URL, LLM_MANAGER_SERVER_ID, LLM_MANAGER_TOKEN=<hidden>${LLM_MANAGER_OLLAMA_URL:+, LLM_MANAGER_OLLAMA_URL}"
    return 0
  fi
  [ -f "$ENV_FILE" ] || { : > "$ENV_FILE"; chmod 600 "$ENV_FILE"; }
  set_config_value LLM_MANAGER_API_URL "$LLM_MANAGER_API_URL"
  set_config_value LLM_MANAGER_SERVER_ID "$LLM_MANAGER_SERVER_ID"
  set_config_value LLM_MANAGER_TOKEN "$LLM_MANAGER_TOKEN"
  if [ -n "${LLM_MANAGER_OLLAMA_URL:-}" ]; then
    set_config_value LLM_MANAGER_OLLAMA_URL "$LLM_MANAGER_OLLAMA_URL"
  fi
  chmod 600 "$ENV_FILE"
}

preflight_connectivity() {
  [ "$DRY_RUN" = 1 ] && { say "+ check $LLM_MANAGER_API_URL answers"; return 0; }
  command -v curl >/dev/null 2>&1 || return 0
  if curl -fsS -m 10 "$LLM_MANAGER_API_URL" 2>/dev/null | grep -q '"ok"'; then
    say "Dashboard reachable."
  else
    warn "could not reach $LLM_MANAGER_API_URL (wrong URL, or no internet from this machine?). Continuing; the agent will keep retrying."
  fi
}

main() {
  say "LLM-Manager agent installer"
  validate_inputs

  if [ "$DRY_RUN" != 1 ] && [ "${LLM_MANAGER_ALLOW_NONROOT:-0}" != 1 ] && [ "$(id -u)" -ne 0 ]; then
    die "please run as root (the dashboard command uses sudo when needed)"
  fi
  if [ "$DRY_RUN" != 1 ] && [ "${LLM_MANAGER_ALLOW_NONROOT:-0}" != 1 ]; then
    command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ] \
      || die "systemd is not running on this machine; this installer needs it (see agent/README.md to run the agent manually)"
  fi

  local pm py
  pm="$(detect_pm)"
  say "Package manager: $pm"
  preflight_connectivity

  if py="$(find_python)"; then
    say "Using existing Python: $py"
  else
    say "Installing Python and tools with $pm..."
    install_packages "$pm"
    if [ "$DRY_RUN" = 1 ]; then
      py=python3
    else
      py="$(find_python)" || die "Python 3.$MIN_PY_MINOR or newer with venv support is required but was not found after installing packages. On older RHEL/CentOS, install a newer python3 (for example python3.11) and run again."
    fi
  fi

  if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
    local nologin
    nologin="$(command -v nologin || printf '/usr/sbin/nologin')"
    say "Creating service user $SERVICE_USER"
    run useradd --system --no-create-home --shell "$nologin" "$SERVICE_USER"
  fi

  run mkdir -p "$INSTALL_DIR"
  run "$py" -m venv "$INSTALL_DIR/venv"

  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "${TMP_DIR:-}"' EXIT
  fetch llm_manager_agent.py "$TMP_DIR/llm_manager_agent.py"
  fetch requirements.txt "$TMP_DIR/requirements.txt"
  fetch llm-manager-agent.service "$TMP_DIR/llm-manager-agent.service"
  if [ "$DRY_RUN" != 1 ]; then
    grep -q '^AGENT_VERSION' "$TMP_DIR/llm_manager_agent.py" || die "downloaded agent file looks wrong (is the download URL correct?)"
    say "Agent $(grep -m1 '^AGENT_VERSION' "$TMP_DIR/llm_manager_agent.py" | cut -d'"' -f2)"
  fi

  run install -m 0644 "$TMP_DIR/llm_manager_agent.py" "$INSTALL_DIR/llm_manager_agent.py"
  run install -m 0644 "$TMP_DIR/requirements.txt" "$INSTALL_DIR/requirements.txt"
  run "$INSTALL_DIR/venv/bin/python" -m pip install --disable-pip-version-check -q -r "$INSTALL_DIR/requirements.txt" \
    || die "installing psutil failed. If it needs to compile, install a C compiler and the Python headers (for example gcc and python3-devel) and run again."

  write_config

  if [ "$DRY_RUN" = 1 ]; then
    say "+ install service unit -> $UNIT_FILE"
  else
    sed "s|/opt/llm-manager-agent|$INSTALL_DIR|g; s|/etc/llm-manager-agent.env|$ENV_FILE|g" \
      "$TMP_DIR/llm-manager-agent.service" > "$UNIT_FILE"
    chmod 644 "$UNIT_FILE"
  fi
  run systemctl daemon-reload
  run systemctl enable llm-manager-agent
  run systemctl restart llm-manager-agent

  if [ "$DRY_RUN" != 1 ]; then
    say "Waiting for the first report..."
    sleep 12
    if systemctl is-active --quiet llm-manager-agent; then
      if command -v journalctl >/dev/null 2>&1 && journalctl -u llm-manager-agent --since "-20 seconds" --no-pager 2>/dev/null | grep -q "report failed"; then
        warn "the agent is running but its first report failed:"
        journalctl -u llm-manager-agent --since "-20 seconds" --no-pager 2>/dev/null | grep "report failed" | tail -n 2 >&2 || true
        warn "check the token and server id, then re-run the command from the dashboard."
      else
        say "Agent is running and reporting. The server should show Online in the dashboard within a minute."
      fi
    else
      warn "the service is not active. Check: journalctl -u llm-manager-agent -n 20 --no-pager"
      exit 1
    fi
  fi

  say "Done. To remove: systemctl disable --now llm-manager-agent; rm -rf $INSTALL_DIR $ENV_FILE $UNIT_FILE; userdel $SERVICE_USER"
}

if [ "${LLM_MANAGER_INSTALL_SOURCE_ONLY:-0}" != 1 ]; then
  main "$@"
fi

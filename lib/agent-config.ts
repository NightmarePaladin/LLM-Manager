export const AGENT_ENV_PATH = "/etc/llm-manager-agent.env";
export const AGENT_REPO = "NightmarePaladin/LLM-Manager";
export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

type AgentConfig = { apiUrl: string; serverId: string; token: string; ollamaUrl?: string | null };
type Options = { path?: string; sudo?: boolean; restart?: boolean };

// Values are interpolated inside single quotes, so only this safe set is allowed.
const SAFE = /^[A-Za-z0-9:/._~-]+$/;

function assertSafe(label: string, value: string) {
  if (!SAFE.test(value)) throw new Error(`${label} contains characters that are unsafe in a shell command`);
}

/**
 * Builds a one-line shell command that creates or updates the agent config file:
 * any existing LLM_MANAGER_API_URL / SERVER_ID / TOKEN (and OLLAMA_URL) lines are
 * replaced, other lines are kept, the file is root-only (600), and the agent service
 * is restarted. The command starts with a space so default bash settings
 * (ignorespace) keep the token out of shell history.
 */
export function buildConfigCommand(cfg: AgentConfig, opts: Options = {}): string {
  const { path = AGENT_ENV_PATH, sudo = true, restart = true } = opts;
  const pairs: [string, string][] = [
    ["LLM_MANAGER_API_URL", cfg.apiUrl],
    ["LLM_MANAGER_SERVER_ID", cfg.serverId],
    ["LLM_MANAGER_TOKEN", cfg.token],
  ];
  if (cfg.ollamaUrl) pairs.push(["LLM_MANAGER_OLLAMA_URL", cfg.ollamaUrl]);
  for (const [key, value] of pairs) assertSafe(key, value);
  assertSafe("path", path);

  const s = sudo ? "sudo " : "";
  const list = pairs.map(([k, v]) => `'${k}=${v}'`).join(" ");
  const write =
    `${s}touch ${path} && ${s}chmod 600 ${path} && ` +
    `for kv in ${list}; do k=\${kv%%=*}; ${s}sed -i "/^$k=/d" ${path}; echo "$kv" | ${s}tee -a ${path} >/dev/null; done`;
  const restartCmd = restart
    ? ` && { ${s}systemctl restart llm-manager-agent && echo "Config saved, agent restarted." || echo "Config saved. Install the agent service next."; }`
    : "";
  return ` ${write}${restartCmd}`;
}

export type PlatformId = "linux-auto" | "debian" | "rhel" | "arch" | "suse" | "linux-config" | "windows";

export type Platform = {
  id: PlatformId;
  label: string;
  group: "Linux (systemd)" | "Windows" | "Already installed";
  /** Where the user should paste the command. */
  where: string;
  /** One sentence on what the command does. */
  summary: string;
  /** Forces the installer's package manager; null lets it auto-detect from /etc/os-release. */
  pm: "apt" | "pacman" | "zypper" | null;
};

export const PLATFORMS: Platform[] = [
  {
    id: "linux-auto",
    label: "Linux: auto-detect my distribution",
    group: "Linux (systemd)",
    where: "a terminal on the server",
    summary: "Detects apt, dnf, yum, pacman or zypper, installs Python only if needed, sets up the agent and a systemd service.",
    pm: null,
  },
  {
    id: "debian",
    label: "Debian / Ubuntu / Mint / Pop!_OS / Raspberry Pi OS / Proxmox",
    group: "Linux (systemd)",
    where: "a terminal on the server",
    summary: "Uses apt (python3, python3-venv) if Python is missing, then sets up the agent and a systemd service.",
    pm: "apt",
  },
  {
    id: "rhel",
    label: "Fedora / RHEL / Rocky / AlmaLinux / CentOS / Amazon Linux",
    group: "Linux (systemd)",
    where: "a terminal on the server",
    summary: "Uses dnf (or yum on older systems) if Python is missing, then sets up the agent and a systemd service.",
    pm: null,
  },
  {
    id: "arch",
    label: "Arch / Manjaro / EndeavourOS",
    group: "Linux (systemd)",
    where: "a terminal on the server",
    summary: "Uses pacman if Python is missing, then sets up the agent and a systemd service.",
    pm: "pacman",
  },
  {
    id: "suse",
    label: "openSUSE / SUSE Linux Enterprise",
    group: "Linux (systemd)",
    where: "a terminal on the server",
    summary: "Uses zypper if Python is missing, then sets up the agent and a systemd service.",
    pm: "zypper",
  },
  {
    id: "windows",
    label: "Windows 10 / 11 / Server (PowerShell)",
    group: "Windows",
    where: "PowerShell opened with Run as administrator",
    summary:
      "Installs Python with winget if missing, sets up the agent in C:\\ProgramData\\LLM-Manager-Agent and a scheduled task that starts at boot. Reports CPU, RAM, disk and network.",
    pm: null,
  },
  {
    id: "linux-config",
    label: "Linux: agent already installed, only update the settings",
    group: "Already installed",
    where: "a terminal on the server",
    summary: "Creates or updates /etc/llm-manager-agent.env (root-only), keeps other settings, and restarts the service.",
    pm: null,
  },
];

export type InstallCommandInput = {
  platform: PlatformId;
  apiUrl: string;
  serverId: string;
  token: string;
  /** Full 40-character commit the dashboard was built from; pins the installer so it matches this dashboard. */
  ref?: string | null;
  ollamaUrl?: string | null;
};

export function agentBaseUrl(ref?: string | null): string {
  const pinned = ref && /^[0-9a-f]{40}$/.test(ref) ? ref : "main";
  return `https://raw.githubusercontent.com/${AGENT_REPO}/${pinned}/agent`;
}

/**
 * The line a user pastes to install (or update) the agent. Every value is checked
 * against a strict character set first, so nothing can break out of the quotes.
 */
export function buildInstallCommand(input: InstallCommandInput): string {
  const { platform, apiUrl, serverId, token, ref, ollamaUrl } = input;
  const def = PLATFORMS.find((p) => p.id === platform);
  if (!def) throw new Error(`unknown platform: ${platform}`);

  if (platform === "linux-config") return buildConfigCommand({ apiUrl, serverId, token, ollamaUrl });

  const base = agentBaseUrl(ref);
  const values: [string, string][] = [
    ["LLM_MANAGER_API_URL", apiUrl],
    ["LLM_MANAGER_SERVER_ID", serverId],
    ["LLM_MANAGER_TOKEN", token],
    ["LLM_MANAGER_AGENT_BASE", base],
  ];
  if (ollamaUrl) values.push(["LLM_MANAGER_OLLAMA_URL", ollamaUrl]);
  for (const [key, value] of values) assertSafe(key, value);

  if (platform === "windows") {
    // PSReadLine never saves lines containing "token" to the history file.
    const sets = values.map(([k, v]) => `$env:${k}='${v}'`).join("; ");
    return ` [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ${sets}; iex (irm '${base}/install.ps1')`;
  }

  if (def.pm) values.push(["LLM_MANAGER_PM", def.pm]);
  const envs = values.map(([k, v]) => `${k}='${v}'`).join(" ");
  const url = `${base}/install.sh`;
  // Download to a temp file first (a failed download must not run an empty script), use sudo only when not root,
  // fall back to wget when curl is missing, and always clean up. Leading space keeps it out of bash history.
  return (
    ` f=$(mktemp) && { curl -fsSL '${url}' -o "$f" || wget -qO "$f" '${url}'; } && ` +
    `$([ "$(id -u)" -eq 0 ] || echo sudo) env ${envs} bash "$f"; rm -f "$f"`
  );
}

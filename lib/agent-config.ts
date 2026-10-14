export const AGENT_ENV_PATH = "/etc/llm-manager-agent.env";

type AgentConfig = { apiUrl: string; serverId: string; token: string };
type Options = { path?: string; sudo?: boolean; restart?: boolean };

// Values are interpolated inside single quotes, so only this safe set is allowed.
const SAFE = /^[A-Za-z0-9:/._~-]+$/;

/**
 * Builds a one-line shell command that creates or updates the agent config file:
 * any existing LLM_MANAGER_API_URL / SERVER_ID / TOKEN lines are replaced, other
 * lines are kept, the file is root-only (600), and the agent service is restarted.
 * The command starts with a space so default bash settings (ignorespace) keep the
 * token out of shell history.
 */
export function buildConfigCommand(cfg: AgentConfig, opts: Options = {}): string {
  const { path = AGENT_ENV_PATH, sudo = true, restart = true } = opts;
  const pairs: [string, string][] = [
    ["LLM_MANAGER_API_URL", cfg.apiUrl],
    ["LLM_MANAGER_SERVER_ID", cfg.serverId],
    ["LLM_MANAGER_TOKEN", cfg.token],
  ];
  for (const [key, value] of pairs) {
    if (!SAFE.test(value)) throw new Error(`${key} contains characters that are unsafe in a shell command`);
  }
  if (!SAFE.test(path)) throw new Error("path contains unsafe characters");

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

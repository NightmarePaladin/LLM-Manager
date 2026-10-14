import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildConfigCommand } from "@/lib/agent-config";
import { generateToken } from "@/lib/telemetry";

const cfg = {
  apiUrl: "https://llm-manager-paladins2.vercel.app/api/telemetry",
  serverId: "a568fbb7-a3ab-4337-b6ad-f0cd927af07b",
  token: generateToken(),
};

const hasBash = spawnSync("bash", ["-c", "true"]).status === 0;

describe("buildConfigCommand", () => {
  it("starts with a space (keeps the token out of shell history) and restarts the service", () => {
    const cmd = buildConfigCommand(cfg);
    expect(cmd.startsWith(" ")).toBe(true);
    expect(cmd).toContain("sudo systemctl restart llm-manager-agent");
    expect(cmd).toContain("/etc/llm-manager-agent.env");
  });

  it.each([
    ["quote", { ...cfg, token: "lmt_x'; rm -rf /; '" }],
    ["space", { ...cfg, apiUrl: "https://a.b/api telemetry" }],
    ["subshell", { ...cfg, serverId: "$(whoami)" }],
    ["newline", { ...cfg, token: "lmt_a\nb" }],
  ])("refuses values with unsafe characters: %s", (_label, bad) => {
    expect(() => buildConfigCommand(bad)).toThrow();
  });

  // Runs the real generated command against a temp file (sudo and restart disabled).
  it.skipIf(!hasBash)("creates the file with mode 600 and the three values", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "agentcfg-")), "agent.env").replace(/\\/g, "/");
    const run = () => spawnSync("bash", ["-c", buildConfigCommand(cfg, { path: file, sudo: false, restart: false })]);
    expect(run().status).toBe(0);
    const text = readFileSync(file, "utf8");
    expect(text).toContain(`LLM_MANAGER_API_URL=${cfg.apiUrl}\n`);
    expect(text).toContain(`LLM_MANAGER_SERVER_ID=${cfg.serverId}\n`);
    expect(text).toContain(`LLM_MANAGER_TOKEN=${cfg.token}\n`);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it.skipIf(!hasBash)("updates an existing file: replaces the three keys once, keeps other lines", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "agentcfg-")), "agent.env").replace(/\\/g, "/");
    writeFileSync(
      file,
      "# comment\nLLM_MANAGER_API_URL=https://your-production-domain.vercel.app/api/telemetry\nLLM_MANAGER_TOKEN=old\nLLM_MANAGER_INTERVAL=45\n"
    );
    const newToken = generateToken();
    const cmd = buildConfigCommand({ ...cfg, token: newToken }, { path: file, sudo: false, restart: false });
    expect(spawnSync("bash", ["-c", cmd]).status).toBe(0);
    expect(spawnSync("bash", ["-c", cmd]).status).toBe(0); // idempotent

    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toContain("# comment");
    expect(lines).toContain("LLM_MANAGER_INTERVAL=45");
    expect(lines.filter((l) => l.startsWith("LLM_MANAGER_API_URL="))).toEqual([`LLM_MANAGER_API_URL=${cfg.apiUrl}`]);
    expect(lines.filter((l) => l.startsWith("LLM_MANAGER_TOKEN="))).toEqual([`LLM_MANAGER_TOKEN=${newToken}`]);
    expect(lines.filter((l) => l.startsWith("LLM_MANAGER_SERVER_ID="))).toHaveLength(1);
    expect(readFileSync(file, "utf8")).not.toContain("old");
    expect(readFileSync(file, "utf8")).not.toContain("your-production-domain");
  });
});

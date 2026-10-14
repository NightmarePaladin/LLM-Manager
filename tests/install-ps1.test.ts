import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateToken } from "@/lib/telemetry";

const pwsh = (script: string, env: Record<string, string> = {}) =>
  spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, ...env }, encoding: "utf8" });

const hasPwsh = pwsh("exit 0").status === 0;
const INSTALL = path.resolve(process.cwd(), "agent", "install.ps1");
const tmp = () => mkdtempSync(path.join(tmpdir(), "install-ps1-"));

const TOKEN = generateToken();
const GOOD = {
  LLM_MANAGER_API_URL: "https://llm-manager-paladins2.vercel.app/api/telemetry",
  LLM_MANAGER_SERVER_ID: "a568fbb7-a3ab-4337-b6ad-f0cd927af07b",
  LLM_MANAGER_TOKEN: TOKEN,
  LLM_MANAGER_OLLAMA_URL: "",
  LLM_MANAGER_AGENT_BASE: "https://raw.githubusercontent.com/NightmarePaladin/LLM-Manager/0123456789abcdef0123456789abcdef01234567/agent",
};

// Runs install.ps1 as a script block so switches work exactly as they would for iex.
const install = (flags: string, env: Record<string, string> = {}) =>
  pwsh(`& ([scriptblock]::Create((Get-Content -Raw '${INSTALL}'))) ${flags}`, { ...GOOD, ...env });

describe.skipIf(!hasPwsh)("agent/install.ps1", () => {
  it("parses cleanly", () => {
    const r = pwsh(
      `$e = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile('${INSTALL}', [ref]$null, [ref]$e); if ($e) { $e | ForEach-Object { $_.Message }; exit 1 }`
    );
    expect(r.status).toBe(0);
  });

  it("dry run plans every step and never prints the token", () => {
    const dir = tmp();
    const r = install(`-DryRun -InstallDir '${dir}'`, { LLM_MANAGER_OLLAMA_URL: "http://127.0.0.1:11434" });
    expect(r.status).toBe(0);
    const out = r.stdout + r.stderr;
    expect(out).toContain("LLM-Manager agent installer (Windows)");
    expect(out).toContain("create venv");
    expect(out).toContain("pip install");
    expect(out).toContain("LLM_MANAGER_TOKEN=<hidden>");
    expect(out).toContain("LLM_MANAGER_OLLAMA_URL");
    expect(out).toContain("register scheduled task 'LLM-Manager Agent'");
    expect(out).toContain("/0123456789abcdef0123456789abcdef01234567/agent/llm_manager_agent.py");
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(TOKEN.slice(4));
  });

  it("dry run changes nothing on disk", () => {
    const dir = path.join(tmp(), "should-not-exist");
    install(`-DryRun -InstallDir '${dir}'`);
    const probe = pwsh(`Test-Path '${dir}'`);
    expect(probe.stdout.trim()).toBe("False");
  });

  it.each([
    ["missing url", { LLM_MANAGER_API_URL: "" }],
    ["missing token", { LLM_MANAGER_TOKEN: "" }],
    ["plain http to a remote host", { LLM_MANAGER_API_URL: "http://example.com/api/telemetry" }],
    ["shell metacharacters in the url", { LLM_MANAGER_API_URL: "https://a.b/x;rm -rf /" }],
    ["subexpression in the url", { LLM_MANAGER_API_URL: "https://a.b/$(whoami)" }],
    ["bad server id", { LLM_MANAGER_SERVER_ID: "nope" }],
    ["bad token", { LLM_MANAGER_TOKEN: "lmt_short" }],
    ["placeholder domain", { LLM_MANAGER_API_URL: "https://your-production-domain.vercel.app/api/telemetry" }],
    ["unsafe ollama url", { LLM_MANAGER_OLLAMA_URL: "http://x;y" }],
  ])("rejects %s before doing anything", (_label, override) => {
    const r = install("-DryRun", override);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/ERROR/);
    expect(r.stdout).not.toContain("create venv");
  });

  it("refuses to install when not elevated (and not testing), before touching anything", () => {
    const elevated = pwsh("([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)").stdout.trim() === "True";
    if (elevated) return; // an elevated test run would perform a real install; the check above is what we are testing
    const r = install("");
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Administrator/);
  });

  describe("config file writing", () => {
    // Dot-source with -SourceOnly to call the functions directly.
    const call = (body: string) => pwsh(`. '${INSTALL}' -SourceOnly; ${body}`, GOOD);

    it("replaces a key once, keeps other lines, writes UTF-8 without a BOM", () => {
      const file = path.join(tmp(), "agent.env");
      writeFileSync(file, "# mine\nLLM_MANAGER_API_URL=old\nLLM_MANAGER_INTERVAL=45\n");
      const r = call(`Set-ConfigValue '${file}' 'LLM_MANAGER_API_URL' 'https://x.y/z'; Set-ConfigValue '${file}' 'LLM_MANAGER_API_URL' 'https://x.y/z'; Set-ConfigValue '${file}' 'LLM_MANAGER_TOKEN' '${TOKEN}'`);
      expect(r.status).toBe(0);
      const bytes = readFileSync(file);
      expect(bytes[0]).not.toBe(0xef); // no BOM
      const lines = bytes.toString("utf8").split(/\r?\n/).filter(Boolean);
      expect(lines).toContain("# mine");
      expect(lines).toContain("LLM_MANAGER_INTERVAL=45");
      expect(lines.filter((l) => l.startsWith("LLM_MANAGER_API_URL="))).toEqual(["LLM_MANAGER_API_URL=https://x.y/z"]);
      expect(lines).toContain(`LLM_MANAGER_TOKEN=${TOKEN}`);
      expect(lines.join("\n")).not.toContain("=old");
    });
  });
});

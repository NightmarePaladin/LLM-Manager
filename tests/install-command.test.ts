import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORMS, agentBaseUrl, buildInstallCommand, type PlatformId } from "@/lib/agent-config";
import { generateToken } from "@/lib/telemetry";

const REF = "0123456789abcdef0123456789abcdef01234567";
const TOKEN = generateToken();
const BASE = {
  apiUrl: "https://llm-manager-paladins2.vercel.app/api/telemetry",
  serverId: "a568fbb7-a3ab-4337-b6ad-f0cd927af07b",
  token: TOKEN,
  ref: REF,
};
const toPosix = (p: string) => p.replace(/\\/g, "/");
const tmp = () => toPosix(mkdtempSync(path.join(tmpdir(), "install-cmd-")));
const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(cmd, args, { env: { ...process.env, ...env }, encoding: "utf8" });

const hasBash = run("bash", ["-c", "true"]).status === 0;
const pwshProbe = run("pwsh", ["-NoProfile", "-Command", "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"]);
const hasPwsh = pwshProbe.status === 0 && process.platform === "win32";
const elevated = hasPwsh && pwshProbe.stdout.trim() === "True";

describe("platform list", () => {
  it("covers the popular Linux families, Windows and config-only, with unique ids", () => {
    const ids = PLATFORMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["linux-auto", "debian", "rhel", "arch", "suse", "windows", "linux-config"] as PlatformId[]) {
      expect(ids).toContain(id);
    }
    for (const p of PLATFORMS) {
      expect(p.label.length).toBeGreaterThan(5);
      expect(p.summary.length).toBeGreaterThan(20);
      expect(p.where.length).toBeGreaterThan(5);
    }
  });

  it("names the distributions people actually run", () => {
    const text = PLATFORMS.map((p) => p.label).join(" | ");
    for (const name of ["Ubuntu", "Debian", "Fedora", "Rocky", "AlmaLinux", "Arch", "openSUSE", "Proxmox", "Windows"]) {
      expect(text).toContain(name);
    }
  });
});

describe("agentBaseUrl", () => {
  it("pins to a full commit hash and otherwise falls back to main", () => {
    expect(agentBaseUrl(REF)).toBe(`https://raw.githubusercontent.com/NightmarePaladin/LLM-Manager/${REF}/agent`);
    for (const bad of [null, undefined, "", "main", "abc123", REF + "0", "../../evil", "HEAD"]) {
      expect(agentBaseUrl(bad)).toMatch(/\/LLM-Manager\/main\/agent$/);
    }
  });
});

describe("buildInstallCommand", () => {
  it.each(["linux-auto", "debian", "rhel", "arch", "suse"] as PlatformId[])("%s: one safe line that downloads the pinned installer", (platform) => {
    const cmd = buildInstallCommand({ platform, ...BASE });
    expect(cmd.startsWith(" ")).toBe(true); // keeps it out of shell history
    expect(cmd).not.toContain("\n");
    expect(cmd).toContain(`'${agentBaseUrl(REF)}/install.sh'`);
    expect(cmd).toContain("mktemp");
    expect(cmd).toContain("wget -qO"); // fallback when curl is missing
    expect(cmd).toContain("[ \"$(id -u)\" -eq 0 ] || echo sudo"); // sudo only when not already root
    expect(cmd).toContain(`LLM_MANAGER_TOKEN='${TOKEN}'`);
    expect(cmd).toContain(`LLM_MANAGER_AGENT_BASE='${agentBaseUrl(REF)}'`);
    expect(cmd).not.toContain("| bash"); // never pipes a download straight into a shell
  });

  it("forces the package manager only for apt, pacman and zypper families", () => {
    expect(buildInstallCommand({ platform: "debian", ...BASE })).toContain("LLM_MANAGER_PM='apt'");
    expect(buildInstallCommand({ platform: "arch", ...BASE })).toContain("LLM_MANAGER_PM='pacman'");
    expect(buildInstallCommand({ platform: "suse", ...BASE })).toContain("LLM_MANAGER_PM='zypper'");
    expect(buildInstallCommand({ platform: "rhel", ...BASE })).not.toContain("LLM_MANAGER_PM");
    expect(buildInstallCommand({ platform: "linux-auto", ...BASE })).not.toContain("LLM_MANAGER_PM");
  });

  it("windows: a PowerShell line with TLS 1.2, the settings, and the pinned install.ps1", () => {
    const cmd = buildInstallCommand({ platform: "windows", ...BASE });
    expect(cmd.startsWith(" ")).toBe(true);
    expect(cmd).not.toContain("\n");
    expect(cmd).toContain("SecurityProtocol");
    expect(cmd).toContain(`$env:LLM_MANAGER_TOKEN='${TOKEN}'`);
    expect(cmd).toContain(`$env:LLM_MANAGER_SERVER_ID='${BASE.serverId}'`);
    expect(cmd).toContain(`iex (irm '${agentBaseUrl(REF)}/install.ps1')`);
  });

  it("linux-config: the config-only command", () => {
    const cmd = buildInstallCommand({ platform: "linux-config", ...BASE, ollamaUrl: "http://127.0.0.1:11434" });
    expect(cmd).toContain("/etc/llm-manager-agent.env");
    expect(cmd).toContain("LLM_MANAGER_OLLAMA_URL=http://127.0.0.1:11434");
    expect(cmd).not.toContain("install.sh");
  });

  it("adds the Ollama setting only when requested, on every platform", () => {
    for (const platform of PLATFORMS.map((p) => p.id)) {
      expect(buildInstallCommand({ platform, ...BASE })).not.toContain("OLLAMA");
      expect(buildInstallCommand({ platform, ...BASE, ollamaUrl: "http://127.0.0.1:11434" })).toContain("LLM_MANAGER_OLLAMA_URL");
    }
  });

  it.each([
    ["quote in the token", { token: "lmt_x'; rm -rf /; '" }],
    ["space in the url", { apiUrl: "https://a.b/api telemetry" }],
    ["command substitution in the server id", { serverId: "$(whoami)" }],
    ["backtick in the url", { apiUrl: "https://a.b/`id`" }],
    ["newline in the token", { token: "lmt_a\nb" }],
    ["semicolon in the ollama url", { ollamaUrl: "http://x;y" }],
  ])("refuses unsafe values on every platform: %s", (_label, override) => {
    for (const platform of PLATFORMS.map((p) => p.id)) {
      expect(() => buildInstallCommand({ platform, ...BASE, ollamaUrl: "http://127.0.0.1:11434", ...override })).toThrow();
    }
  });

  it("rejects an unknown platform", () => {
    expect(() => buildInstallCommand({ platform: "plan9" as PlatformId, ...BASE })).toThrow(/unknown platform/);
  });
});

describe.skipIf(!hasBash)("generated Linux command, executed in bash with stubbed curl and sudo", () => {
  function sandbox(curlFails = false) {
    const dir = tmp();
    const log = `${dir}/calls.log`;
    const installSh = toPosix(path.resolve(process.cwd(), "agent", "install.sh"));
    const stub = (name: string, body: string) => {
      writeFileSync(`${dir}/${name}`, `#!/bin/sh\n${body}\n`);
      chmodSync(`${dir}/${name}`, 0o755);
    };
    // curl stub: records the URL, "downloads" the local install.sh into the -o target (or fails).
    stub("curl", curlFails
      ? `echo "curl $*" >> '${log}'; exit 22`
      : `url=""; out=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift;; http*) url="$1";; esac; shift; done; echo "curl $url -> $out" >> '${log}'; cp '${installSh}' "$out"`);
    stub("wget", `echo "wget $*" >> '${log}'; exit 4`);
    stub("sudo", `echo "sudo used" >> '${log}'; exec "$@"`);
    return { dir, log, path: `${dir}${path.delimiter}${process.env.PATH}` };
  }

  const osFile = (id: string) => {
    const f = `${tmp()}/os-release`;
    writeFileSync(f, `ID=${id}\n`);
    return f;
  };

  it("runs end to end: fetches the pinned installer, passes the settings, hides the token, cleans up", () => {
    const sb = sandbox();
    const cmd = buildInstallCommand({ platform: "debian", ...BASE, ollamaUrl: "http://127.0.0.1:11434" });
    const r = run("bash", ["-c", cmd], {
      PATH: sb.path,
      LLM_MANAGER_INSTALL_DRY_RUN: "1",
      LLM_MANAGER_OS_RELEASE: osFile("ubuntu"),
    });
    expect(r.status).toBe(0);
    const out = r.stdout + r.stderr;
    expect(out).toContain("LLM-Manager agent installer");
    expect(out).toContain("Package manager: apt");
    expect(out).toContain(`fetch ${agentBaseUrl(REF)}/llm_manager_agent.py`);
    expect(out).toContain("LLM_MANAGER_OLLAMA_URL");
    expect(out).not.toContain(TOKEN);
    const calls = readFileSync(sb.log, "utf8");
    expect(calls).toContain(`curl ${agentBaseUrl(REF)}/install.sh`);
    const target = /-> (\S+)/.exec(calls)![1];
    expect(existsSync(target)).toBe(false); // temp file removed afterwards
  });

  it("the forced package manager reaches the installer", () => {
    const sb = sandbox();
    const r = run("bash", ["-c", buildInstallCommand({ platform: "arch", ...BASE })], {
      PATH: sb.path, LLM_MANAGER_INSTALL_DRY_RUN: "1", LLM_MANAGER_OS_RELEASE: osFile("ubuntu"),
    });
    expect(r.stdout).toContain("Package manager: pacman");
  });

  it("does not run anything when the download fails (no curl, no wget)", () => {
    const sb = sandbox(true);
    const r = run("bash", ["-c", buildInstallCommand({ platform: "linux-auto", ...BASE })], {
      PATH: sb.path, LLM_MANAGER_INSTALL_DRY_RUN: "1", LLM_MANAGER_OS_RELEASE: osFile("ubuntu"),
    });
    expect(r.stdout).not.toContain("LLM-Manager agent installer");
    const calls = readFileSync(sb.log, "utf8");
    expect(calls).toContain("curl ");
    expect(calls).toContain("wget "); // fell back before giving up
    expect(calls).not.toContain("sudo used");
  });
});

describe.skipIf(!hasPwsh || elevated)("generated Windows command, executed in PowerShell (stops at the administrator check)", () => {
  it("parses via iex, validates the settings, and refuses to change anything when not elevated", () => {
    const installPs1 = path.resolve(process.cwd(), "agent", "install.ps1");
    const cmd = buildInstallCommand({ platform: "windows", ...BASE });
    // Replace the network download with the local file; everything else is the pasted command.
    // (An alias outranks a function of the same name, so re-point the irm alias itself.)
    const script = `function Get-LocalInstaller { param($u) Get-Content -Raw '${installPs1}' }\nSet-Alias -Name irm -Value Get-LocalInstaller -Scope Global -Force\n${cmd}`;
    const before = existsSync(path.join(process.env.ProgramData ?? "C:\\ProgramData", "LLM-Manager-Agent"));
    const r = run("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script]);
    const out = r.stdout + r.stderr;
    expect(out).toContain("LLM-Manager agent installer (Windows)");
    expect(out).toMatch(/Administrator/);
    expect(out).not.toContain(TOKEN);
    expect(r.status).not.toBe(0);
    expect(existsSync(path.join(process.env.ProgramData ?? "C:\\ProgramData", "LLM-Manager-Agent"))).toBe(before);
  });
});

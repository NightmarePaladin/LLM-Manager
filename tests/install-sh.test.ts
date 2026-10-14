import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateToken } from "@/lib/telemetry";

const bash = (script: string, env: Record<string, string> = {}) =>
  spawnSync("bash", ["-c", script], { env: { ...process.env, ...env }, encoding: "utf8" });

const hasBash = bash("true").status === 0;
const toPosix = (p: string) => p.replace(/\\/g, "/");
const INSTALL = toPosix(path.resolve(process.cwd(), "agent", "install.sh"));
const AGENT_DIR = toPosix(path.resolve(process.cwd(), "agent"));
const tmp = () => toPosix(mkdtempSync(path.join(tmpdir(), "install-sh-")));

const hasCmd = (c: string) => bash(`command -v ${c}`).status === 0;

/** Realistic /etc/os-release contents (trimmed to the fields the installer reads). */
const OS: Record<string, string> = {
  ubuntu: 'NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\nVERSION_ID="24.04"',
  debian: 'PRETTY_NAME="Debian GNU/Linux 12"\nID=debian\nVERSION_ID="12"',
  proxmox: 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nID=debian',
  mint: 'NAME="Linux Mint"\nID=linuxmint\nID_LIKE="ubuntu debian"',
  popos: 'NAME="Pop!_OS"\nID=pop\nID_LIKE="ubuntu debian"',
  raspbian: 'NAME="Raspbian GNU/Linux"\nID=raspbian\nID_LIKE=debian',
  fedora: 'NAME="Fedora Linux"\nID=fedora\nVERSION_ID=41',
  rocky: 'NAME="Rocky Linux"\nID="rocky"\nID_LIKE="rhel centos fedora"',
  alma: 'NAME="AlmaLinux"\nID="almalinux"\nID_LIKE="rhel centos fedora"',
  centos: 'NAME="CentOS Stream"\nID="centos"\nID_LIKE="rhel fedora"',
  rhel: 'NAME="Red Hat Enterprise Linux"\nID="rhel"\nID_LIKE="fedora"',
  amazon: 'NAME="Amazon Linux"\nID="amzn"\nID_LIKE="fedora"',
  arch: 'NAME="Arch Linux"\nID=arch',
  manjaro: 'NAME="Manjaro Linux"\nID=manjaro\nID_LIKE=arch',
  endeavour: 'NAME="EndeavourOS"\nID=endeavouros\nID_LIKE=arch',
  leap: 'NAME="openSUSE Leap"\nID="opensuse-leap"\nID_LIKE="suse opensuse"',
  tumbleweed: 'NAME="openSUSE Tumbleweed"\nID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"',
  sles: 'NAME="SLES"\nID="sles"\nID_LIKE="suse"',
  alpine: 'NAME="Alpine Linux"\nID=alpine',
};

function osRelease(name: string): string {
  const file = `${tmp()}/os-release`;
  writeFileSync(file, OS[name] + "\n");
  return file;
}

const detect = (name: string, extra: Record<string, string> = {}) =>
  bash(`LLM_MANAGER_INSTALL_SOURCE_ONLY=1 source '${INSTALL}'; detect_pm`, {
    LLM_MANAGER_OS_RELEASE: osRelease(name),
    LLM_MANAGER_PM: "",
    ...extra,
  });

const TOKEN = generateToken();
const GOOD = {
  LLM_MANAGER_API_URL: "https://llm-manager-paladins2.vercel.app/api/telemetry",
  LLM_MANAGER_SERVER_ID: "a568fbb7-a3ab-4337-b6ad-f0cd927af07b",
  LLM_MANAGER_TOKEN: TOKEN,
};

describe.skipIf(!hasBash)("agent/install.sh", () => {
  it("has valid bash syntax", () => {
    expect(bash(`bash -n '${INSTALL}'`).status).toBe(0);
  });

  it("uses Unix line endings (CRLF would break it on Linux)", () => {
    expect(readFileSync(path.join(process.cwd(), "agent", "install.sh"), "utf8")).not.toContain("\r");
  });

  describe("distro detection", () => {
    it.each([
      ["ubuntu", "apt"], ["debian", "apt"], ["proxmox", "apt"], ["mint", "apt"], ["popos", "apt"], ["raspbian", "apt"],
      ["arch", "pacman"], ["manjaro", "pacman"], ["endeavour", "pacman"],
      ["leap", "zypper"], ["tumbleweed", "zypper"], ["sles", "zypper"],
    ])("%s uses %s", (name, pm) => {
      const r = detect(name);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(pm);
    });

    it.each(["fedora", "rocky", "alma", "centos", "rhel", "amazon"])("%s uses dnf or yum", (name) => {
      const r = detect(name);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(hasCmd("dnf") ? "dnf" : "yum");
    });

    it("prefers dnf over yum when dnf exists", () => {
      const stub = tmp();
      writeFileSync(`${stub}/dnf`, "#!/bin/sh\nexit 0\n");
      chmodSync(`${stub}/dnf`, 0o755);
      const r = detect("rocky", { PATH: `${stub}${path.delimiter}${process.env.PATH}` });
      expect(r.stdout.trim()).toBe("dnf");
    });

    it("refuses Alpine with a clear reason (no systemd)", () => {
      const r = detect("alpine");
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/systemd/i);
    });

    it("honours LLM_MANAGER_PM and rejects unknown values", () => {
      expect(detect("ubuntu", { LLM_MANAGER_PM: "pacman" }).stdout.trim()).toBe("pacman");
      const bad = detect("ubuntu", { LLM_MANAGER_PM: "brew" });
      expect(bad.status).not.toBe(0);
      expect(bad.stderr).toMatch(/must be one of/);
    });
  });

  describe("input validation", () => {
    const validate = (env: Record<string, string>) =>
      bash(`LLM_MANAGER_INSTALL_SOURCE_ONLY=1 source '${INSTALL}'; validate_inputs`, {
        LLM_MANAGER_API_URL: "", LLM_MANAGER_SERVER_ID: "", LLM_MANAGER_TOKEN: "", LLM_MANAGER_OLLAMA_URL: "", ...env,
      });

    it("accepts good settings, with or without Ollama", () => {
      expect(validate(GOOD).status).toBe(0);
      expect(validate({ ...GOOD, LLM_MANAGER_OLLAMA_URL: "http://127.0.0.1:11434" }).status).toBe(0);
      expect(validate({ ...GOOD, LLM_MANAGER_API_URL: "http://localhost:3000/api/telemetry" }).status).toBe(0);
    });

    it.each([
      ["missing url", { LLM_MANAGER_API_URL: "" }],
      ["missing token", { LLM_MANAGER_TOKEN: "" }],
      ["missing server id", { LLM_MANAGER_SERVER_ID: "" }],
      ["plain http to a remote host", { LLM_MANAGER_API_URL: "http://example.com/api/telemetry" }],
      ["shell metacharacters in the url", { LLM_MANAGER_API_URL: "https://a.b/x;rm -rf /" }],
      ["command substitution in the url", { LLM_MANAGER_API_URL: "https://a.b/$(whoami)" }],
      ["bad server id", { LLM_MANAGER_SERVER_ID: "not-a-uuid" }],
      ["bad token", { LLM_MANAGER_TOKEN: "lmt_short" }],
      ["placeholder domain", { LLM_MANAGER_API_URL: "https://your-production-domain.vercel.app/api/telemetry" }],
      ["placeholder server id", { LLM_MANAGER_SERVER_ID: "00000000-0000-0000-0000-000000000000" }],
      ["unsafe ollama url", { LLM_MANAGER_OLLAMA_URL: "http://x;y" }],
      ["non-http ollama url", { LLM_MANAGER_OLLAMA_URL: "ftp://127.0.0.1" }],
    ])("rejects %s", (_label, override) => {
      const r = validate({ ...GOOD, ...override });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/ERROR/);
    });
  });

  describe("dry run", () => {
    const dry = (name: string, extra: Record<string, string> = {}) =>
      bash(`bash '${INSTALL}'`, {
        ...GOOD,
        LLM_MANAGER_INSTALL_DRY_RUN: "1",
        LLM_MANAGER_OS_RELEASE: osRelease(name),
        LLM_MANAGER_AGENT_BASE: "https://raw.githubusercontent.com/NightmarePaladin/LLM-Manager/0123456789abcdef0123456789abcdef01234567/agent",
        LLM_MANAGER_PM: "",
        ...extra,
      });

    it("plans every step and never prints the token", () => {
      const r = dry("ubuntu");
      expect(r.status).toBe(0);
      const out = r.stdout + r.stderr;
      expect(out).toContain("Package manager: apt");
      expect(out).toContain("-m venv /opt/llm-manager-agent/venv");
      expect(out).toContain("pip install");
      expect(out).toContain("LLM_MANAGER_TOKEN=<hidden>");
      expect(out).toContain("systemctl enable llm-manager-agent");
      expect(out).toContain("systemctl restart llm-manager-agent");
      expect(out).toContain("/0123456789abcdef0123456789abcdef01234567/agent/llm_manager_agent.py");
      expect(out).not.toContain(TOKEN);
      expect(out).not.toContain(TOKEN.slice(4));
    });

    it.each([
      ["ubuntu", "apt-get install", "python3-venv"],
      ["rocky", hasCmd("dnf") ? "dnf install" : "yum install", "python3-pip"],
      ["arch", "pacman -S", "python"],
      ["leap", "zypper --non-interactive install", "python3-pip"],
    ])("%s installs Python with its own package manager when needed", (name, command, pkg) => {
      const r = dry(name);
      expect(r.status).toBe(0);
      if (r.stdout.includes("Using existing Python")) return; // this machine already has a usable Python
      expect(r.stdout).toContain(command);
      expect(r.stdout).toContain(pkg);
    });

    it("includes the Ollama setting only when asked", () => {
      expect(dry("ubuntu").stdout).not.toContain("LLM_MANAGER_OLLAMA_URL");
      expect(dry("ubuntu", { LLM_MANAGER_OLLAMA_URL: "http://127.0.0.1:11434" }).stdout).toContain("LLM_MANAGER_OLLAMA_URL");
    });

    it("fails fast on Alpine and on bad settings, before changing anything", () => {
      const alpine = dry("alpine");
      expect(alpine.status).not.toBe(0);
      expect(alpine.stdout).not.toContain("+ ");
      const bad = dry("ubuntu", { LLM_MANAGER_TOKEN: "nope" });
      expect(bad.status).not.toBe(0);
      expect(bad.stdout).not.toContain("+ ");
    });
  });

  describe("config file writing", () => {
    const run = (envFile: string, extra: Record<string, string> = {}) =>
      bash(`LLM_MANAGER_INSTALL_SOURCE_ONLY=1 source '${INSTALL}'; write_config`, {
        ...GOOD, LLM_MANAGER_ENV_FILE: envFile, LLM_MANAGER_INSTALL_DRY_RUN: "0", LLM_MANAGER_OLLAMA_URL: "", ...extra,
      });

    it("creates the file with the three settings and owner-only permissions", () => {
      const file = `${tmp()}/agent.env`;
      expect(run(file).status).toBe(0);
      const text = readFileSync(file, "utf8");
      expect(text).toContain(`LLM_MANAGER_API_URL=${GOOD.LLM_MANAGER_API_URL}\n`);
      expect(text).toContain(`LLM_MANAGER_SERVER_ID=${GOOD.LLM_MANAGER_SERVER_ID}\n`);
      expect(text).toContain(`LLM_MANAGER_TOKEN=${TOKEN}\n`);
      expect(text).not.toContain("OLLAMA");
      if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    });

    it("updates an existing file in place: replaces keys once, keeps everything else, idempotent", () => {
      const file = `${tmp()}/agent.env`;
      writeFileSync(file, "# mine\nLLM_MANAGER_API_URL=https://your-production-domain.vercel.app/api/telemetry\nLLM_MANAGER_TOKEN=old\nLLM_MANAGER_INTERVAL=45\n");
      const newToken = generateToken();
      expect(run(file, { LLM_MANAGER_TOKEN: newToken, LLM_MANAGER_OLLAMA_URL: "http://127.0.0.1:11434" }).status).toBe(0);
      expect(run(file, { LLM_MANAGER_TOKEN: newToken, LLM_MANAGER_OLLAMA_URL: "http://127.0.0.1:11434" }).status).toBe(0);
      const lines = readFileSync(file, "utf8").trim().split("\n");
      expect(lines).toContain("# mine");
      expect(lines).toContain("LLM_MANAGER_INTERVAL=45");
      for (const key of ["LLM_MANAGER_API_URL", "LLM_MANAGER_SERVER_ID", "LLM_MANAGER_TOKEN", "LLM_MANAGER_OLLAMA_URL"]) {
        expect(lines.filter((l) => l.startsWith(`${key}=`))).toHaveLength(1);
      }
      expect(lines).toContain(`LLM_MANAGER_TOKEN=${newToken}`);
      expect(lines.join("\n")).not.toContain("old");
      expect(lines.join("\n")).not.toContain("your-production-domain");
    });

    it("keeps an existing Ollama line when this run does not set one", () => {
      const file = `${tmp()}/agent.env`;
      writeFileSync(file, "LLM_MANAGER_OLLAMA_URL=http://10.0.0.5:11434\n");
      expect(run(file).status).toBe(0);
      expect(readFileSync(file, "utf8")).toContain("LLM_MANAGER_OLLAMA_URL=http://10.0.0.5:11434");
    });
  });

  describe("fetch", () => {
    it("copies agent files from a local directory and fails on a missing one", () => {
      const dest = `${tmp()}/agent.py`;
      const ok = bash(`LLM_MANAGER_INSTALL_SOURCE_ONLY=1 source '${INSTALL}'; fetch llm_manager_agent.py '${dest}'`, {
        LLM_MANAGER_AGENT_BASE: AGENT_DIR, LLM_MANAGER_INSTALL_DRY_RUN: "0",
      });
      expect(ok.status).toBe(0);
      expect(readFileSync(dest, "utf8")).toContain("AGENT_VERSION");
      const missing = bash(`LLM_MANAGER_INSTALL_SOURCE_ONLY=1 source '${INSTALL}'; fetch nope.py '${dest}'`, {
        LLM_MANAGER_AGENT_BASE: AGENT_DIR, LLM_MANAGER_INSTALL_DRY_RUN: "0",
      });
      expect(missing.status).not.toBe(0);
    });
  });
});

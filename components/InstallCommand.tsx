"use client";

import { useState } from "react";
import { CopyField } from "@/components/CopyField";
import { DEFAULT_OLLAMA_URL, PLATFORMS, buildInstallCommand, type PlatformId } from "@/lib/agent-config";

/** Platform picker plus the one pasteable command that installs (or updates) the agent there. */
export function InstallCommand({
  apiUrl,
  serverId,
  token,
  agentRef,
}: {
  apiUrl: string;
  serverId: string;
  token: string;
  agentRef: string | null;
}) {
  const [platform, setPlatform] = useState<PlatformId>("linux-auto");
  const [ollama, setOllama] = useState(false);
  const def = PLATFORMS.find((p) => p.id === platform) ?? PLATFORMS[0];
  const groups = [...new Set(PLATFORMS.map((p) => p.group))];

  let command = "";
  let problem: string | null = null;
  try {
    command = buildInstallCommand({ platform, apiUrl, serverId, token, ref: agentRef, ollamaUrl: ollama ? DEFAULT_OLLAMA_URL : null });
  } catch (e) {
    problem = e instanceof Error ? e.message : "Could not build the command";
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="install-platform" className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
          Install on
        </label>
        <select
          id="install-platform"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as PlatformId)}
          className="input"
        >
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {PLATFORMS.filter((p) => p.group === g).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={ollama}
          onChange={(e) => setOllama(e.target.checked)}
          className="size-4 accent-[var(--color-accent)]"
        />
        This machine runs Ollama (report its status and loaded models)
      </label>

      {problem ? (
        <p role="alert" className="alert">{problem}</p>
      ) : (
        <>
          <CopyField label="Install command" value={command} hint={`paste into ${def.where}`} />
          <p className="text-xs text-muted">{def.summary}</p>
        </>
      )}
      <p className="text-xs text-muted">
        The command contains this server&apos;s token, so treat it like a password. It starts with a space so it stays out of
        your shell history. Re-running it later updates the agent.
      </p>
    </div>
  );
}

"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { createAgentToken, type TokenState } from "@/app/(app)/servers/agent-actions";

export function AgentTokenPanel({ serverId }: { serverId: string }) {
  const [state, action, pending] = useActionState<TokenState, FormData>(
    () => createAgentToken(serverId),
    {}
  );

  return (
    <div className="space-y-3">
      <form action={action}>
        <button type="submit" disabled={pending} className="btn-secondary">
          <KeyRound className="size-4" aria-hidden />
          {pending ? "Generating…" : "Generate agent token"}
        </button>
      </form>
      {state.error && <p role="alert" className="alert">{state.error}</p>}
      {state.token && (
        <div className="space-y-2">
          <p className="text-xs text-amber-400">Copy this token now. It is shown once and cannot be recovered.</p>
          <code className="block break-all rounded-md border border-line bg-surface-2 p-3 font-mono text-xs text-zinc-100 select-all">
            {state.token}
          </code>
          <p className="text-xs text-muted">
            Server ID: <span className="font-mono select-all">{serverId}</span>
          </p>
        </div>
      )}
    </div>
  );
}

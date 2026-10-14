"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { createAgentToken, type TokenState } from "@/app/(app)/servers/agent-actions";
import { CopyField } from "@/components/CopyField";

export function AgentTokenPanel({ serverId, apiUrl }: { serverId: string; apiUrl: string }) {
  const [state, action, pending] = useActionState<TokenState, FormData>(
    () => createAgentToken(serverId),
    {}
  );

  return (
    <div className="w-full space-y-4">
      <div className="space-y-3">
        <p className="text-xs text-muted">
          Put these three values in <span className="font-mono">/etc/llm-manager-agent.env</span> on the server.
        </p>
        <CopyField label="API URL" value={apiUrl} hint="LLM_MANAGER_API_URL" />
        <CopyField label="Server ID" value={serverId} hint="LLM_MANAGER_SERVER_ID" />
        {state.token ? (
          <div className="space-y-2">
            <CopyField label="Agent token" value={state.token} hint="LLM_MANAGER_TOKEN" />
            <p className="text-xs text-amber-400">Copy this token now. It is shown once and cannot be recovered.</p>
          </div>
        ) : (
          <p className="text-xs text-muted">The token is created below and is shown only once.</p>
        )}
      </div>

      <form action={action}>
        <button type="submit" disabled={pending} className="btn-secondary">
          <KeyRound className="size-4" aria-hidden />
          {pending ? "Generating…" : state.token ? "Generate another token" : "Generate agent token"}
        </button>
      </form>
      {state.error && <p role="alert" className="alert">{state.error}</p>}
    </div>
  );
}

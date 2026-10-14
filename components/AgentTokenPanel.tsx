"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { createAgentToken, type TokenState } from "@/app/(app)/servers/agent-actions";
import { CopyField } from "@/components/CopyField";
import { InstallCommand } from "@/components/InstallCommand";

export function AgentTokenPanel({
  serverId,
  apiUrl,
  agentRef,
}: {
  serverId: string;
  apiUrl: string;
  agentRef: string | null;
}) {
  const [state, action, pending] = useActionState<TokenState, FormData>(
    () => createAgentToken(serverId),
    {}
  );

  return (
    <div className="w-full space-y-4">
      <div className="space-y-3">
        <p className="text-xs text-muted">
          Generate a token to get a ready-to-paste install command for Linux or Windows. The three values are also here
          if you prefer to set them up by hand.
        </p>
        <CopyField label="API URL" value={apiUrl} hint="LLM_MANAGER_API_URL" />
        <CopyField label="Server ID" value={serverId} hint="LLM_MANAGER_SERVER_ID" />
        {state.token ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <CopyField label="Agent token" value={state.token} hint="LLM_MANAGER_TOKEN" />
              <p className="text-xs text-amber-400">Copy this token now. It is shown once and cannot be recovered.</p>
            </div>
            <InstallCommand apiUrl={apiUrl} serverId={serverId} token={state.token} agentRef={agentRef} />
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

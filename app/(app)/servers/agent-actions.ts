"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { generateToken, hashToken } from "@/lib/telemetry";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TokenState = { token?: string; error?: string };

/** Creates a new agent token. The plaintext is returned once and never stored. */
export async function createAgentToken(serverId: string): Promise<TokenState> {
  if (!UUID_RE.test(serverId)) return { error: "Invalid server" };
  const { supabase } = await requireUser();

  // RLS also enforces ownership on insert; this gives a clear error message.
  const { data: server } = await supabase.from("servers").select("id").eq("id", serverId).maybeSingle();
  if (!server) return { error: "Server not found" };

  const token = generateToken();
  const { error } = await supabase
    .from("agent_tokens")
    .insert({ server_id: serverId, token_hash: hashToken(token), label: "agent" });
  if (error) return { error: "Could not create token" };

  revalidatePath(`/servers/${serverId}`);
  return { token };
}

export async function revokeAgentTokens(serverId: string): Promise<void> {
  if (!UUID_RE.test(serverId)) return;
  const { supabase } = await requireUser();
  await supabase
    .from("agent_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("server_id", serverId)
    .is("revoked_at", null);
  revalidatePath(`/servers/${serverId}`);
}

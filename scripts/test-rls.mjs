// Verifies Row Level Security on public.servers using two throwaway users.
// Usage: node --env-file=.env.local scripts/test-rls.mjs
// Requires "Confirm email" to be disabled in Supabase Auth so sign-up returns a session.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const newClient = () =>
  createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
}

async function makeUser(tag) {
  const client = newClient();
  const email = `rls-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomUUID();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error || !data.session) {
    throw new Error(`Sign-up failed for user ${tag}: ${error?.message ?? "no session (email confirmation on?)"}`);
  }
  return { client, id: data.user.id };
}

const a = await makeUser("a");
const b = await makeUser("b");
const anon = newClient();

// A creates a server (owner_id comes from the column default).
const ins = await a.client
  .from("servers")
  .insert({ name: "rls-a-server", hostname: "10.0.0.1", type: "vm", status: "online" })
  .select()
  .single();
check("A can insert own server", !ins.error && ins.data?.owner_id === a.id, ins.error?.message);
const serverId = ins.data?.id;

const aSel = await a.client.from("servers").select("id");
check("A can read own server", aSel.data?.some((r) => r.id === serverId));

const bSel = await b.client.from("servers").select("id");
check("B cannot see A's server in list", !bSel.error && !bSel.data.some((r) => r.id === serverId));

const bGet = await b.client.from("servers").select("id").eq("id", serverId);
check("B cannot fetch A's server by id", !bGet.error && bGet.data.length === 0);

const bUpd = await b.client.from("servers").update({ name: "hacked" }).eq("id", serverId).select();
check("B cannot update A's server", !bUpd.error && bUpd.data.length === 0);

const bDel = await b.client.from("servers").delete().eq("id", serverId).select();
check("B cannot delete A's server", !bDel.error && bDel.data.length === 0);

const spoof = await b.client
  .from("servers")
  .insert({ owner_id: a.id, name: "spoof", hostname: "10.0.0.2" })
  .select();
check("B cannot insert a row owned by A", !!spoof.error, spoof.error?.code);

const steal = await a.client.from("servers").update({ owner_id: b.id }).eq("id", serverId).select();
check("A cannot reassign ownership to B", !!steal.error || steal.data.length === 0, steal.error?.code);

const bad = await a.client.from("servers").insert({ name: "", hostname: "x" });
check("DB constraint rejects empty name", !!bad.error, bad.error?.code);

const anonSel = await anon.from("servers").select("id");
check("Anonymous sees no rows", !anonSel.error && anonSel.data.length === 0);

const anonIns = await anon.from("servers").insert({ name: "anon", hostname: "x" });
check("Anonymous cannot insert", !!anonIns.error, anonIns.error?.code);

const aUpd = await a.client.from("servers").update({ status: "offline" }).eq("id", serverId).select().single();
check("A can update own server; updated_at advances", aUpd.data?.status === "offline" && aUpd.data.updated_at > aUpd.data.created_at, aUpd.error?.message);

const aDel = await a.client.from("servers").delete().eq("id", serverId).select();
check("A can delete own server", !aDel.error && aDel.data.length === 1);

console.log(failures === 0 ? "\nAll RLS checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

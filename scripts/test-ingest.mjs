// End-to-end check of telemetry ingestion and its security, against a running app.
// Usage (after applying migration 0002 and starting `npm run dev`):
//   node --env-file=.env.local scripts/test-ingest.mjs [http://localhost:3000]
// Requires "Confirm email" disabled in Supabase Auth. Creates throwaway users and
// deletes only the servers it created.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { generateToken, hashToken } from "../lib/telemetry.ts";

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
const BASE = process.argv[2] ?? "http://localhost:3000";
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
};
const newClient = () => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });

async function makeUser(tag) {
  const client = newClient();
  const { data, error } = await client.auth.signUp({
    email: `ingest-${tag}-${randomUUID().slice(0, 8)}@example.com`,
    password: randomUUID(),
  });
  if (error || !data.session) throw new Error(`Sign-up failed: ${error?.message ?? "no session"}`);
  return client;
}

async function makeServer(client, name) {
  const { data, error } = await client.from("servers").insert({ name, hostname: "10.0.0.9", type: "vm" }).select("id").single();
  if (error) throw new Error(error.message);
  const token = generateToken();
  const ins = await client.from("agent_tokens").insert({ server_id: data.id, token_hash: hashToken(token) });
  if (ins.error) throw new Error(ins.error.message);
  return { id: data.id, token };
}

const post = (token, body) =>
  fetch(`${BASE}/api/telemetry`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const a = await makeUser("a");
const b = await makeUser("b");
const sa = await makeServer(a, "ingest-a");
const sb = await makeServer(b, "ingest-b");
const metrics = { cpu_percent: 12.5, ram_percent: 40, disk_percent: 55, net_rx_bps: 1000, net_tx_bps: null, agent_version: "test" };

let r = await post(sa.token, { server_id: sa.id, metrics });
check("valid token + metrics accepted (200)", r.status === 200, String(r.status));

const rows = await a.from("server_metrics").select("*").eq("server_id", sa.id);
check("reading persisted with DB timestamp", rows.data?.length === 1 && !!rows.data[0].recorded_at);
check("available values stored exactly", rows.data?.[0]?.cpu_percent === 12.5 && rows.data[0].disk_percent === 55);
check("unavailable metric stored as NULL, not zero", rows.data?.[0]?.net_tx_bps === null && rows.data[0].ram_used_bytes === null);

r = await post(sa.token, { server_id: sa.id, metrics });
check("second report within 5 s is rate limited (429)", r.status === 429, String(r.status));

r = await post(null, { server_id: sa.id, metrics });
check("missing token rejected (401)", r.status === 401, String(r.status));
r = await post(generateToken(), { server_id: sa.id, metrics });
check("unknown token rejected (401)", r.status === 401, String(r.status));
r = await post("garbage", { server_id: sa.id, metrics });
check("malformed token rejected (401)", r.status === 401, String(r.status));
r = await post(sb.token, { server_id: sa.id, metrics });
check("a token for a different server cannot write to this server (401)", r.status === 401, String(r.status));
r = await post(sa.token, { server_id: sa.id, metrics: { cpu_percent: 500 } });
check("out-of-range metric rejected (400)", r.status === 400, String(r.status));
r = await post(sa.token, "{not json");
check("invalid JSON rejected (400)", r.status === 400, String(r.status));

const bRead = await b.from("server_metrics").select("id").eq("server_id", sa.id);
check("user B cannot read A metrics", !bRead.error && bRead.data.length === 0);
const bInsert = await b.from("server_metrics").insert({ server_id: sb.id, cpu_percent: 1 });
check("users cannot insert metrics directly", !!bInsert.error, bInsert.error?.code);
const bTokens = await b.from("agent_tokens").select("id").eq("server_id", sa.id);
check("user B cannot see A tokens", !bTokens.error && bTokens.data.length === 0);
const bMint = await b.from("agent_tokens").insert({ server_id: sa.id, token_hash: hashToken(generateToken()) });
check("user B cannot mint a token for A server", !!bMint.error, bMint.error?.code);
const anonRead = await newClient().from("server_metrics").select("id");
check("anonymous cannot read metrics", !anonRead.error && anonRead.data.length === 0);
const anonRpc = await newClient().rpc("ingest_telemetry", { p_server_id: sa.id, p_token_hash: "0".repeat(64), p_metrics: {} });
check("direct RPC with a bad hash returns invalid_token", anonRpc.data === "invalid_token", String(anonRpc.data));

await a.from("agent_tokens").update({ revoked_at: new Date().toISOString() }).eq("server_id", sa.id);
await new Promise((res) => setTimeout(res, 5500));
r = await post(sa.token, { server_id: sa.id, metrics });
check("revoked token rejected (401)", r.status === 401, String(r.status));

await a.from("servers").delete().eq("id", sa.id);
await b.from("servers").delete().eq("id", sb.id);
console.log(failures === 0 ? "\nAll ingestion checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

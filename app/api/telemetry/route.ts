import { createClient } from "@supabase/supabase-js";
import { hashToken, normaliseMetrics, parseBearer, telemetryBodySchema } from "@/lib/telemetry";

const MAX_BODY_BYTES = 16 * 1024;

const json = (body: Record<string, unknown>, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Connectivity check for installers: confirms this URL is an LLM-Manager dashboard.
 * Public and read-only; it reveals nothing beyond the (public) commit this build came from.
 */
export async function GET() {
  const ref = process.env.VERCEL_GIT_COMMIT_SHA;
  return json({ ok: true, service: "llm-manager", ref: ref && /^[0-9a-f]{40}$/.test(ref) ? ref : null }, 200);
}

/**
 * Agent ingestion. Auth is a per-server bearer token; the DB function
 * ingest_telemetry() verifies its hash and inserts for that server only.
 * Uses the same publishable key as the rest of the app: no privileged key.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && request.headers.get("x-forwarded-proto") === "http") {
    return json({ error: "HTTPS required" }, 400);
  }

  const token = parseBearer(request.headers.get("authorization"));
  if (!token) return json({ error: "Unauthorized" }, 401);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return json({ error: "Payload too large" }, 413);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "Payload too large" }, 413);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = telemetryBodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "Invalid telemetry", detail: parsed.error.issues[0]?.message ?? "invalid" }, 400);
  }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("ingest_telemetry", {
    p_server_id: parsed.data.server_id,
    p_token_hash: hashToken(token),
    p_metrics: normaliseMetrics(parsed.data.metrics),
  });

  if (error) {
    console.error("ingest_telemetry failed:", error.code);
    return json({ error: "Could not store telemetry" }, 500);
  }
  if (data === "invalid_token") return json({ error: "Unauthorized" }, 401);
  if (data === "rate_limited") return json({ error: "Too many reports" }, 429);

  return json({ ok: true }, 200);
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateToken, hashToken } from "@/lib/telemetry";

const rpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));

import { POST } from "@/app/api/telemetry/route";

const SERVER_ID = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";
const token = generateToken();
const metrics = { cpu_percent: 12.5, ram_percent: 40, net_tx_bps: null };

function req(opts: { token?: string | null; body?: unknown; headers?: Record<string, string> } = {}) {
  const auth = opts.token === undefined ? token : opts.token;
  const body = opts.body === undefined ? { server_id: SERVER_ID, metrics } : opts.body;
  return new Request("https://example.test/api/telemetry", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...opts.headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://placeholder.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "placeholder");
  rpc.mockReset();
  rpc.mockResolvedValue({ data: "ok", error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/telemetry", () => {
  it("accepts a valid report and passes the token hash, not the token, to the database", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("ingest_telemetry");
    expect(args.p_server_id).toBe(SERVER_ID);
    expect(args.p_token_hash).toBe(hashToken(token));
    expect(JSON.stringify(args)).not.toContain(token);
  });

  it("sends unavailable metrics to the database as null, not zero", async () => {
    await POST(req());
    const sent = rpc.mock.calls[0][1].p_metrics;
    expect(sent.cpu_percent).toBe(12.5);
    expect(sent.net_tx_bps).toBeNull();
    expect(sent.disk_percent).toBeNull();
  });

  it("passes Ollama status and loaded models through to the database", async () => {
    const models = [{ name: "llama3:8b", size_bytes: 6, size_vram_bytes: 5, parameter_size: "8B", quantization: "Q4_0" }];
    await POST(req({ body: { server_id: SERVER_ID, metrics: { ollama_up: true, ollama_version: "0.12.3", ollama_models: models } } }));
    const sent = rpc.mock.calls[0][1].p_metrics;
    expect(sent.ollama_up).toBe(true);
    expect(sent.ollama_version).toBe("0.12.3");
    expect(sent.ollama_models).toEqual([expect.objectContaining({ name: "llama3:8b", size_vram_bytes: 5 })]);
  });

  it("sends Ollama as null (not monitored) when the agent does not report it", async () => {
    await POST(req());
    const sent = rpc.mock.calls[0][1].p_metrics;
    expect(sent.ollama_up).toBeNull();
    expect(sent.ollama_models).toBeNull();
  });

  it("accepts a full 20-model report within the size limit", async () => {
    const models = Array.from({ length: 20 }, (_, i) => ({
      name: `model-${i}-`.padEnd(100, "x"), size_bytes: 1, size_vram_bytes: 1, parameter_size: "p".repeat(32), quantization: "q".repeat(32), expires_at: "e".repeat(64),
    }));
    const res = await POST(req({ body: { server_id: SERVER_ID, metrics: { ollama_up: true, ollama_models: models } } }));
    expect(res.status).toBe(200);
  });

  it.each([
    ["missing token", null],
    ["malformed token", "garbage"],
    ["wrong prefix", "abc_" + "A".repeat(43)],
  ])("rejects %s with 401 without touching the database", async (_label, bad) => {
    const res = await POST(req({ token: bad }));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 401 when the database says the token is invalid", async () => {
    rpc.mockResolvedValue({ data: "invalid_token", error: null });
    expect((await POST(req())).status).toBe(401);
  });

  it("returns 429 when the database rate limits", async () => {
    rpc.mockResolvedValue({ data: "rate_limited", error: null });
    expect((await POST(req())).status).toBe(429);
  });

  it("returns 500 without leaking details on a database error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret internal detail" } });
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret internal detail");
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["missing metrics", { server_id: SERVER_ID }],
    ["out-of-range cpu", { server_id: SERVER_ID, metrics: { cpu_percent: 500 } }],
    ["bad server id", { server_id: "nope", metrics }],
  ])("rejects %s with 400 without touching the database", async (_label, body) => {
    const res = await POST(req({ body }));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects oversized payloads with 413", async () => {
    const res = await POST(req({ body: { server_id: SERVER_ID, metrics: { agent_version: "x".repeat(20_000) } } }));
    expect(res.status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses plain HTTP in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(req({ headers: { "x-forwarded-proto": "http" } }));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never caches responses", async () => {
    expect((await POST(req())).headers.get("cache-control")).toBe("no-store");
  });
});

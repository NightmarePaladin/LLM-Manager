import { describe, expect, it } from "vitest";
import {
  STALE_AFTER_MS,
  generateToken,
  hashToken,
  monitoringState,
  normaliseMetrics,
  parseBearer,
  telemetryBodySchema,
} from "@/lib/telemetry";
import { formatAge, formatBytes, formatPercent, formatRate, formatUptime } from "@/lib/format";

const SERVER_ID = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";

describe("tokens", () => {
  it("generates unique, prefixed tokens that parseBearer accepts", () => {
    const a = generateToken();
    expect(a).not.toBe(generateToken());
    expect(a).toMatch(/^lmt_[A-Za-z0-9_-]{43}$/);
    expect(parseBearer(`Bearer ${a}`)).toBe(a);
  });

  it.each([null, "", "Bearer", "Bearer abc", `Basic ${"lmt_" + "A".repeat(43)}`])(
    "parseBearer rejects %j",
    (header) => {
      expect(parseBearer(header)).toBeNull();
    }
  );

  it("hashToken is a stable 64-char hex digest that never equals the token", () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toBe(t);
    expect(hashToken(t)).not.toBe(hashToken(generateToken()));
  });
});

describe("telemetry payload", () => {
  it("normalises absent metrics to null, never zero", () => {
    const parsed = telemetryBodySchema.parse({ server_id: SERVER_ID, metrics: { cpu_percent: 12.5 } });
    const n = normaliseMetrics(parsed.metrics);
    expect(n.cpu_percent).toBe(12.5);
    expect(n.ram_percent).toBeNull();
    expect(n.net_rx_bps).toBeNull();
    expect(n.agent_version).toBeNull();
  });

  it("preserves explicit nulls as unavailable", () => {
    const parsed = telemetryBodySchema.parse({ server_id: SERVER_ID, metrics: { cpu_percent: null, net_tx_bps: null } });
    expect(normaliseMetrics(parsed.metrics).net_tx_bps).toBeNull();
  });

  it.each([
    ["bad uuid", { server_id: "not-a-uuid", metrics: {} }],
    ["no metrics", { server_id: SERVER_ID }],
    ["cpu over 100", { server_id: SERVER_ID, metrics: { cpu_percent: 101 } }],
    ["cpu negative", { server_id: SERVER_ID, metrics: { cpu_percent: -1 } }],
    ["string metric", { server_id: SERVER_ID, metrics: { ram_percent: "50" } }],
    ["negative rate", { server_id: SERVER_ID, metrics: { net_rx_bps: -5 } }],
    ["fractional bytes", { server_id: SERVER_ID, metrics: { ram_used_bytes: 1.5 } }],
    ["infinite cpu", { server_id: SERVER_ID, metrics: { cpu_percent: Infinity } }],
    ["long version", { server_id: SERVER_ID, metrics: { agent_version: "x".repeat(33) } }],
  ])("rejects invalid payload: %s", (_label, body) => {
    expect(telemetryBodySchema.safeParse(body).success).toBe(false);
  });
});

describe("gpu and temperature fields", () => {
  it("accepts real values, including a genuine zero, and absent ones become null", () => {
    const parsed = telemetryBodySchema.parse({
      server_id: SERVER_ID,
      metrics: { gpu_percent: 0, vram_used_bytes: 0, vram_total_bytes: 17_163_091_968, gpu_temp_c: 52.5, gpu_hotspot_c: 61, cpu_temp_c: 48.2 },
    });
    const n = normaliseMetrics(parsed.metrics);
    expect(n.gpu_percent).toBe(0);
    expect(n.vram_used_bytes).toBe(0);
    expect(n.gpu_temp_c).toBe(52.5);
    const empty = normaliseMetrics(telemetryBodySchema.parse({ server_id: SERVER_ID, metrics: {} }).metrics);
    for (const key of ["gpu_percent", "vram_used_bytes", "vram_total_bytes", "gpu_temp_c", "gpu_hotspot_c", "cpu_temp_c"] as const) {
      expect(empty[key]).toBeNull();
    }
  });

  it.each([
    ["gpu over 100", { gpu_percent: 101 }],
    ["negative vram", { vram_used_bytes: -1 }],
    ["fractional vram", { vram_total_bytes: 1.5 }],
    ["absurd temperature", { gpu_temp_c: 900 }],
    ["freezing nonsense", { cpu_temp_c: -300 }],
    ["string temperature", { cpu_temp_c: "hot" }],
  ])("rejects invalid values: %s", (_label, metrics) => {
    expect(telemetryBodySchema.safeParse({ server_id: SERVER_ID, metrics }).success).toBe(false);
  });
});

describe("ollama fields", () => {
  const model = { name: "llama3:8b", size_bytes: 6_000_000_000, size_vram_bytes: 5_500_000_000, parameter_size: "8.0B", quantization: "Q4_0" };

  it("accepts running, down and not-monitored states", () => {
    for (const metrics of [
      { ollama_up: true, ollama_version: "0.12.3", ollama_models: [model] },
      { ollama_up: true, ollama_version: "0.12.3", ollama_models: [] },
      { ollama_up: false, ollama_version: null, ollama_models: null },
      { ollama_up: null, ollama_version: null, ollama_models: null },
      {},
    ]) {
      expect(telemetryBodySchema.safeParse({ server_id: SERVER_ID, metrics }).success).toBe(true);
    }
  });

  it("keeps false and an empty model list instead of turning them into null", () => {
    const down = normaliseMetrics(telemetryBodySchema.parse({ server_id: SERVER_ID, metrics: { ollama_up: false } }).metrics);
    expect(down.ollama_up).toBe(false);
    const empty = normaliseMetrics(telemetryBodySchema.parse({ server_id: SERVER_ID, metrics: { ollama_models: [] } }).metrics);
    expect(empty.ollama_models).toEqual([]);
    const absent = normaliseMetrics(telemetryBodySchema.parse({ server_id: SERVER_ID, metrics: {} }).metrics);
    expect(absent.ollama_up).toBeNull();
    expect(absent.ollama_models).toBeNull();
  });

  it.each([
    ["string up", { ollama_up: "yes" }],
    ["models not an array", { ollama_models: "llama3" }],
    ["model without a name", { ollama_models: [{ size_bytes: 1 }] }],
    ["negative size", { ollama_models: [{ ...model, size_bytes: -1 }] }],
    ["too many models", { ollama_models: Array.from({ length: 21 }, (_, i) => ({ name: `m${i}` })) }],
    ["long version", { ollama_version: "v".repeat(33) }],
  ])("rejects invalid ollama data: %s", (_label, metrics) => {
    expect(telemetryBodySchema.safeParse({ server_id: SERVER_ID, metrics }).success).toBe(false);
  });
});

describe("monitoringState", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("is online just under 90 s, stale at 90 s, not monitored without data", () => {
    expect(monitoringState(ago(5_000), now)).toBe("online");
    expect(monitoringState(ago(STALE_AFTER_MS - 1), now)).toBe("online");
    expect(monitoringState(ago(STALE_AFTER_MS), now)).toBe("stale");
    expect(monitoringState(null, now)).toBe("not_monitored");
    expect(monitoringState(undefined, now)).toBe("not_monitored");
  });
});

describe("formatting shows unavailable metrics as n/a, not zero", () => {
  it("handles null and undefined", () => {
    expect(formatPercent(null)).toBe("n/a");
    expect(formatBytes(undefined)).toBe("n/a");
    expect(formatRate(null)).toBe("n/a");
    expect(formatUptime(null)).toBe("n/a");
    expect(formatAge(null)).toBe("never");
  });

  it("formats real values, including a genuine zero", () => {
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatRate(1536)).toBe("1.5 KB/s");
    expect(formatUptime(90_000)).toBe("1d 1h");
    const now = Date.parse("2026-10-14T12:00:00Z");
    expect(formatAge(new Date(now - 45_000).toISOString(), now)).toBe("45s ago");
  });
});

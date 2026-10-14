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

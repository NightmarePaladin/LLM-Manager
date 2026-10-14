// Unit tests for lib/telemetry.ts. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STALE_AFTER_MS,
  generateToken,
  hashToken,
  monitoringState,
  normaliseMetrics,
  parseBearer,
  telemetryBodySchema,
} from "../lib/telemetry.ts";

const SERVER_ID = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";

test("generated tokens are unique, prefixed and accepted by parseBearer", () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b);
  assert.match(a, /^lmt_[A-Za-z0-9_-]{43}$/);
  assert.equal(parseBearer(`Bearer ${a}`), a);
});

test("parseBearer rejects missing, malformed and wrong-scheme headers", () => {
  assert.equal(parseBearer(null), null);
  assert.equal(parseBearer(""), null);
  assert.equal(parseBearer("Bearer"), null);
  assert.equal(parseBearer("Bearer abc"), null);
  assert.equal(parseBearer(`Basic ${generateToken()}`), null);
});

test("hashToken is a stable 64-char hex digest and never equals the token", () => {
  const t = generateToken();
  assert.equal(hashToken(t), hashToken(t));
  assert.match(hashToken(t), /^[0-9a-f]{64}$/);
  assert.notEqual(hashToken(t), t);
  assert.notEqual(hashToken(t), hashToken(generateToken()));
});

test("valid payload parses; absent metrics become null, not zero", () => {
  const parsed = telemetryBodySchema.parse({ server_id: SERVER_ID, metrics: { cpu_percent: 12.5 } });
  const n = normaliseMetrics(parsed.metrics);
  assert.equal(n.cpu_percent, 12.5);
  assert.equal(n.ram_percent, null);
  assert.equal(n.net_rx_bps, null);
  assert.equal(n.agent_version, null);
});

test("explicit nulls are preserved as unavailable", () => {
  const parsed = telemetryBodySchema.parse({ server_id: SERVER_ID, metrics: { cpu_percent: null, net_tx_bps: null } });
  assert.equal(normaliseMetrics(parsed.metrics).net_tx_bps, null);
});

test("invalid payloads are rejected", () => {
  const bad = [
    { server_id: "not-a-uuid", metrics: {} },
    { server_id: SERVER_ID },
    { server_id: SERVER_ID, metrics: { cpu_percent: 101 } },
    { server_id: SERVER_ID, metrics: { cpu_percent: -1 } },
    { server_id: SERVER_ID, metrics: { ram_percent: "50" } },
    { server_id: SERVER_ID, metrics: { net_rx_bps: -5 } },
    { server_id: SERVER_ID, metrics: { ram_used_bytes: 1.5 } },
    { server_id: SERVER_ID, metrics: { cpu_percent: Infinity } },
    { server_id: SERVER_ID, metrics: { agent_version: "x".repeat(33) } },
  ];
  for (const body of bad) assert.equal(telemetryBodySchema.safeParse(body).success, false, JSON.stringify(body));
});

test("monitoringState: online, stale at 90 s, not monitored without data", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  const ago = (ms) => new Date(now - ms).toISOString();
  assert.equal(monitoringState(ago(5_000), now), "online");
  assert.equal(monitoringState(ago(STALE_AFTER_MS - 1), now), "online");
  assert.equal(monitoringState(ago(STALE_AFTER_MS), now), "stale");
  assert.equal(monitoringState(null, now), "not_monitored");
  assert.equal(monitoringState(undefined, now), "not_monitored");
});

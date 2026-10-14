import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

/** A server with no valid report for this long is considered stale. */
export const STALE_AFTER_MS = 90_000;
/** Dashboard polling interval; matches the agent's 30 s reporting interval. */
export const REFRESH_INTERVAL_MS = 30_000;

export const TOKEN_PREFIX = "lmt_";

export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer (lmt_[A-Za-z0-9_-]{43})$/.exec(header.trim());
  return match ? match[1] : null;
}

const percent = z.number().min(0).max(100);
const nonNegative = z.number().min(0).finite();
const bytes = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const ollamaModelSchema = z.object({
  name: z.string().min(1).max(100),
  size_bytes: bytes.nullish(),
  size_vram_bytes: bytes.nullish(),
  parameter_size: z.string().max(32).nullish(),
  quantization: z.string().max(32).nullish(),
  expires_at: z.string().max(64).nullish(),
});

/**
 * Every metric is optional and nullable: a missing or null value means
 * "unavailable" and is stored as NULL, never as zero.
 */
export const metricsSchema = z.object({
  cpu_percent: percent.nullish(),
  ram_percent: percent.nullish(),
  ram_used_bytes: bytes.nullish(),
  ram_total_bytes: bytes.nullish(),
  disk_percent: percent.nullish(),
  disk_used_bytes: bytes.nullish(),
  disk_total_bytes: bytes.nullish(),
  net_tx_bps: nonNegative.nullish(),
  net_rx_bps: nonNegative.nullish(),
  uptime_seconds: bytes.nullish(),
  agent_version: z.string().max(32).nullish(),
  ollama_up: z.boolean().nullish(),
  ollama_version: z.string().max(32).nullish(),
  ollama_models: z.array(ollamaModelSchema).max(20).nullish(),
});

export const telemetryBodySchema = z.object({
  server_id: z.uuid(),
  metrics: metricsSchema,
});

export type Metrics = z.infer<typeof metricsSchema>;
export type OllamaModel = z.infer<typeof ollamaModelSchema>;

/** Normalises undefined to null so the DB function sees explicit nulls. */
export function normaliseMetrics(m: Metrics): Record<keyof Metrics, unknown> {
  const keys = Object.keys(metricsSchema.shape) as (keyof Metrics)[];
  return Object.fromEntries(keys.map((k) => [k, m[k] ?? null])) as Record<keyof Metrics, unknown>;
}

export type MonitoringState = "online" | "stale" | "not_monitored";

export function monitoringState(lastReportedAt: string | null | undefined, now: number = Date.now()): MonitoringState {
  if (!lastReportedAt) return "not_monitored";
  const age = now - new Date(lastReportedAt).getTime();
  return age < STALE_AFTER_MS ? "online" : "stale";
}

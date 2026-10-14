/** Pure helpers for the history charts (no React, no dates from the environment). */

export type Range = "1h" | "24h" | "7d";

export const RANGES: Record<Range, { hours: number; buckets: number; label: string }> = {
  "1h": { hours: 1, buckets: 60, label: "1 hour" },
  "24h": { hours: 24, buckets: 96, label: "24 hours" },
  "7d": { hours: 168, buckets: 168, label: "7 days" },
};

export function parseRange(value: string | undefined): Range {
  return value === "1h" || value === "24h" || value === "7d" ? value : "24h";
}

/** One bucket from get_metric_history; null means the metric was unavailable. */
export type HistoryRow = {
  bucket: string;
  samples: number;
  cpu_percent: number | null;
  ram_percent: number | null;
  disk_percent: number | null;
  net_rx_bps: number | null;
  net_tx_bps: number | null;
  gpu_percent: number | null;
  vram_percent: number | null;
  cpu_temp_c: number | null;
  gpu_temp_c: number | null;
};

/** Rounds up to a "nice" axis maximum: 1, 2, 5 or 10 times a power of ten. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const f = value / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * base;
}

/** Like niceMax, but nice in binary units so byte rates label cleanly (e.g. 512 KB/s). */
export function niceMaxBytes(value: number): number {
  if (!(value > 0)) return 1;
  const unit = 1024 ** Math.max(0, Math.floor(Math.log(value) / Math.log(1024)));
  return niceMax(value / unit) * unit;
}

/** Axis range padded to whole degrees, never degenerate. */
export function tempDomain(values: number[]): [number, number] {
  if (values.length === 0) return [0, 100];
  const lo = Math.floor(Math.min(...values) - 3);
  const hi = Math.ceil(Math.max(...values) + 3);
  return hi - lo < 10 ? [lo, lo + 10] : [lo, hi];
}

export type Point = { t: number; v: number | null };

/**
 * Splits a series into runs of consecutive non-null points. A run also ends when
 * the time between two points exceeds maxGapMs, so an offline agent shows as a gap
 * instead of a line drawn across the outage.
 */
export function segments(points: Point[], maxGapMs: number): { t: number; v: number }[][] {
  const runs: { t: number; v: number }[][] = [];
  let run: { t: number; v: number }[] = [];
  let lastT: number | null = null;
  for (const p of points) {
    if (p.v == null) {
      if (run.length) runs.push(run);
      run = [];
      lastT = null;
      continue;
    }
    if (lastT != null && p.t - lastT > maxGapMs && run.length) {
      runs.push(run);
      run = [];
    }
    run.push({ t: p.t, v: p.v });
    lastT = p.t;
  }
  if (run.length) runs.push(run);
  return runs;
}

/** SVG path data for one run, in a width x height box; area=true closes to the baseline. */
export function runPath(
  run: { t: number; v: number }[],
  x: (t: number) => number,
  y: (v: number) => number,
  baseline: number,
  area: boolean
): string {
  const pts = run.map((p) => `${x(p.t).toFixed(2)} ${y(p.v).toFixed(2)}`);
  if (run.length === 1) {
    // A lone sample is drawn as a dot (round cap on a zero-length line).
    const [px, py] = pts[0].split(" ");
    return area ? "" : `M${px} ${py} L${(Number(px) + 0.01).toFixed(2)} ${py}`;
  }
  const line = `M${pts.join(" L")}`;
  if (!area) return line;
  const first = x(run[0].t).toFixed(2);
  const last = x(run[run.length - 1].t).toFixed(2);
  return `${line} L${last} ${baseline} L${first} ${baseline} Z`;
}

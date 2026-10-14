import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MetricChart, type ChartSeries } from "@/components/MetricChart";
import { RANGES, type HistoryRow, type Range } from "@/lib/chart";
import { nowMs } from "@/lib/format";

// Categorical slots 1 and 2 (blue, orange), validated on the dark surface.
const BLUE = "#3987e5";
const ORANGE = "#d95926";

type ChartDef = { title: string; kind: "percent" | "rate" | "temp"; series: ChartSeries[] };

const has = (values: (number | null)[]) => values.some((v) => v != null);

export async function HistorySection({
  supabase,
  serverId,
  range,
}: {
  supabase: SupabaseClient;
  serverId: string;
  range: Range;
}) {
  const cfg = RANGES[range];
  const { data, error } = await supabase.rpc("get_metric_history", {
    p_server_id: serverId,
    p_hours: cfg.hours,
    p_buckets: cfg.buckets,
  });
  const rows = (data ?? []) as HistoryRow[];

  const now = nowMs();
  const startMs = now - cfg.hours * 3_600_000;
  const bucketMs = (cfg.hours * 3_600_000) / cfg.buckets;
  const times = rows.map((r) => new Date(r.bucket).getTime());
  const col = (key: keyof HistoryRow) => rows.map((r) => (r[key] as number | null) ?? null);

  const defs: ChartDef[] = [
    { title: "CPU usage", kind: "percent", series: [{ key: "cpu", label: "CPU", color: BLUE, values: col("cpu_percent") }] },
    { title: "Memory usage", kind: "percent", series: [{ key: "ram", label: "RAM", color: BLUE, values: col("ram_percent") }] },
    {
      title: "Network traffic",
      kind: "rate",
      series: [
        { key: "rx", label: "Download", color: BLUE, values: col("net_rx_bps") },
        { key: "tx", label: "Upload", color: ORANGE, values: col("net_tx_bps") },
      ],
    },
    { title: "GPU utilisation", kind: "percent", series: [{ key: "gpu", label: "GPU", color: BLUE, values: col("gpu_percent") }] },
    { title: "VRAM usage", kind: "percent", series: [{ key: "vram", label: "VRAM", color: BLUE, values: col("vram_percent") }] },
    {
      title: "Temperatures",
      kind: "temp",
      series: [
        { key: "cput", label: "CPU", color: BLUE, values: col("cpu_temp_c") },
        { key: "gput", label: "GPU", color: ORANGE, values: col("gpu_temp_c") },
      ],
    },
  ];
  // Drop charts, and series within them, that have no real data (never plot unavailable as zero).
  const charts = defs
    .map((c) => ({ ...c, series: c.series.filter((s) => has(s.values)) }))
    .filter((c) => c.series.length > 0);

  return (
    <section aria-labelledby="history-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="history-heading" className="text-sm font-semibold">History</h2>
        <nav aria-label="History range" className="flex gap-1">
          {(Object.keys(RANGES) as Range[]).map((r) => (
            <Link
              key={r}
              href={`?range=${r}`}
              scroll={false}
              aria-current={r === range ? "true" : undefined}
              className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                r === range
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-line bg-surface-2 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {RANGES[r].label}
            </Link>
          ))}
        </nav>
      </div>

      {error ? (
        <p role="alert" className="alert">History is unavailable right now: {error.message}</p>
      ) : charts.length === 0 ? (
        <div className="card p-5">
          <p className="text-sm text-muted">No readings in the last {cfg.label}. Charts appear once the agent has reported.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {charts.map((c) => (
            <MetricChart
              key={c.title}
              title={c.title}
              kind={c.kind}
              times={times}
              series={c.series}
              startMs={startMs}
              endMs={now}
              bucketMs={bucketMs}
              rangeLabel={cfg.label}
            />
          ))}
        </div>
      )}
    </section>
  );
}

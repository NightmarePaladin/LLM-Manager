import type { MonitoringState } from "@/lib/telemetry";

const STYLES: Record<MonitoringState, { label: string; pill: string; dot: string }> = {
  online: { label: "Online", pill: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20", dot: "bg-emerald-400" },
  stale: { label: "Stale", pill: "bg-amber-500/10 text-amber-400 ring-amber-500/20", dot: "bg-amber-400" },
  not_monitored: { label: "Not monitored", pill: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20", dot: "bg-zinc-500" },
};

export function MonitoringBadge({ state }: { state: MonitoringState }) {
  const s = STYLES[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.pill}`}
    >
      <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

import type { ServerMetric } from "@/lib/types";

/** Ollama state from the latest report: running, down, or not monitored (null). */
export function OllamaBadge({ metric }: { metric: ServerMetric | undefined }) {
  if (!metric || metric.ollama_up == null) {
    return <span className="text-xs text-muted" title="Ollama monitoring is not enabled for this server">—</span>;
  }
  const up = metric.ollama_up;
  const count = metric.ollama_models?.length;
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
          up ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20" : "bg-red-500/10 text-red-400 ring-red-500/20"
        }`}
      >
        <span className={`size-1.5 rounded-full ${up ? "bg-emerald-400" : "bg-red-400"}`} aria-hidden />
        {up ? "Running" : "Down"}
      </span>
      {up && count != null && (
        <span className="text-xs text-muted">{count === 0 ? "no models loaded" : `${count} loaded`}</span>
      )}
    </span>
  );
}

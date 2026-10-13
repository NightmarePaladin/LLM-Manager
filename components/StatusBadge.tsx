import type { ServerStatus } from "@/lib/types";

const STYLES: Record<ServerStatus, { pill: string; dot: string }> = {
  online: { pill: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20", dot: "bg-emerald-400" },
  offline: { pill: "bg-red-500/10 text-red-400 ring-red-500/20", dot: "bg-red-400" },
  unknown: { pill: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20", dot: "bg-zinc-500" },
};

export function StatusBadge({ status }: { status: ServerStatus }) {
  const s = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${s.pill}`}
    >
      <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden />
      {status}
    </span>
  );
}

import Link from "next/link";
import { Activity, CircleCheck, CircleHelp, Clock, Eye, Pencil, Plus, Server as ServerIcon } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { MonitoringBadge } from "@/components/MonitoringBadge";
import { AutoRefresh } from "@/components/AutoRefresh";
import { OllamaBadge } from "@/components/OllamaStatus";
import { formatAge, formatPercent, formatRate, nowMs } from "@/lib/format";
import { getLatestMetrics } from "@/lib/metrics";
import { REFRESH_INTERVAL_MS, monitoringState } from "@/lib/telemetry";
import type { Server } from "@/lib/types";

export default async function DashboardPage() {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase.from("servers").select("*").order("name").returns<Server[]>();
  const servers = data ?? [];
  const latest = await getLatestMetrics(supabase, servers.map((s) => s.id));

  // Monitoring state comes from the latest real report, never a manual field.
  const now = nowMs();
  const rows = servers.map((s) => {
    const m = latest.get(s.id);
    return { server: s, metric: m, state: monitoringState(m?.recorded_at, now) };
  });
  const count = (state: string) => rows.filter((r) => r.state === state).length;
  const pct = (n: number) => (servers.length === 0 ? "0%" : `${Math.round((n / servers.length) * 100)}%`);

  const name = user.email?.split("@")[0] ?? "there";
  const stats = [
    { label: "Total servers", value: servers.length, hint: "All registered servers", icon: ServerIcon, color: "text-zinc-300" },
    { label: "Online", value: count("online"), hint: `${pct(count("online"))} reported in the last 90 s`, icon: CircleCheck, color: "text-emerald-400" },
    { label: "Stale", value: count("stale"), hint: "No report for 90 s or more", icon: Clock, color: "text-amber-400" },
    { label: "Not monitored", value: count("not_monitored"), hint: "No agent report yet", icon: CircleHelp, color: "text-zinc-400" },
  ];

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={REFRESH_INTERVAL_MS} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back, <span className="text-accent">{name}</span>
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <Activity className="size-3.5" aria-hidden />
            Live readings from monitoring agents. Refreshes every 30 seconds.
          </p>
        </div>
        <Link href="/servers/new" className="btn-primary">
          <Plus className="size-4" aria-hidden />
          Add server
        </Link>
      </div>

      {error && <p role="alert" className="alert">Could not load servers: {error.message}</p>}

      <section aria-label="Statistics" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map(({ label, value, hint, icon: Icon, color }) => (
          <div key={label} className="card p-4">
            <div className="flex items-center justify-between text-sm text-muted">
              {label}
              <Icon className={`size-4 ${color}`} aria-hidden />
            </div>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{value}</p>
            <p className="mt-1 text-xs text-muted">{hint}</p>
          </div>
        ))}
      </section>

      <section className="card overflow-hidden" aria-labelledby="inventory-heading">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="inventory-heading" className="text-sm font-semibold">
            Server inventory
          </h2>
          <span className="text-xs text-muted">{servers.length} total</span>
        </div>

        {servers.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted">No servers yet.</p>
            <Link href="/servers/new" className="btn-primary mt-4">
              <Plus className="size-4" aria-hidden />
              Add your first server
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[72rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Host</th>
                  <th className="px-4 py-3 font-medium">Monitoring</th>
                  <th className="px-4 py-3 font-medium">Ollama</th>
                  <th className="px-4 py-3 font-medium">CPU</th>
                  <th className="px-4 py-3 font-medium">RAM</th>
                  <th className="px-4 py-3 font-medium">Disk</th>
                  <th className="px-4 py-3 font-medium">Network ↓ / ↑</th>
                  <th className="px-4 py-3 font-medium">Last report</th>
                  <th className="sticky right-0 bg-surface px-4 py-3 text-right font-medium shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.6)]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(({ server: s, metric: m, state }) => (
                  <tr key={s.id} className="transition-colors hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <Link href={`/servers/${s.id}`} className="font-medium text-zinc-100 hover:text-accent">
                        {s.name}
                      </Link>
                      <div className="text-xs capitalize text-muted">{s.type}{s.os ? ` · ${s.os}` : ""}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">{s.hostname}</td>
                    <td className="px-4 py-3">
                      <MonitoringBadge state={state} />
                    </td>
                    <td className="px-4 py-3">
                      <OllamaBadge metric={m} />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-zinc-300">{m ? formatPercent(m.cpu_percent) : "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-zinc-300">{m ? formatPercent(m.ram_percent) : "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-zinc-300">{m ? formatPercent(m.disk_percent) : "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-zinc-300">
                      {m ? `${formatRate(m.net_rx_bps)} / ${formatRate(m.net_tx_bps)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{formatAge(m?.recorded_at, now)}</td>
                    <td className="sticky right-0 bg-surface px-4 py-3 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.6)]">
                      <div className="flex justify-end gap-2">
                        <Link href={`/servers/${s.id}`} className="btn-secondary px-3 py-1.5" aria-label={`View details for ${s.name}`}>
                          <Eye className="size-4" aria-hidden />
                          Details
                        </Link>
                        <Link href={`/servers/${s.id}/edit`} className="btn-secondary px-3 py-1.5" aria-label={`Edit ${s.name}`}>
                          <Pencil className="size-4" aria-hidden />
                          Edit
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

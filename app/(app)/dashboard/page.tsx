import Link from "next/link";
import { CircleCheck, CircleHelp, CircleX, Plus, Server as ServerIcon } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import type { Server } from "@/lib/types";

export default async function DashboardPage() {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase.from("servers").select("*").order("name").returns<Server[]>();
  const servers = data ?? [];

  // Stats are tallied from the real rows RLS lets this user see.
  const count = (s: Server["status"]) => servers.filter((x) => x.status === s).length;
  const pct = (n: number) => (servers.length === 0 ? "0%" : `${Math.round((n / servers.length) * 100)}%`);

  const name = user.email?.split("@")[0] ?? "there";
  const stats = [
    { label: "Total servers", value: servers.length, hint: "All registered servers", icon: ServerIcon, color: "text-zinc-300" },
    { label: "Online", value: count("online"), hint: `${pct(count("online"))} of servers`, icon: CircleCheck, color: "text-emerald-400" },
    { label: "Offline", value: count("offline"), hint: `${pct(count("offline"))} of servers`, icon: CircleX, color: "text-red-400" },
    { label: "Unknown", value: count("unknown"), hint: `${pct(count("unknown"))} of servers`, icon: CircleHelp, color: "text-zinc-400" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back, <span className="text-accent">{name}</span>
          </h1>
          <p className="mt-1 text-sm text-muted">Status is set manually. Automated monitoring is a future feature.</p>
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
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Host</th>
                  <th className="px-4 py-3 font-medium">OS</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {servers.map((s) => (
                  <tr key={s.id} className="transition-colors hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <Link href={`/servers/${s.id}`} className="font-medium text-zinc-100 hover:text-accent">
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">{s.hostname}</td>
                    <td className="px-4 py-3 text-zinc-300">{s.os ?? "—"}</td>
                    <td className="px-4 py-3 capitalize text-zinc-300">{s.type}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={s.status} />
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

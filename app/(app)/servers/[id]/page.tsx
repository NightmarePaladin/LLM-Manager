import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { MonitoringBadge } from "@/components/MonitoringBadge";
import { AutoRefresh } from "@/components/AutoRefresh";
import { OllamaBadge } from "@/components/OllamaStatus";
import { HistorySection } from "@/components/HistorySection";
import { parseRange } from "@/lib/chart";
import { AgentTokenPanel } from "@/components/AgentTokenPanel";
import { UNAVAILABLE, formatAge, formatBytes, formatPercent, formatRate, formatTemp, formatUptime } from "@/lib/format";
import { getLatestMetrics } from "@/lib/metrics";
import { REFRESH_INTERVAL_MS, monitoringState } from "@/lib/telemetry";
import { revokeAgentTokens } from "@/app/(app)/servers/agent-actions";
import { deleteServer } from "@/app/(app)/servers/actions";
import type { Server } from "@/lib/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ServerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; range?: string }>;
}) {
  const { id } = await params;
  const { error, range: rangeParam } = await searchParams;
  const range = parseRange(rangeParam);
  if (!UUID_RE.test(id)) notFound();

  const { supabase } = await requireUser();

  // Absolute ingestion URL for the agent config, from whichever domain the user is on.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const apiUrl = `${proto}://${host}/api/telemetry`;
  const { data } = await supabase.from("servers").select("*").eq("id", id).maybeSingle<Server>();
  if (!data) notFound(); // another user's server also looks like this: RLS hides it

  const latest = (await getLatestMetrics(supabase, [id])).get(id);
  const state = monitoringState(latest?.recorded_at);
  const { data: tokens } = await supabase
    .from("agent_tokens")
    .select("id, created_at, last_used_at")
    .eq("server_id", id)
    .is("revoked_at", null);
  const readings: { label: string; value: string }[] = latest
    ? [
        { label: "CPU", value: formatPercent(latest.cpu_percent) },
        { label: "RAM", value: `${formatPercent(latest.ram_percent)} (${formatBytes(latest.ram_used_bytes)} / ${formatBytes(latest.ram_total_bytes)})` },
        { label: "Disk", value: `${formatPercent(latest.disk_percent)} (${formatBytes(latest.disk_used_bytes)} / ${formatBytes(latest.disk_total_bytes)})` },
        { label: "Network download", value: formatRate(latest.net_rx_bps) },
        { label: "Network upload", value: formatRate(latest.net_tx_bps) },
        { label: "Uptime", value: formatUptime(latest.uptime_seconds) },
        // Hardware readings only appear when the agent could read them (never as zero).
        ...(latest.cpu_temp_c != null ? [{ label: "CPU temperature", value: formatTemp(latest.cpu_temp_c) }] : []),
        ...(latest.gpu_percent != null ? [{ label: "GPU utilisation", value: formatPercent(latest.gpu_percent) }] : []),
        ...(latest.vram_total_bytes != null
          ? [
              {
                label: "VRAM",
                value: `${formatBytes(latest.vram_used_bytes)} / ${formatBytes(latest.vram_total_bytes)}${
                  latest.vram_used_bytes != null && latest.vram_total_bytes
                    ? ` (${((latest.vram_used_bytes / latest.vram_total_bytes) * 100).toFixed(1)}%)`
                    : ""
                }`,
              },
            ]
          : []),
        ...(latest.gpu_temp_c != null
          ? [
              {
                label: "GPU temperature",
                value: `${formatTemp(latest.gpu_temp_c)}${
                  latest.gpu_hotspot_c != null ? ` (hotspot ${formatTemp(latest.gpu_hotspot_c)})` : ""
                }`,
              },
            ]
          : []),
      ]
    : [];

  const fields: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    { label: "IP address / hostname", value: data.hostname, mono: true },
    { label: "Operating system", value: data.os ?? "—" },
    { label: "Type", value: <span className="capitalize">{data.type}</span> },
    { label: "Monitoring", value: <MonitoringBadge state={state} /> },
    { label: "Last report", value: formatAge(latest?.recorded_at) },
    { label: "Created", value: new Date(data.created_at).toLocaleString() },
    { label: "Last updated", value: new Date(data.updated_at).toLocaleString() },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <AutoRefresh intervalMs={REFRESH_INTERVAL_MS} />
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-white">
        <ArrowLeft className="size-4" aria-hidden />
        Dashboard
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
        <Link href={`/servers/${id}/edit`} className="btn-secondary">
          <Pencil className="size-4" aria-hidden />
          Edit
        </Link>
      </div>

      {error && <p role="alert" className="alert">{error}</p>}

      <section className="card p-5">
        <dl className="grid gap-5 sm:grid-cols-2">
          {fields.map(({ label, value, mono }) => (
            <div key={label}>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted">{label}</dt>
              <dd className={`mt-1 text-sm text-zinc-100 ${mono ? "font-mono" : ""}`}>{value}</dd>
            </div>
          ))}
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wider text-muted">Description</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm text-zinc-100">{data.description ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="card p-5" aria-labelledby="readings-heading">
        <h2 id="readings-heading" className="text-sm font-semibold">Latest readings</h2>
        {readings.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No data yet. Generate an agent token below and start the agent on this server.</p>
        ) : (
          <dl className="mt-3 grid gap-4 sm:grid-cols-2">
            {readings.map(({ label, value }) => (
              <div key={label}>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted">{label}</dt>
                <dd className="mt-1 text-sm tabular-nums text-zinc-100">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <HistorySection supabase={supabase} serverId={id} range={range} />

      {latest?.ollama_up != null && (
        <section className="card p-5" aria-labelledby="ollama-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="ollama-heading" className="text-sm font-semibold">Ollama</h2>
            <div className="flex items-center gap-3 text-xs text-muted">
              {latest.ollama_version && <span>Version {latest.ollama_version}</span>}
              <OllamaBadge metric={latest} />
            </div>
          </div>
          {!latest.ollama_up ? (
            <p className="mt-3 text-sm text-muted">The Ollama API did not answer on the last report.</p>
          ) : latest.ollama_models == null ? (
            <p className="mt-3 text-sm text-muted">Ollama is running, but the loaded model list was unavailable.</p>
          ) : latest.ollama_models.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Ollama is running with no models loaded in memory.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted">
                  <tr className="border-b border-line">
                    <th className="py-2 pr-4 font-medium">Model</th>
                    <th className="py-2 pr-4 font-medium">Size</th>
                    <th className="py-2 pr-4 font-medium">In VRAM</th>
                    <th className="py-2 font-medium">Parameters / quant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {latest.ollama_models.map((m) => (
                    <tr key={m.name}>
                      <td className="py-2 pr-4 font-mono text-xs text-zinc-100">{m.name}</td>
                      <td className="py-2 pr-4 tabular-nums text-zinc-300">{formatBytes(m.size_bytes)}</td>
                      <td className="py-2 pr-4 tabular-nums text-zinc-300">
                        {m.size_vram_bytes == null
                          ? UNAVAILABLE
                          : `${formatBytes(m.size_vram_bytes)}${
                              m.size_bytes ? ` (${Math.round((m.size_vram_bytes / m.size_bytes) * 100)}%)` : ""
                            }`}
                      </td>
                      <td className="py-2 text-zinc-300">
                        {[m.parameter_size, m.quantization].filter(Boolean).join(" · ") || UNAVAILABLE}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="card p-5" aria-labelledby="agent-heading">
        <h2 id="agent-heading" className="text-sm font-semibold">Monitoring agent</h2>
        <p className="mt-1 text-sm text-muted">
          Active tokens: {tokens?.length ?? 0}. Generating a token does not revoke existing ones.
        </p>
        <div className="mt-4 space-y-4">
          <AgentTokenPanel serverId={id} apiUrl={apiUrl} />
          {(tokens?.length ?? 0) > 0 && (
            <form action={revokeAgentTokens.bind(null, id)}>
              <button type="submit" className="btn-secondary">Revoke all tokens</button>
            </form>
          )}
        </div>
      </section>

      <section className="card border-red-500/20 p-5">
        <h2 className="text-sm font-semibold text-red-400">Danger zone</h2>
        <p className="mt-1 text-sm text-muted">Deleting a server permanently removes it from your inventory.</p>
        <details className="mt-4">
          <summary className="btn-secondary w-fit list-none">
            <Trash2 className="size-4" aria-hidden />
            Delete server…
          </summary>
          <form action={deleteServer.bind(null, id)} className="mt-3 flex items-center gap-3">
            <button type="submit" className="btn-danger">
              Yes, delete {data.name}
            </button>
            <span className="text-xs text-muted">This cannot be undone.</span>
          </form>
        </details>
      </section>
    </div>
  );
}

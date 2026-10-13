import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { deleteServer } from "@/app/(app)/servers/actions";
import type { Server } from "@/lib/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ServerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  if (!UUID_RE.test(id)) notFound();

  const { supabase } = await requireUser();
  const { data } = await supabase.from("servers").select("*").eq("id", id).maybeSingle<Server>();
  if (!data) notFound(); // another user's server also looks like this: RLS hides it

  const fields: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    { label: "IP address / hostname", value: data.hostname, mono: true },
    { label: "Operating system", value: data.os ?? "—" },
    { label: "Type", value: <span className="capitalize">{data.type}</span> },
    { label: "Status", value: <StatusBadge status={data.status} /> },
    { label: "Created", value: new Date(data.created_at).toLocaleString() },
    { label: "Last updated", value: new Date(data.updated_at).toLocaleString() },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
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

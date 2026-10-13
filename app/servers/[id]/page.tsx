import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { deleteServer } from "@/app/servers/actions";
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

  return (
    <main>
      <p>
        <Link href="/dashboard">← Dashboard</Link>
      </p>
      <h1>{data.name}</h1>
      {error && <p role="alert">{error}</p>}
      <dl>
        <dt>IP address / hostname</dt>
        <dd>{data.hostname}</dd>
        <dt>Operating system</dt>
        <dd>{data.os ?? "—"}</dd>
        <dt>Type</dt>
        <dd>{data.type}</dd>
        <dt>Status</dt>
        <dd>
          <StatusBadge status={data.status} />
        </dd>
        <dt>Description</dt>
        <dd>{data.description ?? "—"}</dd>
        <dt>Created</dt>
        <dd>{new Date(data.created_at).toLocaleString()}</dd>
        <dt>Updated</dt>
        <dd>{new Date(data.updated_at).toLocaleString()}</dd>
      </dl>
      <p>
        <Link href={`/servers/${id}/edit`}>Edit</Link>
      </p>
      <form action={deleteServer.bind(null, id)}>
        <button type="submit">Delete server</button>
      </form>
    </main>
  );
}

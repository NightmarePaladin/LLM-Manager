import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ServerForm } from "@/components/ServerForm";
import { updateServer } from "@/app/servers/actions";
import type { Server } from "@/lib/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditServerPage({
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
  if (!data) notFound();

  return (
    <main>
      <p>
        <Link href={`/servers/${id}`}>← Back to details</Link>
      </p>
      <h1>Edit {data.name}</h1>
      {error && <p role="alert">{error}</p>}
      <ServerForm action={updateServer.bind(null, id)} server={data} submitLabel="Save changes" />
    </main>
  );
}

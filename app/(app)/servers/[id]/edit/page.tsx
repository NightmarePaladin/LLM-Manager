import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { ServerForm } from "@/components/ServerForm";
import { updateServer } from "@/app/(app)/servers/actions";
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
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href={`/servers/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-white">
        <ArrowLeft className="size-4" aria-hidden />
        Back to details
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Edit {data.name}</h1>
      {error && <p role="alert" className="alert">{error}</p>}
      <ServerForm
        action={updateServer.bind(null, id)}
        server={data}
        submitLabel="Save changes"
        cancelHref={`/servers/${id}`}
      />
    </div>
  );
}

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ServerForm } from "@/components/ServerForm";
import { createServer } from "@/app/(app)/servers/actions";

export default async function NewServerPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-white">
        <ArrowLeft className="size-4" aria-hidden />
        Dashboard
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Add server</h1>
      {error && <p role="alert" className="alert">{error}</p>}
      <ServerForm action={createServer} submitLabel="Add server" cancelHref="/dashboard" />
    </div>
  );
}

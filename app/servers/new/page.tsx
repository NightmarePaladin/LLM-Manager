import Link from "next/link";
import { ServerForm } from "@/components/ServerForm";
import { createServer } from "@/app/servers/actions";

export default async function NewServerPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main>
      <p>
        <Link href="/dashboard">← Dashboard</Link>
      </p>
      <h1>Add server</h1>
      {error && <p role="alert">{error}</p>}
      <ServerForm action={createServer} submitLabel="Add server" />
    </main>
  );
}

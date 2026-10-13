import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logout } from "@/app/auth/actions";
import { StatusBadge } from "@/components/StatusBadge";
import type { Server } from "@/lib/types";

export default async function DashboardPage() {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase.from("servers").select("*").order("name").returns<Server[]>();
  const servers = data ?? [];

  // Stats are tallied from the real rows RLS lets this user see.
  const count = (s: Server["status"]) => servers.filter((x) => x.status === s).length;

  return (
    <main>
      <header>
        <h1>Homelab Dashboard</h1>
        <form action={logout}>
          Signed in as {user.email} <button type="submit">Log out</button>
        </form>
      </header>

      {error && <p role="alert">Could not load servers: {error.message}</p>}

      <section aria-label="Statistics">
        <ul>
          <li>Total servers: {servers.length}</li>
          <li>Online: {count("online")}</li>
          <li>Offline: {count("offline")}</li>
          <li>Unknown: {count("unknown")}</li>
        </ul>
      </section>

      <h2>Server inventory</h2>
      <p>
        <Link href="/servers/new">+ Add server</Link>
      </p>
      {servers.length === 0 ? (
        <p>No servers yet.</p>
      ) : (
        <table border={1} cellPadding={6}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Host</th>
              <th>OS</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/servers/${s.id}`}>{s.name}</Link>
                </td>
                <td>{s.hostname}</td>
                <td>{s.os ?? "—"}</td>
                <td>{s.type}</td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

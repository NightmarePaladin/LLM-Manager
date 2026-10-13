import { LogOut } from "lucide-react";
import { logout } from "@/app/auth/actions";
import { requireUser } from "@/lib/auth";
import { Brand } from "@/components/Brand";
import { NavLinks } from "@/components/NavLinks";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  const email = user.email ?? "Signed in";

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface p-4 md:flex">
        <div className="px-2 pb-6 pt-1">
          <Brand />
        </div>
        <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted">Main navigation</p>
        <NavLinks orientation="vertical" />

        <form action={logout} className="mt-auto">
          <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-2.5">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold uppercase text-accent"
              aria-hidden
            >
              {email[0]}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-300" title={email}>
              {email}
            </span>
            <button
              type="submit"
              aria-label="Log out"
              title="Log out"
              className="cursor-pointer rounded-md p-1.5 text-muted transition-colors hover:bg-zinc-800 hover:text-white"
            >
              <LogOut className="size-4" aria-hidden />
            </button>
          </div>
        </form>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="border-b border-line bg-surface px-4 py-3 md:hidden">
          <form action={logout} className="flex items-center justify-between">
            <Brand />
            <button type="submit" className="btn-secondary px-3 py-1.5">
              <LogOut className="size-4" aria-hidden />
              Log out
            </button>
          </form>
          <div className="mt-3">
            <NavLinks orientation="horizontal" />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}

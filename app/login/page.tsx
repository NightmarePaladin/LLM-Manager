import Link from "next/link";
import { login } from "@/app/auth/actions";
import { Brand } from "@/components/Brand";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <Brand />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
          <p className="mt-1 text-sm text-muted">Welcome back. Sign in to manage your servers.</p>
        </div>
        {error && <p role="alert" className="alert">{error}</p>}
        {message && <p className="notice">{message}</p>}
        <form action={login} className="card space-y-4 p-5">
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input id="email" name="email" type="email" required autoComplete="email" className="input" />
          </div>
          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <input id="password" name="password" type="password" required minLength={8} autoComplete="current-password" className="input" />
          </div>
          <button type="submit" className="btn-primary w-full">
            Log in
          </button>
        </form>
        <p className="text-center text-sm text-muted">
          No account?{" "}
          <Link href="/register" className="font-medium text-accent hover:text-accent-hover">
            Register
          </Link>
        </p>
      </div>
    </main>
  );
}

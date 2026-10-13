import Link from "next/link";
import { register } from "@/app/auth/actions";
import { Brand } from "@/components/Brand";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <Brand />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
          <p className="mt-1 text-sm text-muted">Start tracking your homelab servers.</p>
        </div>
        {error && <p role="alert" className="alert">{error}</p>}
        <form action={register} className="card space-y-4 p-5">
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input id="email" name="email" type="email" required autoComplete="email" className="input" />
          </div>
          <div>
            <label htmlFor="password" className="label">
              Password <span className="font-normal text-muted">(min 8 characters)</span>
            </label>
            <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className="input" />
          </div>
          <button type="submit" className="btn-primary w-full">
            Create account
          </button>
        </form>
        <p className="text-center text-sm text-muted">
          Already registered?{" "}
          <Link href="/login" className="font-medium text-accent hover:text-accent-hover">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}

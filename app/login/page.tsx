import Link from "next/link";
import { login } from "@/app/auth/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;
  return (
    <main>
      <h1>Log in</h1>
      {error && <p role="alert">{error}</p>}
      {message && <p>{message}</p>}
      <form action={login}>
        <p>
          <label>
            Email <input name="email" type="email" required autoComplete="email" />
          </label>
        </p>
        <p>
          <label>
            Password <input name="password" type="password" required minLength={8} autoComplete="current-password" />
          </label>
        </p>
        <button type="submit">Log in</button>
      </form>
      <p>
        No account? <Link href="/register">Register</Link>
      </p>
    </main>
  );
}

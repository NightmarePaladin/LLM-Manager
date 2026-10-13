import Link from "next/link";
import { register } from "@/app/auth/actions";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main>
      <h1>Register</h1>
      {error && <p role="alert">{error}</p>}
      <form action={register}>
        <p>
          <label>
            Email <input name="email" type="email" required autoComplete="email" />
          </label>
        </p>
        <p>
          <label>
            Password (min 8 characters){" "}
            <input name="password" type="password" required minLength={8} autoComplete="new-password" />
          </label>
        </p>
        <button type="submit">Create account</button>
      </form>
      <p>
        Already registered? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}

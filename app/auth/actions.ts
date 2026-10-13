"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { credentialsSchema, firstError } from "@/lib/validation";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function parseCredentials(formData: FormData, path: string) {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) fail(path, firstError(parsed.error));
  return parsed.data;
}

export async function login(formData: FormData) {
  const { email, password } = parseCredentials(formData, "/login");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) fail("/login", error.message);
  redirect("/dashboard");
}

export async function register(formData: FormData) {
  const { email, password } = parseCredentials(formData, "/register");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) fail("/register", error.message);
  // With email confirmation disabled Supabase returns a session immediately.
  if (!data.session) {
    redirect("/login?message=" + encodeURIComponent("Account created. Check your email to confirm, then log in."));
  }
  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

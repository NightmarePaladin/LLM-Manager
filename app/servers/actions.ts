"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { firstError, serverSchema } from "@/lib/validation";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function parseServer(formData: FormData, path: string) {
  const parsed = serverSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail(path, firstError(parsed.error));
  return parsed.data;
}

export async function createServer(formData: FormData) {
  const { supabase } = await requireUser();
  const values = parseServer(formData, "/servers/new");
  // owner_id is filled by the column default auth.uid() and enforced by RLS.
  const { data, error } = await supabase.from("servers").insert(values).select("id").single();
  if (error) fail("/servers/new", error.message);
  revalidatePath("/dashboard");
  redirect(`/servers/${data.id}`);
}

export async function updateServer(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  const path = `/servers/${id}/edit`;
  const values = parseServer(formData, path);
  const { data, error } = await supabase.from("servers").update(values).eq("id", id).select("id");
  if (error) fail(path, error.message);
  if (data.length === 0) fail(path, "Server not found");
  revalidatePath("/dashboard");
  redirect(`/servers/${id}`);
}

export async function deleteServer(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("servers").delete().eq("id", id);
  if (error) fail(`/servers/${id}`, error.message);
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

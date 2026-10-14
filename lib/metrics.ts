import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerMetric } from "@/lib/types";

/** Latest sample per server (RLS limits this to the caller's own servers). */
export async function getLatestMetrics(
  supabase: SupabaseClient,
  serverIds: string[]
): Promise<Map<string, ServerMetric>> {
  const results = await Promise.all(
    serverIds.map((id) =>
      supabase
        .from("server_metrics")
        .select("*")
        .eq("server_id", id)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle<ServerMetric>()
    )
  );
  const map = new Map<string, ServerMetric>();
  results.forEach((r, i) => {
    if (r.data) map.set(serverIds[i], r.data);
  });
  return map;
}

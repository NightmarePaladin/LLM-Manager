import type { OllamaModel } from "@/lib/telemetry";

export const SERVER_TYPES = ["physical", "vm", "container", "other"] as const;

export type ServerType = (typeof SERVER_TYPES)[number];

export type Server = {
  id: string;
  owner_id: string;
  name: string;
  hostname: string;
  os: string | null;
  type: ServerType;
  description: string | null;
  created_at: string;
  updated_at: string;
};

/** One row of public.server_metrics. NULL means the metric was unavailable. */
export type ServerMetric = {
  id: number;
  server_id: string;
  recorded_at: string;
  cpu_percent: number | null;
  ram_percent: number | null;
  ram_used_bytes: number | null;
  ram_total_bytes: number | null;
  disk_percent: number | null;
  disk_used_bytes: number | null;
  disk_total_bytes: number | null;
  net_tx_bps: number | null;
  net_rx_bps: number | null;
  uptime_seconds: number | null;
  agent_version: string | null;
  gpu_percent: number | null;
  vram_used_bytes: number | null;
  vram_total_bytes: number | null;
  gpu_temp_c: number | null;
  gpu_hotspot_c: number | null;
  cpu_temp_c: number | null;
  ollama_up: boolean | null;
  ollama_version: string | null;
  ollama_models: OllamaModel[] | null;
};

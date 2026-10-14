-- AMD GPU utilisation / VRAM and CPU/GPU temperatures. Additive columns, nullable:
-- NULL means "unavailable" (no sensor, other GPU vendor, container), never zero.

alter table public.server_metrics
  add column gpu_percent     real   check (gpu_percent between 0 and 100),
  add column vram_used_bytes bigint check (vram_used_bytes >= 0),
  add column vram_total_bytes bigint check (vram_total_bytes >= 0),
  add column gpu_temp_c      real   check (gpu_temp_c between -50 and 150),
  add column gpu_hotspot_c   real   check (gpu_hotspot_c between -50 and 150),
  add column cpu_temp_c      real   check (cpu_temp_c between -50 and 150),
  add constraint server_metrics_vram_used_le_total
    check (vram_used_bytes is null or vram_total_bytes is null or vram_used_bytes <= vram_total_bytes);

-- Same signature as before, so existing grants (anon, authenticated) are preserved.
create or replace function public.ingest_telemetry(
  p_server_id  uuid,
  p_token_hash text,
  p_metrics    jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
begin
  select t.id into v_token_id
  from public.agent_tokens t
  where t.token_hash = p_token_hash
    and t.server_id = p_server_id
    and t.revoked_at is null;

  if v_token_id is null then
    return 'invalid_token';
  end if;

  if exists (
    select 1 from public.server_metrics m
    where m.server_id = p_server_id and m.recorded_at > now() - interval '5 seconds'
  ) then
    return 'rate_limited';
  end if;

  insert into public.server_metrics (
    server_id, cpu_percent, ram_percent, ram_used_bytes, ram_total_bytes,
    disk_percent, disk_used_bytes, disk_total_bytes,
    net_tx_bps, net_rx_bps, uptime_seconds, agent_version,
    ollama_up, ollama_version, ollama_models,
    gpu_percent, vram_used_bytes, vram_total_bytes, gpu_temp_c, gpu_hotspot_c, cpu_temp_c
  ) values (
    p_server_id,
    (p_metrics->>'cpu_percent')::real,
    (p_metrics->>'ram_percent')::real,
    (p_metrics->>'ram_used_bytes')::bigint,
    (p_metrics->>'ram_total_bytes')::bigint,
    (p_metrics->>'disk_percent')::real,
    (p_metrics->>'disk_used_bytes')::bigint,
    (p_metrics->>'disk_total_bytes')::bigint,
    (p_metrics->>'net_tx_bps')::double precision,
    (p_metrics->>'net_rx_bps')::double precision,
    (p_metrics->>'uptime_seconds')::bigint,
    p_metrics->>'agent_version',
    (p_metrics->>'ollama_up')::boolean,
    p_metrics->>'ollama_version',
    case when jsonb_typeof(p_metrics->'ollama_models') = 'array' then p_metrics->'ollama_models' end,
    (p_metrics->>'gpu_percent')::real,
    (p_metrics->>'vram_used_bytes')::bigint,
    (p_metrics->>'vram_total_bytes')::bigint,
    (p_metrics->>'gpu_temp_c')::real,
    (p_metrics->>'gpu_hotspot_c')::real,
    (p_metrics->>'cpu_temp_c')::real
  );

  update public.agent_tokens set last_used_at = now() where id = v_token_id;

  return 'ok';
end;
$$;

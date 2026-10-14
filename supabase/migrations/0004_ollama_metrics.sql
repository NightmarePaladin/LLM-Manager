-- Ollama monitoring: additive columns on server_metrics and an updated ingest function.
-- NULL means "not monitored / unavailable". ollama_up = false means the API did not answer.
-- ollama_models is a JSON array (empty array = Ollama is up with nothing loaded).

alter table public.server_metrics
  add column ollama_up      boolean,
  add column ollama_version text  check (char_length(ollama_version) <= 32),
  add column ollama_models  jsonb check (
    ollama_models is null
    or (jsonb_typeof(ollama_models) = 'array' and jsonb_array_length(ollama_models) <= 20)
  );

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
    ollama_up, ollama_version, ollama_models
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
    case when jsonb_typeof(p_metrics->'ollama_models') = 'array' then p_metrics->'ollama_models' end
  );

  update public.agent_tokens set last_used_at = now() where id = v_token_id;

  return 'ok';
end;
$$;

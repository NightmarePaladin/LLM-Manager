-- Live monitoring: per-server agent tokens, timestamped metrics, and an
-- ingestion function. Additive only: nothing existing is altered or dropped.
--
-- Agents never hold Supabase credentials. They send a bearer token to the
-- Next.js route, which hashes it and calls public.ingest_telemetry() with the
-- publishable key. Only that SECURITY DEFINER function can insert metrics.

create table public.agent_tokens (
  id           uuid primary key default gen_random_uuid(),
  server_id    uuid not null references public.servers (id) on delete cascade,
  token_hash   text not null unique check (char_length(token_hash) = 64),
  label        text check (char_length(label) <= 100),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index agent_tokens_server_id_idx on public.agent_tokens (server_id);

alter table public.agent_tokens enable row level security;

create policy "Owners can view tokens for their servers"
  on public.agent_tokens for select to authenticated
  using (exists (
    select 1 from public.servers s
    where s.id = agent_tokens.server_id and s.owner_id = (select auth.uid())
  ));

create policy "Owners can create tokens for their servers"
  on public.agent_tokens for insert to authenticated
  with check (exists (
    select 1 from public.servers s
    where s.id = agent_tokens.server_id and s.owner_id = (select auth.uid())
  ));

create policy "Owners can update tokens for their servers"
  on public.agent_tokens for update to authenticated
  using (exists (
    select 1 from public.servers s
    where s.id = agent_tokens.server_id and s.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.servers s
    where s.id = agent_tokens.server_id and s.owner_id = (select auth.uid())
  ));

create policy "Owners can delete tokens for their servers"
  on public.agent_tokens for delete to authenticated
  using (exists (
    select 1 from public.servers s
    where s.id = agent_tokens.server_id and s.owner_id = (select auth.uid())
  ));

-- NULL means "unavailable", never zero.
create table public.server_metrics (
  id              bigint generated always as identity primary key,
  server_id       uuid not null references public.servers (id) on delete cascade,
  recorded_at     timestamptz not null default now(),
  cpu_percent     real   check (cpu_percent between 0 and 100),
  ram_percent     real   check (ram_percent between 0 and 100),
  ram_used_bytes  bigint check (ram_used_bytes >= 0),
  ram_total_bytes bigint check (ram_total_bytes >= 0),
  disk_percent    real   check (disk_percent between 0 and 100),
  disk_used_bytes bigint check (disk_used_bytes >= 0),
  disk_total_bytes bigint check (disk_total_bytes >= 0),
  net_tx_bps      double precision check (net_tx_bps >= 0),
  net_rx_bps      double precision check (net_rx_bps >= 0),
  uptime_seconds  bigint check (uptime_seconds >= 0),
  agent_version   text   check (char_length(agent_version) <= 32)
);

create index server_metrics_server_time_idx
  on public.server_metrics (server_id, recorded_at desc);

alter table public.server_metrics enable row level security;

-- Read-only for owners. No insert/update/delete policies: writes go through
-- public.ingest_telemetry() only.
create policy "Owners can view metrics for their servers"
  on public.server_metrics for select to authenticated
  using (exists (
    select 1 from public.servers s
    where s.id = server_metrics.server_id and s.owner_id = (select auth.uid())
  ));

-- Returns 'ok', 'invalid_token' or 'rate_limited'. The caller passes the
-- SHA-256 hex of the bearer token; the token itself is never stored.
create function public.ingest_telemetry(
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

  -- Reject floods: at most one sample per 5 seconds per server.
  if exists (
    select 1 from public.server_metrics m
    where m.server_id = p_server_id and m.recorded_at > now() - interval '5 seconds'
  ) then
    return 'rate_limited';
  end if;

  insert into public.server_metrics (
    server_id, cpu_percent, ram_percent, ram_used_bytes, ram_total_bytes,
    disk_percent, disk_used_bytes, disk_total_bytes,
    net_tx_bps, net_rx_bps, uptime_seconds, agent_version
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
    p_metrics->>'agent_version'
  );

  update public.agent_tokens set last_used_at = now() where id = v_token_id;

  return 'ok';
end;
$$;

revoke all on function public.ingest_telemetry(uuid, text, jsonb) from public;
grant execute on function public.ingest_telemetry(uuid, text, jsonb) to anon, authenticated;

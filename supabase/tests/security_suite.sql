-- Security suite for the monitoring tables. Re-runnable and leaves nothing behind.
--
-- Run the WHOLE file as one request (SQL editor, or the Supabase MCP execute_sql tool).
-- It runs inside a transaction that ends in ROLLBACK, so the two fake users, their data
-- and the helper schema never persist. It simulates signed-in users with SET LOCAL ROLE
-- and JWT claims, so Row Level Security is evaluated exactly as for real API requests.
--
-- The final SELECT returns {passed, failed, failures, by_area}. Expected: failed = 0.
-- (Until migration 0007_least_privilege_grants.sql is applied, the 'hardening' area
-- fails on purpose: Supabase's default grants give anon/authenticated more table
-- privileges than needed. RLS still blocks the actual access.)
--
-- After running, confirm nothing persisted:
--   select count(*) from auth.users where email like '%@test.invalid';   -- 0
--   select count(*) from pg_namespace where nspname = 'sectest';          -- 0

begin;

create schema sectest;
grant usage on schema sectest to anon, authenticated;
create table sectest.res (n serial primary key, area text, check_name text, ok boolean, detail text);
grant all on sectest.res to anon, authenticated;
grant usage, select on sequence sectest.res_n_seq to anon, authenticated;
create function sectest.rec(area text, check_name text, ok boolean, detail text default null) returns void
  language sql security definer as $$ insert into sectest.res(area, check_name, ok, detail) values (area, check_name, ok, detail) $$;
grant execute on function sectest.rec(text, text, boolean, text) to anon, authenticated;

-- Fixtures (as the table owner): two fake users, a server + token each, one old metric each.
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('aaaaaaaa-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sec-a@test.invalid',now(),now()),
  ('bbbbbbbb-0000-4000-8000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sec-b@test.invalid',now(),now());
insert into public.servers (id, owner_id, name, hostname) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1','aaaaaaaa-0000-4000-8000-00000000000a','sec-a-server','10.9.9.1'),
  ('bbbbbbbb-0000-4000-8000-0000000000b1','bbbbbbbb-0000-4000-8000-00000000000b','sec-b-server','10.9.9.2');
insert into public.agent_tokens (server_id, token_hash) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', repeat('a',64)),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', repeat('b',64));
insert into public.agent_tokens (server_id, token_hash, revoked_at) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', repeat('d',64), now());
insert into public.server_metrics (server_id, recorded_at, cpu_percent) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', now() - interval '1 hour', 11),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', now() - interval '1 hour', 22);

-- ===================== signed in as user A =====================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}', true),
       set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', true),
       set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare n int; ra int; got text;
begin
  select count(*) into n from public.servers;
  perform sectest.rec('isolation','A sees only its own server (not B, not real users)', n = 1, n::text);
  select count(*) into n from public.agent_tokens;
  perform sectest.rec('isolation','A sees only its own tokens (2 incl. a revoked one)', n = 2, n::text);
  select count(*) into n from public.server_metrics;
  perform sectest.rec('isolation','A sees only its own metrics', n = 1, n::text);
  select count(*) into n from public.get_metric_history('bbbbbbbb-0000-4000-8000-0000000000b1', 24, 24);
  perform sectest.rec('isolation','A cannot read B history via get_metric_history', n = 0, n::text);
  select count(*) into n from public.get_metric_history('aaaaaaaa-0000-4000-8000-0000000000a1', 24, 24);
  perform sectest.rec('isolation','A can read its own history', n >= 1, n::text);

  update public.servers set name = 'hacked' where id = 'bbbbbbbb-0000-4000-8000-0000000000b1';
  get diagnostics ra = row_count;
  perform sectest.rec('write-protection','A cannot update B server', ra = 0, ra::text);
  delete from public.servers where id = 'bbbbbbbb-0000-4000-8000-0000000000b1';
  get diagnostics ra = row_count;
  perform sectest.rec('write-protection','A cannot delete B server', ra = 0, ra::text);
  update public.agent_tokens set revoked_at = now() where server_id = 'bbbbbbbb-0000-4000-8000-0000000000b1';
  get diagnostics ra = row_count;
  perform sectest.rec('write-protection','A cannot revoke B tokens', ra = 0, ra::text);
  delete from public.agent_tokens where server_id = 'bbbbbbbb-0000-4000-8000-0000000000b1';
  get diagnostics ra = row_count;
  perform sectest.rec('write-protection','A cannot delete B tokens', ra = 0, ra::text);

  begin
    insert into public.servers (owner_id, name, hostname) values ('bbbbbbbb-0000-4000-8000-00000000000b', 'spoof', 'x');
    perform sectest.rec('write-protection','A cannot create a server owned by B', false, 'inserted');
  exception when others then perform sectest.rec('write-protection','A cannot create a server owned by B', true, sqlstate); end;

  begin
    update public.servers set owner_id = 'bbbbbbbb-0000-4000-8000-00000000000b' where id = 'aaaaaaaa-0000-4000-8000-0000000000a1';
    get diagnostics ra = row_count;
    perform sectest.rec('write-protection','A cannot hand its server to B', ra = 0, ra::text);
  exception when others then perform sectest.rec('write-protection','A cannot hand its server to B', true, sqlstate); end;

  begin
    insert into public.agent_tokens (server_id, token_hash) values ('bbbbbbbb-0000-4000-8000-0000000000b1', repeat('e',64));
    perform sectest.rec('write-protection','A cannot mint a token for B server', false, 'inserted');
  exception when others then perform sectest.rec('write-protection','A cannot mint a token for B server', true, sqlstate); end;

  begin
    insert into public.agent_tokens (server_id, token_hash) values ('aaaaaaaa-0000-4000-8000-0000000000a1', repeat('c',64));
    perform sectest.rec('functionality','A can mint a token for its own server', true, null);
  exception when others then perform sectest.rec('functionality','A can mint a token for its own server', false, sqlerrm); end;

  begin
    insert into public.agent_tokens (server_id, token_hash) values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'short');
    perform sectest.rec('validation','a malformed token hash is rejected by the database', false, 'inserted');
  exception when check_violation then perform sectest.rec('validation','a malformed token hash is rejected by the database', true, sqlstate); end;

  begin
    insert into public.servers (name, hostname) values ('sec-a-second', '10.9.9.3');
    select count(*) into n from public.servers where owner_id = 'aaaaaaaa-0000-4000-8000-00000000000a';
    perform sectest.rec('functionality','A can create a server (owner filled from the session)', n = 2, n::text);
  exception when others then perform sectest.rec('functionality','A can create a server (owner filled from the session)', false, sqlerrm); end;

  begin
    insert into public.server_metrics (server_id, cpu_percent) values ('aaaaaaaa-0000-4000-8000-0000000000a1', 1);
    perform sectest.rec('write-protection','signed-in users cannot insert metrics directly', false, 'inserted');
  exception when others then perform sectest.rec('write-protection','signed-in users cannot insert metrics directly', true, sqlstate); end;

  begin
    update public.server_metrics set cpu_percent = 99 where server_id = 'aaaaaaaa-0000-4000-8000-0000000000a1';
    get diagnostics ra = row_count;
    perform sectest.rec('write-protection','signed-in users cannot edit stored metrics', ra = 0, ra::text);
  exception when others then perform sectest.rec('write-protection','signed-in users cannot edit stored metrics', true, sqlstate); end;

  begin
    delete from public.server_metrics where server_id = 'aaaaaaaa-0000-4000-8000-0000000000a1';
    get diagnostics ra = row_count;
    perform sectest.rec('write-protection','signed-in users cannot delete stored metrics', ra = 0, ra::text);
  exception when others then perform sectest.rec('write-protection','signed-in users cannot delete stored metrics', true, sqlstate); end;

  select public.ingest_telemetry('aaaaaaaa-0000-4000-8000-0000000000a1', repeat('b',64), '{"cpu_percent":1}'::jsonb) into got;
  perform sectest.rec('agent-auth','B token cannot write to A server', got = 'invalid_token', got);
end $$;
reset role;

-- ===================== signed in as user B (the other tenant) =====================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","role":"authenticated"}', true),
       set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-00000000000b', true);
do $$
declare n int;
begin
  select count(*) into n from public.servers;
  perform sectest.rec('isolation','B sees only its own server (A new data is invisible)', n = 1, n::text);
  select count(*) into n from public.agent_tokens where server_id = 'aaaaaaaa-0000-4000-8000-0000000000a1';
  perform sectest.rec('isolation','B sees none of A tokens', n = 0, n::text);
  select count(*) into n from public.server_metrics where server_id = 'aaaaaaaa-0000-4000-8000-0000000000a1';
  perform sectest.rec('isolation','B sees none of A metrics', n = 0, n::text);
end $$;
reset role;

-- ===================== not signed in (anon): the role the agent route uses =====================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('request.jwt.claim.sub', '', true);
do $$
declare n int; got text;
begin
  select count(*) into n from public.servers;
  perform sectest.rec('anon','anon sees no servers', n = 0, n::text);
  select count(*) into n from public.agent_tokens;
  perform sectest.rec('anon','anon sees no tokens', n = 0, n::text);
  select count(*) into n from public.server_metrics;
  perform sectest.rec('anon','anon sees no metrics', n = 0, n::text);
  begin
    insert into public.servers (owner_id, name, hostname) values ('aaaaaaaa-0000-4000-8000-00000000000a', 'anon-spoof', 'x');
    perform sectest.rec('anon','anon cannot insert servers', false, 'inserted');
  exception when others then perform sectest.rec('anon','anon cannot insert servers', true, sqlstate); end;
  begin
    perform 1 from public.get_metric_history('aaaaaaaa-0000-4000-8000-0000000000a1', 24, 24);
    perform sectest.rec('anon','anon cannot call get_metric_history', false, 'ran');
  exception when insufficient_privilege then perform sectest.rec('anon','anon cannot call get_metric_history', true, sqlstate); end;

  -- the ingestion function is the one door agents use (called as anon by the route)
  select public.ingest_telemetry('aaaaaaaa-0000-4000-8000-0000000000a1', repeat('a',64), '{"cpu_percent":50,"ram_percent":40,"gpu_percent":0}'::jsonb) into got;
  perform sectest.rec('agent-auth','valid token + matching server is accepted', got = 'ok', got);
  select public.ingest_telemetry('aaaaaaaa-0000-4000-8000-0000000000a1', repeat('a',64), '{"cpu_percent":51}'::jsonb) into got;
  perform sectest.rec('agent-auth','a second report within 5 s is rate limited', got = 'rate_limited', got);
  select public.ingest_telemetry('aaaaaaaa-0000-4000-8000-0000000000a1', repeat('9',64), '{"cpu_percent":1}'::jsonb) into got;
  perform sectest.rec('agent-auth','unknown token is rejected', got = 'invalid_token', got);
  select public.ingest_telemetry('aaaaaaaa-0000-4000-8000-0000000000a1', repeat('d',64), '{"cpu_percent":1}'::jsonb) into got;
  perform sectest.rec('agent-auth','revoked token is rejected', got = 'invalid_token', got);
  select public.ingest_telemetry('bbbbbbbb-0000-4000-8000-0000000000b1', repeat('a',64), '{"cpu_percent":1}'::jsonb) into got;
  perform sectest.rec('agent-auth','A token cannot write to B server', got = 'invalid_token', got);
  select public.ingest_telemetry('aaaaaaaa-0000-4000-8000-0000000000a1', '', '{"cpu_percent":1}'::jsonb) into got;
  perform sectest.rec('agent-auth','empty token hash is rejected', got = 'invalid_token', got);
  select public.ingest_telemetry('aaaaaaaa-0000-4000-8000-0000000000a1', repeat('a',64) || ' OR 1=1', '{"cpu_percent":1}'::jsonb) into got;
  perform sectest.rec('agent-auth','SQL-injection-style token hash is just an unknown token', got = 'invalid_token', got);
end $$;
reset role;

-- Hostile payloads, using the valid token. Move the stored report back an hour to clear the rate limit.
update public.server_metrics set recorded_at = now() - interval '1 hour'
  where server_id = 'aaaaaaaa-0000-4000-8000-0000000000a1' and recorded_at >= now() - interval '1 minute';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin
    perform public.ingest_telemetry('aaaaaaaa-0000-4000-8000-0000000000a1', repeat('a',64), '{"cpu_percent":"1); drop table public.servers;--"}'::jsonb);
    perform sectest.rec('payload','a non-numeric metric is rejected', false, 'accepted');
  exception when others then perform sectest.rec('payload','a non-numeric metric is rejected', true, sqlstate); end;
  begin
    perform public.ingest_telemetry('aaaaaaaa-0000-4000-8000-0000000000a1', repeat('a',64), '{"cpu_percent":500}'::jsonb);
    perform sectest.rec('payload','an out-of-range metric is rejected by the database', false, 'accepted');
  exception when check_violation then perform sectest.rec('payload','an out-of-range metric is rejected by the database', true, sqlstate); end;
  begin
    perform public.ingest_telemetry('aaaaaaaa-0000-4000-8000-0000000000a1', repeat('a',64), jsonb_build_object('ollama_models', (select jsonb_agg(jsonb_build_object('name','m'||i)) from generate_series(1,21) i)));
    perform sectest.rec('payload','more than 20 Ollama models is rejected', false, 'accepted');
  exception when check_violation then perform sectest.rec('payload','more than 20 Ollama models is rejected', true, sqlstate); end;
  begin
    perform public.ingest_telemetry('aaaaaaaa-0000-4000-8000-0000000000a1', repeat('a',64), '{"vram_used_bytes":5000,"vram_total_bytes":4000}'::jsonb);
    perform sectest.rec('payload','VRAM used above total is rejected', false, 'accepted');
  exception when check_violation then perform sectest.rec('payload','VRAM used above total is rejected', true, sqlstate); end;
end $$;
reset role;

-- After the hostile payloads: tables intact, only the one valid report stored, unavailable stays null.
insert into sectest.res(area, check_name, ok, detail)
select 'integrity', 'servers table survived the injection attempt', (select count(*) from public.servers) >= 2, (select count(*)::text from public.servers);
insert into sectest.res(area, check_name, ok, detail)
select 'integrity', 'exactly one report was stored for A through the ingest function', (select count(*) from public.server_metrics where server_id='aaaaaaaa-0000-4000-8000-0000000000a1' and cpu_percent = 50) = 1, null;
insert into sectest.res(area, check_name, ok, detail)
select 'integrity', 'nothing was stored for B', (select count(*) from public.server_metrics where server_id='bbbbbbbb-0000-4000-8000-0000000000b1' and recorded_at > now() - interval '1 minute') = 0, null;
insert into sectest.res(area, check_name, ok, detail)
select 'integrity', 'a stored GPU 0 percent is a real zero, not null', (select gpu_percent from public.server_metrics where server_id='aaaaaaaa-0000-4000-8000-0000000000a1' and cpu_percent = 50) = 0, null;
insert into sectest.res(area, check_name, ok, detail)
select 'integrity', 'fields the agent did not report stay null (unavailable, not zero)', (select vram_used_bytes is null and cpu_temp_c is null from public.server_metrics where server_id='aaaaaaaa-0000-4000-8000-0000000000a1' and cpu_percent = 50), null;

-- ===================== privileges behind RLS (defense in depth; fixed by migration 0007) =====================
insert into sectest.res(area, check_name, ok, detail)
select 'hardening', format('%s holds no %s on %s', r, p, t), not has_table_privilege(r, 'public.' || t, p), has_table_privilege(r, 'public.' || t, p)::text
from (values ('anon'), ('authenticated')) rr(r)
cross join (values ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) pp(p)
cross join (values ('servers'), ('agent_tokens'), ('server_metrics')) tt(t);
insert into sectest.res(area, check_name, ok, detail)
select 'hardening', format('%s holds no %s on server_metrics (only the ingest function writes)', r, p), not has_table_privilege(r, 'public.server_metrics', p), has_table_privilege(r, 'public.server_metrics', p)::text
from (values ('anon'), ('authenticated')) rr(r) cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) pp(p);
insert into sectest.res(area, check_name, ok, detail)
select 'hardening', 'anon holds no read access to agent_tokens or server_metrics',
       not (has_table_privilege('anon','public.agent_tokens','SELECT') or has_table_privilege('anon','public.server_metrics','SELECT')), null;

select json_build_object(
  'passed', (select count(*) from sectest.res where ok),
  'failed', (select count(*) from sectest.res where not ok),
  'failures', (select json_agg(json_build_object('area', area, 'check', check_name, 'detail', detail) order by n) from sectest.res where not ok),
  'by_area', (select json_object_agg(area, json_build_object('pass', p, 'fail', f)) from (select area, count(*) filter (where ok) p, count(*) filter (where not ok) f from sectest.res group by area) s)
) as result;

rollback;

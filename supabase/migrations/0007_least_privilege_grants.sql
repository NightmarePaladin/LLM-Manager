-- Least-privilege table grants (defense in depth behind Row Level Security).
--
-- Supabase grants every privilege on new public tables to the anon and authenticated
-- roles. RLS already blocks row access, but TRUNCATE is not subject to RLS, and nothing
-- should hold TRIGGER/REFERENCES or write access to metrics. After this migration:
--   anon           : no direct table access at all (agents go through ingest_telemetry(),
--                    a SECURITY DEFINER function that does not need table privileges)
--   authenticated  : servers and agent_tokens: select/insert/update/delete (still limited by RLS)
--                    server_metrics: select only (rows are written by ingest_telemetry() alone)
--
-- Reversible with GRANT; no data or policies are touched.

revoke all on table public.servers, public.agent_tokens, public.server_metrics from anon;
revoke all on table public.servers, public.agent_tokens, public.server_metrics from authenticated;

grant select, insert, update, delete on table public.servers to authenticated;
grant select, insert, update, delete on table public.agent_tokens to authenticated;
grant select on table public.server_metrics to authenticated;

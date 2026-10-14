-- DESTRUCTIVE: removes the manually entered servers.status column.
-- Requires explicit user confirmation before applying (see HANDOFF.md rule 2).
-- Apply only after the app code no longer reads or writes `status`
-- (monitoring state is derived from public.server_metrics instead).

alter table public.servers drop column status;
drop type public.server_status;

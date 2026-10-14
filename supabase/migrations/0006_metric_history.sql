-- History for charts: averages of server_metrics into fixed time buckets.
-- SECURITY INVOKER: runs as the caller, so the owner-only RLS on server_metrics
-- applies. Buckets without any report are simply absent (charts show a gap).
-- NULL averages mean the metric was unavailable for the whole bucket.

create function public.get_metric_history(
  p_server_id uuid,
  p_hours     integer default 168,
  p_buckets   integer default 168
)
returns table (
  bucket           timestamptz,
  samples          bigint,
  cpu_percent      double precision,
  ram_percent      double precision,
  disk_percent     double precision,
  net_rx_bps       double precision,
  net_tx_bps       double precision,
  gpu_percent      double precision,
  vram_percent     double precision,
  cpu_temp_c       double precision,
  gpu_temp_c       double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      least(greatest(p_hours, 1), 720)    as hours,
      least(greatest(p_buckets, 10), 400) as buckets
  ),
  span as (
    select
      make_interval(secs => (hours * 3600.0) / buckets) as stride,
      now() - make_interval(hours => hours)             as since
    from params
  )
  select
    date_bin(span.stride, m.recorded_at, span.since) as bucket,
    count(*)                                         as samples,
    avg(m.cpu_percent)::double precision,
    avg(m.ram_percent)::double precision,
    avg(m.disk_percent)::double precision,
    avg(m.net_rx_bps)::double precision,
    avg(m.net_tx_bps)::double precision,
    avg(m.gpu_percent)::double precision,
    avg(m.vram_used_bytes::double precision / nullif(m.vram_total_bytes, 0) * 100)::double precision,
    avg(m.cpu_temp_c)::double precision,
    avg(m.gpu_temp_c)::double precision
  from public.server_metrics m, span
  where m.server_id = p_server_id
    and m.recorded_at >= span.since
  group by 1
  order by 1;
$$;

revoke all on function public.get_metric_history(uuid, integer, integer) from public, anon;
grant execute on function public.get_metric_history(uuid, integer, integer) to authenticated;

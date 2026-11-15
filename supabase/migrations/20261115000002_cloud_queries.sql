-- ASTRYON — consultas do painel na nuvem.
-- Agregam no banco (a API do Supabase devolve no máximo 1.000 linhas por consulta) e rodam com as permissões
-- de quem está logado (security invoker): a RLS continua decidindo o que cada pessoa enxerga.
-- Tempos entram e saem em epoch (segundos), como no agente local.

create or replace function public.cloud_workspace()
returns uuid language sql stable security invoker set search_path = public as $$
  select m.workspace_id from public.workspace_members m
   where m.user_id = auth.uid()
   order by (m.role = 'owner') desc, m.created_at
   limit 1;
$$;

create or replace function public.cloud_telemetry(p_start bigint, p_end bigint, p_bucket int)
returns table (t bigint, n bigint, down_mbps double precision, up_mbps double precision, down_max_mbps double precision,
               up_max_mbps double precision, latency_ms double precision, drop_pct double precision,
               power_w double precision, source text)
language sql stable security invoker set search_path = public as $$
  with ws as (select public.cloud_workspace() as id),
  tel as (
    select (floor(extract(epoch from s.ts) / p_bucket) * p_bucket)::bigint as t,
           sum(s.samples) as n,
           max(s.downlink_max_bps) / 1e6 as down_max, max(s.uplink_max_bps) / 1e6 as up_max,
           sum(s.latency_avg_ms * s.samples) / nullif(sum(s.samples) filter (where s.latency_avg_ms is not null), 0) as lat,
           sum(s.drop_avg * s.samples) / nullif(sum(s.samples) filter (where s.drop_avg is not null), 0) * 100 as drp,
           avg(s.power_avg_w) as pw, max(s.source) as src
      from public.telemetry_samples s, ws
     where s.workspace_id = ws.id and s.ts >= to_timestamp(p_start) and s.ts < to_timestamp(p_end)
     group by 1),
  us as (
    select (floor(extract(epoch from u.minute_ts) / p_bucket) * p_bucket)::bigint as t,
           sum(u.bytes_down) * 8 / nullif(sum(u.samples), 0) / 1e6 as down,
           sum(u.bytes_up) * 8 / nullif(sum(u.samples), 0) / 1e6 as up,
           sum(u.samples) as n
      from public.usage_intervals u, ws
     where u.workspace_id = ws.id and u.minute_ts >= to_timestamp(p_start) and u.minute_ts < to_timestamp(p_end)
     group by 1)
  select coalesce(tel.t, us.t), coalesce(tel.n, us.n), us.down, us.up, tel.down_max, tel.up_max, tel.lat, tel.drp, tel.pw,
         coalesce(tel.src, 'calculada')
    from tel full join us on us.t = tel.t
   order by 1;
$$;

create or replace function public.cloud_usage_window(p_start bigint, p_end bigint)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'start', p_start, 'end', p_end,
    'bytes_download', coalesce(sum(u.bytes_down), 0), 'bytes_upload', coalesce(sum(u.bytes_up), 0),
    'bytes_total', coalesce(sum(u.bytes_down + u.bytes_up), 0), 'observed_seconds', coalesce(sum(u.samples), 0),
    'coverage', least(1, coalesce(sum(u.samples), 0)::double precision / greatest(1, least(p_end, extract(epoch from now())::bigint) - p_start)),
    'source', case when count(*) = 0 then 'indisponivel' else 'calculada' end)
    from public.usage_intervals u
   where u.workspace_id = public.cloud_workspace()
     and u.minute_ts >= to_timestamp(p_start) and u.minute_ts < to_timestamp(p_end);
$$;

create or replace function public.cloud_usage_series(p_start bigint, p_end bigint, p_tz text, p_bucket text)
returns table (t bigint, bytes_download double precision, bytes_upload double precision, observed bigint)
language sql stable security invoker set search_path = public as $$
  select extract(epoch from (date_trunc(p_bucket, u.minute_ts at time zone p_tz) at time zone p_tz))::bigint,
         sum(u.bytes_down), sum(u.bytes_up), sum(u.samples)
    from public.usage_intervals u
   where u.workspace_id = public.cloud_workspace()
     and u.minute_ts >= to_timestamp(p_start) and u.minute_ts < to_timestamp(p_end)
   group by 1 order by 1;
$$;

create or replace function public.cloud_quality(p_start bigint, p_end bigint, p_tz text)
returns jsonb language sql stable security invoker set search_path = public as $$
  with s as (
    select * from public.telemetry_samples
     where workspace_id = public.cloud_workspace() and ts >= to_timestamp(p_start) and ts < to_timestamp(p_end)),
  agg as (
    select coalesce(sum(samples), 0) as observed,
           coalesce(sum(full_drop_s), 0) as full_drop,
           sum(drop_avg * samples) / nullif(sum(samples) filter (where drop_avg is not null), 0) as loss,
           percentile_cont(0.5) within group (order by latency_avg_ms) as p50,
           percentile_cont(0.95) within group (order by latency_avg_ms) as p95,
           max(latency_max_ms) as lat_max, avg(jitter_ms) as jit,
           max(source) as src
      from s),
  hours as (
    select extract(hour from s.ts at time zone p_tz)::int as h, sum(s.samples) as obs,
           sum(s.drop_avg * s.samples) / nullif(sum(s.samples) filter (where s.drop_avg is not null), 0) as loss,
           sum(s.latency_avg_ms * s.samples) / nullif(sum(s.samples) filter (where s.latency_avg_ms is not null), 0) as lat,
           coalesce(sum(s.full_drop_s), 0) as fd
      from s group by 1)
  select jsonb_build_object(
    'start', p_start, 'end', p_end, 'timezone', p_tz,
    'source', case when agg.observed = 0 then 'indisponivel' else coalesce(agg.src, 'calculada') end,
    'observed_seconds', agg.observed,
    'coverage', least(1, agg.observed::double precision / greatest(1, least(p_end, extract(epoch from now())::bigint) - p_start)),
    'availability_pct', case when agg.observed > 0 then round(((1 - agg.full_drop::numeric / agg.observed) * 100), 3) end,
    'availability_note', 'Disponibilidade = minutos observados sem perda total de ping ao PoP ÷ observados. Lacunas ficam fora do cálculo.',
    'loss_pct', round((agg.loss * 100)::numeric, 3),
    'latency_p50_ms', round(agg.p50::numeric, 1), 'latency_p95_ms', round(agg.p95::numeric, 1),
    'latency_max_ms', round(agg.lat_max::numeric, 1),
    'latency_note', 'Percentis das médias por minuto da latência antena→PoP.',
    'jitter_ms', round(agg.jit::numeric, 2),
    'jitter_note', 'Média por minuto da variação entre amostras consecutivas, calculada pelo agente.',
    'full_drop_seconds', agg.full_drop,
    'by_hour', (select jsonb_agg(jsonb_build_object('hour', g, 'observed_seconds', coalesce(hours.obs, 0),
                       'loss_pct', round((hours.loss * 100)::numeric, 3), 'latency_avg_ms', round(hours.lat::numeric, 1),
                       'full_drop_s', coalesce(hours.fd, 0)) order by g)
                  from generate_series(0, 23) g left join hours on hours.h = g),
    'gaps', '[]'::jsonb)
  from agg;
$$;

create or replace function public.cloud_status()
returns jsonb language sql stable security invoker set search_path = public as $$
  with ws as (select public.cloud_workspace() as id),
  term as (select t.* from public.starlink_terminals t, ws where t.workspace_id = ws.id order by t.last_seen desc limit 1),
  tel as (select s.* from public.telemetry_samples s, term where s.terminal_id = term.id order by s.ts desc limit 1),
  us as (select u.* from public.usage_intervals u, term where u.terminal_id = term.id order by u.minute_ts desc limit 1),
  hb as (select h.* from public.agent_heartbeats h, ws where h.workspace_id = ws.id order by h.ts desc limit 1),
  ag as (select count(*) filter (where a.revoked_at is null) as agents, max(a.last_seen) as last_seen
           from public.agents a, ws where a.workspace_id = ws.id)
  select jsonb_build_object(
    'workspace_id', (select id from ws),
    'workspace_name', (select w.name from public.workspaces w, ws where w.id = ws.id),
    'agents', (select agents from ag),
    'agent_last_seen', (select extract(epoch from last_seen)::bigint from ag),
    'terminal', (select jsonb_build_object('name', name, 'hardware_version', hardware_version,
                                           'software_version', software_version) from term),
    'heartbeat', (select jsonb_build_object('ts', extract(epoch from ts)::bigint, 'dish_reachable', dish_reachable,
                                            'version', version, 'sync_pending', sync_pending) from hb),
    'last_minute', (select jsonb_build_object('ts', extract(epoch from tel.ts)::bigint, 'latency_ms', tel.latency_avg_ms,
                                              'drop_pct', tel.drop_avg * 100, 'power_w', tel.power_avg_w,
                                              'down_mbps', (select us.bytes_down * 8 / nullif(us.samples, 0) / 1e6 from us),
                                              'up_mbps', (select us.bytes_up * 8 / nullif(us.samples, 0) / 1e6 from us))
                    from tel));
$$;

revoke all on function public.cloud_workspace() from public;
revoke all on function public.cloud_telemetry(bigint, bigint, int) from public;
revoke all on function public.cloud_usage_window(bigint, bigint) from public;
revoke all on function public.cloud_usage_series(bigint, bigint, text, text) from public;
revoke all on function public.cloud_quality(bigint, bigint, text) from public;
revoke all on function public.cloud_status() from public;
grant execute on function public.cloud_workspace() to authenticated;
grant execute on function public.cloud_telemetry(bigint, bigint, int) to authenticated;
grant execute on function public.cloud_usage_window(bigint, bigint) to authenticated;
grant execute on function public.cloud_usage_series(bigint, bigint, text, text) to authenticated;
grant execute on function public.cloud_quality(bigint, bigint, text) to authenticated;
grant execute on function public.cloud_status() to authenticated;

-- Regressões das consultas/exportação da nuvem: limites também no PostgREST, lacunas reais e escopo de workspace.

create or replace function public.cloud_telemetry(p_start bigint, p_end bigint, p_bucket int)
returns table (t bigint, n bigint, down_mbps double precision, up_mbps double precision, down_max_mbps double precision,
               up_max_mbps double precision, latency_ms double precision, drop_pct double precision,
               power_w double precision, source text)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_start is null or p_end is null or p_start <= 0 or p_end <= p_start
     or p_end - p_start > 400 * 86400 or p_end > extract(epoch from now())::bigint + 86400 then
    raise exception 'janela de consulta inválida ou longa demais (máximo 400 dias)' using errcode = '22023';
  end if;
  if p_bucket is null or p_bucket < 60 or p_bucket > 86400
     or (p_end - p_start + p_bucket - 1) / p_bucket > 720 then
    raise exception 'bucket inválido: use entre 60 s e 1 dia, com no máximo 720 buckets' using errcode = '22023';
  end if;
  return query
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
  us_by_terminal as (
    select u.terminal_id, (floor(extract(epoch from u.minute_ts) / p_bucket) * p_bucket)::bigint as t,
           sum(u.bytes_down) as bytes_down, sum(u.bytes_up) as bytes_up, sum(u.samples) as n
      from public.usage_intervals u, ws
     where u.workspace_id = ws.id and u.minute_ts >= to_timestamp(p_start) and u.minute_ts < to_timestamp(p_end)
     group by 1, 2),
  us as (
    select ubt.t, sum(ubt.bytes_down * 8 / nullif(ubt.n, 0)) / 1e6 as down,
           sum(ubt.bytes_up * 8 / nullif(ubt.n, 0)) / 1e6 as up, sum(ubt.n) as n
      from us_by_terminal ubt group by ubt.t)
  select coalesce(tel.t, us.t), coalesce(tel.n, us.n)::bigint, us.down, us.up, tel.down_max, tel.up_max, tel.lat, tel.drp, tel.pw,
         coalesce(tel.src, 'calculada')
    from tel full join us on us.t = tel.t
   order by 1;
end $$;

create or replace function public.cloud_usage_window(p_start bigint, p_end bigint)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
begin
  if p_start is null or p_end is null or p_start <= 0 or p_end <= p_start
     or p_end - p_start > 400 * 86400 or p_end > extract(epoch from now())::bigint + 86400 then
    raise exception 'janela de consulta inválida ou longa demais (máximo 400 dias)' using errcode = '22023';
  end if;
  return (select jsonb_build_object(
    'start', p_start, 'end', p_end,
    'bytes_download', coalesce(sum(u.bytes_down), 0), 'bytes_upload', coalesce(sum(u.bytes_up), 0),
    'bytes_total', coalesce(sum(u.bytes_down + u.bytes_up), 0), 'observed_seconds', coalesce(sum(u.samples), 0),
    'coverage', least(1, coalesce(sum(u.samples), 0)::double precision / greatest(1, least(p_end, extract(epoch from now())::bigint) - p_start)),
    'source', case when count(*) = 0 then 'indisponivel' else 'calculada' end)
    from public.usage_intervals u
   where u.workspace_id = public.cloud_workspace()
     and u.minute_ts >= to_timestamp(p_start) and u.minute_ts < to_timestamp(p_end));
end $$;

create or replace function public.cloud_usage_series(p_start bigint, p_end bigint, p_tz text, p_bucket text)
returns table (t bigint, bytes_download double precision, bytes_upload double precision, observed bigint)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_start is null or p_end is null or p_start <= 0 or p_end <= p_start
     or p_end - p_start > 400 * 86400 or p_end > extract(epoch from now())::bigint + 86400 then
    raise exception 'janela de consulta inválida ou longa demais (máximo 400 dias)' using errcode = '22023';
  end if;
  if p_bucket not in ('hour', 'day', 'month') or p_tz is null or char_length(p_tz) > 64 then
    raise exception 'bucket ou fuso inválido' using errcode = '22023';
  end if;
  perform now() at time zone p_tz;
  return query
  select extract(epoch from (date_trunc(p_bucket, u.minute_ts at time zone p_tz) at time zone p_tz))::bigint,
         sum(u.bytes_down), sum(u.bytes_up), sum(u.samples)
    from public.usage_intervals u
   where u.workspace_id = public.cloud_workspace()
     and u.minute_ts >= to_timestamp(p_start) and u.minute_ts < to_timestamp(p_end)
   group by 1 order by 1;
end $$;

create or replace function public.cloud_quality(p_start bigint, p_end bigint, p_tz text)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
begin
  if p_start is null or p_end is null or p_start <= 0 or p_end <= p_start
     or p_end - p_start > 400 * 86400 or p_end > extract(epoch from now())::bigint + 86400 then
    raise exception 'janela de consulta inválida ou longa demais (máximo 400 dias)' using errcode = '22023';
  end if;
  if p_tz is null or char_length(p_tz) > 64 then
    raise exception 'fuso inválido' using errcode = '22023';
  end if;
  perform now() at time zone p_tz;
  return (with s as (
    select * from public.telemetry_samples
     where workspace_id = public.cloud_workspace() and ts >= to_timestamp(p_start) and ts < to_timestamp(p_end)),
  agg as (
    select coalesce(sum(samples), 0) as observed,
           coalesce(sum(samples) filter (where drop_avg is not null), 0) as drop_observed,
           coalesce(sum(full_drop_s) filter (where drop_avg is not null), 0) as drop_full,
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
      from s group by 1),
  bounds as (
    select (floor(p_start / 60.0) * 60)::bigint as start_min,
           (ceil(p_end / 60.0) * 60)::bigint as end_min),
  input_minutes as (
    select distinct (floor(extract(epoch from ts) / 60) * 60)::bigint as m, true as observed from s
    union select start_min, false from bounds
    union select end_min, false from bounds),
  timeline as (select m, bool_or(observed) as observed from input_minutes group by m),
  ordered as (
    select m, observed, lag(m) over (order by m) as previous_m,
           lag(observed) over (order by m) as previous_observed from timeline),
  gap_rows as (
    select greatest(p_start, case when previous_observed then previous_m + 60 else previous_m end) as start_ts,
           least(p_end, m) as end_ts
      from ordered
     where previous_m is not null
       and case when previous_observed then previous_m + 60 else previous_m end < m)
  select jsonb_build_object(
    'start', p_start, 'end', p_end, 'timezone', p_tz,
    'source', case when agg.observed = 0 then 'indisponivel' else coalesce(agg.src, 'calculada') end,
    'observed_seconds', agg.observed,
    'coverage', least(1, agg.observed::double precision / greatest(1, least(p_end, extract(epoch from now())::bigint) - p_start)),
    'availability_pct', case when agg.drop_observed > 0 then round(((1 - agg.drop_full::numeric / agg.drop_observed) * 100), 3) end,
    'availability_note', 'Disponibilidade = segundos com perda medida e sem perda total ÷ segundos com perda medida. Lacunas e medidas drop_avg ausentes ficam fora do cálculo.',
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
    'gaps', (select coalesce(jsonb_agg(jsonb_build_object('kind', 'missing_data', 'start_ts', start_ts, 'end_ts', end_ts,
                       'samples_lost', null, 'detail', 'Sem agregados de telemetria neste intervalo; a causa não é determinada.') order by start_ts), '[]'::jsonb)
               from gap_rows))
  from agg);
end $$;

-- Status e históricos usam o mesmo recorte: todos os terminais do workspace, no mesmo minuto mais recente.
create or replace function public.cloud_status()
returns jsonb language sql stable security invoker set search_path = public as $$
  with ws as (select public.cloud_workspace() as id),
  term as (
    select count(*)::int as terminals,
           case when count(*) = 1 then min(t.name) else count(*)::text || ' terminais' end as name,
           case when count(*) = 1 then min(t.hardware_version) end as hardware_version,
           case when count(*) = 1 then min(t.software_version) end as software_version
      from public.starlink_terminals t, ws where t.workspace_id = ws.id),
  minutes as (
    select s.ts as m from public.telemetry_samples s, ws where s.workspace_id = ws.id
    union select u.minute_ts from public.usage_intervals u, ws where u.workspace_id = ws.id),
  latest as (select max(m) as m from minutes),
  tel as (
    select sum(s.samples) as n,
           sum(s.latency_avg_ms * s.samples) / nullif(sum(s.samples) filter (where s.latency_avg_ms is not null), 0) as lat,
           sum(s.drop_avg * s.samples) / nullif(sum(s.samples) filter (where s.drop_avg is not null), 0) as drp,
           avg(s.power_avg_w) as pw
      from public.telemetry_samples s, latest where s.workspace_id = (select id from ws) and s.ts = latest.m),
  us as (
    select sum(u.bytes_down * 8 / nullif(u.samples, 0)) / 1e6 as down,
           sum(u.bytes_up * 8 / nullif(u.samples, 0)) / 1e6 as up
      from public.usage_intervals u, latest where u.workspace_id = (select id from ws) and u.minute_ts = latest.m),
  hb as (select h.* from public.agent_heartbeats h, ws where h.workspace_id = ws.id order by h.ts desc limit 1),
  ag as (select count(*) filter (where a.revoked_at is null) as agents, max(a.last_seen) as last_seen
           from public.agents a, ws where a.workspace_id = ws.id)
  select jsonb_build_object(
    'workspace_id', (select id from ws),
    'workspace_name', (select w.name from public.workspaces w, ws where w.id = ws.id),
    'agents', (select agents from ag),
    'agent_last_seen', (select extract(epoch from last_seen)::bigint from ag),
    'terminal', case when (select terminals from term) > 0 then
      (select jsonb_build_object('name', name, 'hardware_version', hardware_version, 'software_version', software_version,
                                 'count', terminals, 'scope', 'workspace') from term) end,
    'heartbeat', (select jsonb_build_object('ts', extract(epoch from ts)::bigint, 'dish_reachable', dish_reachable,
                                            'version', version, 'sync_pending', sync_pending) from hb),
    'last_minute', case when (select m from latest) is not null then jsonb_build_object(
      'ts', (select extract(epoch from m)::bigint from latest),
      'latency_ms', (select lat from tel), 'drop_pct', (select drp * 100 from tel), 'power_w', (select pw from tel),
      'down_mbps', (select down from us),
      'up_mbps', (select up from us)) end);
$$;

-- Exportação LGPD de todos os dados visíveis da conta; tokens e códigos de pareamento nunca são incluídos.
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ws uuid[];
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '28000'; end if;
  select coalesce(array_agg(workspace_id), '{}') into ws from public.workspace_members where user_id = auth.uid();
  return jsonb_build_object(
    'exportado_em', now(),
    'perfil', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'workspaces', (select coalesce(jsonb_agg(to_jsonb(w)), '[]') from public.workspaces w where w.id = any(ws)),
    'membros', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.workspace_members m where m.workspace_id = any(ws)),
    'agentes', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'workspace_id', a.workspace_id, 'nome', a.name,
                    'criado_em', a.created_at, 'visto_em', a.last_seen, 'revogado_em', a.revoked_at)), '[]')
                  from public.agents a where a.workspace_id = any(ws)),
    'terminais', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.starlink_terminals t where t.workspace_id = any(ws)),
    'capacidades', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.terminal_capabilities c where c.workspace_id = any(ws)),
    'telemetria', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.telemetry_samples s where s.workspace_id = any(ws)),
    'consumo_intervalos', (select coalesce(jsonb_agg(to_jsonb(u)), '[]') from public.usage_intervals u where u.workspace_id = any(ws)),
    'consumo_diario', (select coalesce(jsonb_agg(to_jsonb(u)), '[]') from public.usage_aggregates u where u.workspace_id = any(ws)),
    'eventos', (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from public.connection_events e where e.workspace_id = any(ws)),
    'obstrucoes', (select coalesce(jsonb_agg(to_jsonb(o)), '[]') from public.obstruction_snapshots o where o.workspace_id = any(ws)),
    'dispositivos', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from public.network_devices d where d.workspace_id = any(ws)),
    'esp32', (select coalesce(jsonb_agg(to_jsonb(n)), '[]') from public.esp32_nodes n where n.workspace_id = any(ws)),
    'leituras_esp32', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from public.esp32_sensor_readings r where r.workspace_id = any(ws)),
    'diagnosticos', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from public.diagnostic_reports d where d.workspace_id = any(ws)),
    'regras_alerta', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from public.alert_rules r where r.workspace_id = any(ws)),
    'eventos_alerta', (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from public.alert_events e where e.workspace_id = any(ws)),
    'controles', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.control_requests c where c.workspace_id = any(ws)),
    'auditoria_controle', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.control_audit_logs a where a.workspace_id = any(ws)),
    'heartbeats', (select coalesce(jsonb_agg(to_jsonb(h)), '[]') from public.agent_heartbeats h where h.workspace_id = any(ws)),
    'sincronizacoes', (select coalesce(jsonb_agg(to_jsonb(j)), '[]') from public.sync_jobs j where j.workspace_id = any(ws)),
    'cursores', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.history_cursors c where c.workspace_id = any(ws)),
    'conversas_ia', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.ai_conversations c where c.workspace_id = any(ws) and c.user_id = auth.uid()),
    'mensagens_ia', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.ai_messages m join public.ai_conversations c
                       on c.id = m.conversation_id where c.workspace_id = any(ws) and c.user_id = auth.uid())
  );
end $$;

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
revoke all on function public.cloud_telemetry(bigint, bigint, int) from public, anon;
revoke all on function public.cloud_usage_window(bigint, bigint) from public, anon;
revoke all on function public.cloud_usage_series(bigint, bigint, text, text) from public, anon;
revoke all on function public.cloud_quality(bigint, bigint, text) from public, anon;
revoke all on function public.cloud_status() from public, anon;
grant execute on function public.cloud_telemetry(bigint, bigint, int) to authenticated;
grant execute on function public.cloud_usage_window(bigint, bigint) to authenticated;
grant execute on function public.cloud_usage_series(bigint, bigint, text, text) to authenticated;
grant execute on function public.cloud_quality(bigint, bigint, text) to authenticated;
grant execute on function public.cloud_status() to authenticated;

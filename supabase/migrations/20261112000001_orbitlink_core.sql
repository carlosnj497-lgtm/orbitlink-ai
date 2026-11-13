-- OrbitLink AI — schema na nuvem (Supabase/Postgres).
-- Princípios: RLS deny-by-default em TODAS as tabelas; isolamento por workspace; timestamps UTC (timestamptz);
-- escrita de telemetria somente pela RPC ingest_batch (agente pareado por token, sem service_role).

-- =====================================================================  identidade e workspaces
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

create table public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null check (role in ('owner', 'admin', 'viewer')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- Agentes locais pareados (identidade do agente para sincronização). Token guardado só como hash.
create table public.agents (
  id          uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name        text not null,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz,
  revoked_at  timestamptz
);

-- =====================================================================  Starlink
create table public.starlink_terminals (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  terminal_key     text not null,                       -- hash do ID do terminal (nunca o ID bruto)
  name             text,
  hardware_version text,
  software_version text,
  origin           text not null default 'grpc',
  first_seen       timestamptz not null default now(),
  last_seen        timestamptz not null default now(),
  unique (workspace_id, terminal_key)
);

create table public.terminal_capabilities (
  terminal_id  uuid not null references public.starlink_terminals (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key          text not null,
  label        text,
  status       text not null,
  detail       text,
  checked_at   timestamptz not null,
  primary key (terminal_id, key)
);

-- Agregados por minuto (a nuvem não recebe as amostras de 1 s)
create table public.telemetry_samples (
  terminal_id     uuid not null references public.starlink_terminals (id) on delete cascade,
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  ts              timestamptz not null,
  samples         integer not null,
  latency_avg_ms  real,
  latency_max_ms  real,
  jitter_ms       real,
  drop_avg        real,
  full_drop_s     integer,
  downlink_max_bps real,
  uplink_max_bps  real,
  power_avg_w     real,
  source          text not null,
  primary key (terminal_id, ts)
);
create index telemetry_samples_ws_ts_idx on public.telemetry_samples (workspace_id, ts desc);

create table public.history_cursors (
  terminal_id  uuid primary key references public.starlink_terminals (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  boot_id      text not null,
  last_current bigint not null,
  updated_at   timestamptz not null default now()
);

create table public.usage_intervals (
  terminal_id  uuid not null references public.starlink_terminals (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  minute_ts    timestamptz not null,
  bytes_down   double precision not null,
  bytes_up     double precision not null,
  samples      integer not null,
  coverage     real not null check (coverage between 0 and 1),
  source       text not null check (source in ('calculada', 'demonstracao', 'importada')),
  primary key (terminal_id, minute_ts)
);
create index usage_intervals_ws_ts_idx on public.usage_intervals (workspace_id, minute_ts desc);

create table public.usage_aggregates (
  terminal_id  uuid not null references public.starlink_terminals (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  day_utc      date not null,
  bytes_down   double precision not null,
  bytes_up     double precision not null,
  bytes_total  double precision not null,
  observed_s   integer not null,
  coverage     real not null,
  source       text not null,
  primary key (terminal_id, day_utc)
);

create table public.connection_events (
  id           uuid primary key default gen_random_uuid(),
  terminal_id  uuid references public.starlink_terminals (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind         text not null,
  cause        text,
  start_ts     timestamptz not null,
  end_ts       timestamptz,
  duration_s   real,
  confidence   text not null check (confidence in ('confirmado', 'derivado', 'indeterminado')),
  evidence     jsonb,
  unique nulls not distinct (workspace_id, terminal_id, kind, start_ts)
);
create index connection_events_ws_ts_idx on public.connection_events (workspace_id, start_ts desc);

create table public.obstruction_snapshots (
  id           uuid primary key default gen_random_uuid(),
  terminal_id  uuid not null references public.starlink_terminals (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  ts           timestamptz not null,
  num_rows     integer not null,
  num_cols     integer not null,
  snr          real[] not null,
  unique (terminal_id, ts)
);

create table public.network_devices (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  terminal_id  uuid references public.starlink_terminals (id) on delete cascade,
  name         text,
  ip           inet,
  mac_masked   text,
  interface    text,
  signal_dbm   integer,
  seen_at      timestamptz not null,
  source       text not null default 'real'
);
create index network_devices_ws_idx on public.network_devices (workspace_id, seen_at desc);

-- =====================================================================  ESP32
create table public.esp32_nodes (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  device_id    text not null,
  name         text not null,
  firmware     text,
  last_seen    timestamptz,
  rssi         integer,
  unique (workspace_id, device_id)
);

create table public.esp32_sensor_readings (
  node_id      uuid not null references public.esp32_nodes (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  seq          bigint not null,
  sensor       text not null,
  ts           timestamptz not null,
  value        double precision,
  quality      text not null check (quality in ('ok', 'uncalibrated', 'fault')),
  primary key (node_id, seq, sensor)
);
create index esp32_readings_ws_ts_idx on public.esp32_sensor_readings (workspace_id, ts desc);

-- =====================================================================  diagnóstico, alertas, controle, IA
create table public.diagnostic_reports (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  terminal_id  uuid references public.starlink_terminals (id) on delete set null,
  period_start timestamptz not null,
  period_end   timestamptz not null,
  engine       text not null,
  report       jsonb not null,
  created_at   timestamptz not null default now()
);

create table public.alert_rules (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  name           text not null,
  kind           text not null,
  operator       text not null check (operator in ('gt', 'lt')),
  threshold      double precision not null,
  min_duration_s integer not null default 0,
  window_s       integer not null default 300,
  severity       text not null check (severity in ('info', 'warn', 'crit')),
  cooldown_s     integer not null default 900,
  enabled        boolean not null default true,
  created_at     timestamptz not null default now()
);

create table public.alert_events (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  rule_id      uuid references public.alert_rules (id) on delete set null,
  status       text not null check (status in ('active', 'resolved')),
  severity     text not null,
  started_at   timestamptz not null,
  resolved_at  timestamptz,
  message      text not null,
  occurrences  integer not null default 1
);

create table public.control_requests (
  operation_id text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  action       text not null,
  status       text not null,
  requested_by text not null,
  created_at   timestamptz not null,
  finished_at  timestamptz,
  result_detail text
);

create table public.control_audit_logs (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  operation_id text,
  ts           timestamptz not null,
  actor        text not null,
  event        text not null,
  detail       text
);

create table public.ai_conversations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.ai_messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);

create table public.agent_heartbeats (
  agent_id       uuid not null references public.agents (id) on delete cascade,
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  ts             timestamptz not null,
  dish_reachable boolean not null,
  version        text,
  sync_pending   integer,
  primary key (agent_id, ts)
);

create table public.sync_jobs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  agent_id     uuid not null references public.agents (id) on delete cascade,
  received_at  timestamptz not null default now(),
  counts       jsonb not null
);

-- =====================================================================  RLS (deny-by-default)
do $$
declare t text;
begin
  foreach t in array array['profiles','workspaces','workspace_members','agents','starlink_terminals','terminal_capabilities',
    'telemetry_samples','history_cursors','usage_intervals','usage_aggregates','connection_events','obstruction_snapshots',
    'network_devices','esp32_nodes','esp32_sensor_readings','diagnostic_reports','alert_rules','alert_events',
    'control_requests','control_audit_logs','ai_conversations','ai_messages','agent_heartbeats','sync_jobs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

create or replace function public.is_member(ws uuid, roles text[] default array['owner','admin','viewer'])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members m
                 where m.workspace_id = ws and m.user_id = auth.uid() and m.role = any (roles));
$$;

create policy profiles_self on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy workspaces_read on public.workspaces for select to authenticated using (public.is_member(id));
create policy members_read on public.workspace_members for select to authenticated using (public.is_member(workspace_id));
create policy agents_read on public.agents for select to authenticated using (public.is_member(workspace_id, array['owner','admin']));

-- Leitura por membros do workspace (telemetria só é escrita pela RPC ingest_batch)
do $$
declare t text;
begin
  foreach t in array array['starlink_terminals','terminal_capabilities','telemetry_samples','history_cursors','usage_intervals',
    'usage_aggregates','connection_events','obstruction_snapshots','network_devices','esp32_nodes','esp32_sensor_readings',
    'diagnostic_reports','alert_events','control_requests','control_audit_logs','agent_heartbeats','sync_jobs']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member(workspace_id))',
                   t || '_member_read', t);
  end loop;
end $$;

create policy alert_rules_read on public.alert_rules for select to authenticated using (public.is_member(workspace_id));
create policy alert_rules_write on public.alert_rules for all to authenticated
  using (public.is_member(workspace_id, array['owner','admin']))
  with check (public.is_member(workspace_id, array['owner','admin']));

create policy ai_conv_own on public.ai_conversations for all to authenticated
  using (user_id = auth.uid() and public.is_member(workspace_id))
  with check (user_id = auth.uid() and public.is_member(workspace_id));
create policy ai_msg_own on public.ai_messages for all to authenticated
  using (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid()));

-- anon nunca lê tabelas diretamente
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.alert_rules, public.ai_conversations, public.ai_messages, public.profiles to authenticated;

-- =====================================================================  bootstrap de novos usuários
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.workspaces (name, owner_id) values ('Minha Starlink', new.id) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, new.id, 'owner');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================  pareamento do agente
create or replace function public.create_agent(p_workspace uuid, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare tok text;
begin
  if not public.is_member(p_workspace, array['owner','admin']) then
    raise exception 'sem permissão para parear agente neste workspace' using errcode = '42501';
  end if;
  tok := 'olk_' || encode(sha256(gen_random_uuid()::text::bytea || clock_timestamp()::text::bytea), 'hex')
         || replace(gen_random_uuid()::text, '-', '');
  insert into public.agents (workspace_id, name, token_hash)
  values (p_workspace, left(p_name, 60), encode(sha256(convert_to(tok, 'UTF8')), 'hex'));
  return tok;  -- exibido UMA vez; guarde em ORBITLINK_SUPABASE_AGENT_TOKEN
end $$;

create or replace function public.revoke_agent(p_agent uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.agents a set revoked_at = now()
  where a.id = p_agent and public.is_member(a.workspace_id, array['owner','admin']);
end $$;

-- =====================================================================  ingestão idempotente
create or replace function public.ingest_batch(p_agent_token text, p_batch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ag record;
  term record;
  tid uuid;
  item jsonb;
  n_usage int := 0; n_tel int := 0; n_ev int := 0; n_cap int := 0;
  term_map jsonb := '{}'::jsonb;
  days date[] := '{}';
begin
  if p_agent_token is null or length(p_agent_token) < 20 then
    raise exception 'token de agente ausente' using errcode = '28000';
  end if;
  select * into ag from public.agents
   where token_hash = encode(sha256(convert_to(p_agent_token, 'UTF8')), 'hex') and revoked_at is null;
  if not found then
    raise exception 'token de agente inválido ou revogado' using errcode = '28000';
  end if;
  if pg_column_size(p_batch) > 4 * 1024 * 1024 then
    raise exception 'lote grande demais' using errcode = '54000';
  end if;

  for item in select * from jsonb_array_elements(coalesce(p_batch->'terminals', '[]'::jsonb)) loop
    insert into public.starlink_terminals (workspace_id, terminal_key, name, hardware_version, software_version, origin, last_seen)
    values (ag.workspace_id, item->>'terminal_key', item->>'name', item->>'hardware_version', item->>'software_version',
            coalesce(item->>'origin', 'grpc'), now())
    on conflict (workspace_id, terminal_key) do update set
      name = coalesce(excluded.name, starlink_terminals.name),
      hardware_version = coalesce(excluded.hardware_version, starlink_terminals.hardware_version),
      software_version = coalesce(excluded.software_version, starlink_terminals.software_version),
      last_seen = now()
    returning id into tid;
    term_map := term_map || jsonb_build_object(item->>'local_id', tid);
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_batch->'usage_minutes', '[]'::jsonb)) loop
    tid := (term_map->>(item->>'terminal_local_id'))::uuid;
    continue when tid is null;
    insert into public.usage_intervals (terminal_id, workspace_id, minute_ts, bytes_down, bytes_up, samples, coverage, source)
    values (tid, ag.workspace_id, to_timestamp((item->>'minute_ts')::bigint), (item->>'bytes_down')::float8,
            (item->>'bytes_up')::float8, (item->>'samples')::int, least(1, (item->>'coverage')::real), item->>'source')
    on conflict (terminal_id, minute_ts) do update set bytes_down = excluded.bytes_down, bytes_up = excluded.bytes_up,
      samples = excluded.samples, coverage = excluded.coverage, source = excluded.source;
    days := array_append(days, (to_timestamp((item->>'minute_ts')::bigint) at time zone 'UTC')::date);
    n_usage := n_usage + 1;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_batch->'telemetry_minutes', '[]'::jsonb)) loop
    tid := (term_map->>(item->>'terminal_local_id'))::uuid;
    continue when tid is null;
    insert into public.telemetry_samples (terminal_id, workspace_id, ts, samples, latency_avg_ms, latency_max_ms, jitter_ms,
      drop_avg, full_drop_s, downlink_max_bps, uplink_max_bps, power_avg_w, source)
    values (tid, ag.workspace_id, to_timestamp((item->>'minute_ts')::bigint), (item->>'samples')::int,
      (item->>'latency_avg')::real, (item->>'latency_max')::real, (item->>'jitter_avg')::real, (item->>'drop_avg')::real,
      (item->>'full_drop_s')::int, (item->>'downlink_max_bps')::real, (item->>'uplink_max_bps')::real,
      (item->>'power_avg_w')::real, item->>'source')
    on conflict (terminal_id, ts) do update set samples = excluded.samples, latency_avg_ms = excluded.latency_avg_ms,
      latency_max_ms = excluded.latency_max_ms, jitter_ms = excluded.jitter_ms, drop_avg = excluded.drop_avg,
      full_drop_s = excluded.full_drop_s, downlink_max_bps = excluded.downlink_max_bps,
      uplink_max_bps = excluded.uplink_max_bps, power_avg_w = excluded.power_avg_w, source = excluded.source;
    n_tel := n_tel + 1;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_batch->'events', '[]'::jsonb)) loop
    tid := (term_map->>(item->>'terminal_local_id'))::uuid;
    insert into public.connection_events (terminal_id, workspace_id, kind, cause, start_ts, end_ts, duration_s, confidence, evidence)
    values (tid, ag.workspace_id, item->>'kind', item->>'cause', to_timestamp((item->>'start_ts')::bigint),
            case when item->>'end_ts' is null then null else to_timestamp((item->>'end_ts')::bigint) end,
            (item->>'duration_s')::real, item->>'confidence', item->'evidence')
    on conflict (workspace_id, terminal_id, kind, start_ts) do update set end_ts = excluded.end_ts,
      duration_s = excluded.duration_s, evidence = excluded.evidence;
    n_ev := n_ev + 1;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_batch->'capabilities', '[]'::jsonb)) loop
    tid := (term_map->>(item->>'terminal_local_id'))::uuid;
    continue when tid is null;
    insert into public.terminal_capabilities (terminal_id, workspace_id, key, label, status, detail, checked_at)
    values (tid, ag.workspace_id, item->>'key', item->>'label', item->>'status', item->>'detail',
            to_timestamp((item->>'checked_at')::bigint))
    on conflict (terminal_id, key) do update set status = excluded.status, detail = excluded.detail,
      checked_at = excluded.checked_at, label = excluded.label;
    n_cap := n_cap + 1;
  end loop;

  -- agregados diários recalculados (idempotente) para os dias tocados
  insert into public.usage_aggregates (terminal_id, workspace_id, day_utc, bytes_down, bytes_up, bytes_total, observed_s, coverage, source)
  select u.terminal_id, u.workspace_id, (u.minute_ts at time zone 'UTC')::date, sum(u.bytes_down), sum(u.bytes_up),
         sum(u.bytes_down + u.bytes_up), sum(u.samples), least(1, sum(u.samples)::real / 86400), min(u.source)
    from public.usage_intervals u
   where u.workspace_id = ag.workspace_id and (u.minute_ts at time zone 'UTC')::date = any (days)
   group by 1, 2, 3
  on conflict (terminal_id, day_utc) do update set bytes_down = excluded.bytes_down, bytes_up = excluded.bytes_up,
    bytes_total = excluded.bytes_total, observed_s = excluded.observed_s, coverage = excluded.coverage, source = excluded.source;

  if p_batch ? 'heartbeat' then
    insert into public.agent_heartbeats (agent_id, workspace_id, ts, dish_reachable, version, sync_pending)
    values (ag.id, ag.workspace_id, to_timestamp((p_batch->'heartbeat'->>'ts')::bigint),
            coalesce((p_batch->'heartbeat'->>'dish_reachable')::boolean, false), p_batch->'heartbeat'->>'version',
            (p_batch->'heartbeat'->>'sync_pending')::int)
    on conflict do nothing;
  end if;

  update public.agents set last_seen = now() where id = ag.id;
  insert into public.sync_jobs (workspace_id, agent_id, counts)
  values (ag.workspace_id, ag.id, jsonb_build_object('usage', n_usage, 'telemetry', n_tel, 'events', n_ev, 'capabilities', n_cap));
  return jsonb_build_object('ok', true, 'usage', n_usage, 'telemetry', n_tel, 'events', n_ev, 'capabilities', n_cap,
                            'terminals', term_map);
end $$;

-- =====================================================================  retenção / downsampling
create or replace function public.apply_retention(p_minute_days int default 400, p_telemetry_days int default 400)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a int; b int; c int;
begin
  delete from public.usage_intervals where minute_ts < now() - make_interval(days => p_minute_days); get diagnostics a = row_count;
  delete from public.telemetry_samples where ts < now() - make_interval(days => p_telemetry_days); get diagnostics b = row_count;
  delete from public.agent_heartbeats where ts < now() - interval '30 days'; get diagnostics c = row_count;
  delete from public.sync_jobs where received_at < now() - interval '30 days';
  return jsonb_build_object('usage_intervals', a, 'telemetry_samples', b, 'agent_heartbeats', c);
end $$;
-- Agendamento sugerido (requer extensão pg_cron no Supabase):
--   select cron.schedule('orbitlink-retention', '17 3 * * *', $$select public.apply_retention()$$);

revoke all on function public.ingest_batch(text, jsonb) from public;
revoke all on function public.create_agent(uuid, text) from public;
revoke all on function public.revoke_agent(uuid) from public;
revoke all on function public.apply_retention(int, int) from public;
revoke all on function public.handle_new_user() from public;
grant execute on function public.ingest_batch(text, jsonb) to anon, authenticated;
grant execute on function public.create_agent(uuid, text) to authenticated;
grant execute on function public.revoke_agent(uuid) to authenticated;
grant execute on function public.is_member(uuid, text[]) to authenticated;

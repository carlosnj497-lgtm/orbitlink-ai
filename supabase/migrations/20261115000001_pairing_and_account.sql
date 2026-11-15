-- ASTRYON — pareamento por código curto e exclusão de conta.
--
-- Fluxo "sem configurar nada":
--   1. No painel na nuvem, o dono gera um código (ex.: K7QF-2M9X), válido por 15 minutos e de uso único.
--   2. O agente (instalador do Windows, aparelho pronto ou servidor) chama claim_pairing_code com o código e
--      recebe o próprio token, sem ninguém copiar token nem editar .env.
-- O código é guardado só como hash. 31 símbolos ^ 8 posições ≈ 8,5 × 10¹¹ combinações, com validade de
-- 15 minutos e no máximo 5 códigos ativos por workspace: adivinhar não é viável.

create table public.pairing_codes (
  code_hash    text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by   uuid not null references auth.users (id) on delete cascade,
  agent_name   text not null default 'Minha Starlink',
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  agent_id     uuid references public.agents (id) on delete set null
);
create index pairing_codes_ws_idx on public.pairing_codes (workspace_id);
alter table public.pairing_codes enable row level security;
alter table public.pairing_codes force row level security;
-- Sem políticas: ninguém lê a tabela diretamente; só as funções abaixo (security definer).
revoke all on public.pairing_codes from anon, authenticated;

-- Normaliza o que a pessoa digitou: maiúsculas, sem espaço nem hífen, sem confundir O/0 e I/1.
create or replace function public._norm_code(p text)
returns text language sql immutable as $$
  select translate(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), 'OIL', '011');
$$;

create or replace function public._new_agent(p_workspace uuid, p_name text, out token text, out agent_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  token := 'olk_' || encode(sha256(gen_random_uuid()::text::bytea || clock_timestamp()::text::bytea), 'hex')
           || replace(gen_random_uuid()::text, '-', '');
  insert into public.agents (workspace_id, name, token_hash)
  values (p_workspace, left(coalesce(nullif(trim(p_name), ''), 'Minha Starlink'), 60),
          encode(sha256(convert_to(token, 'UTF8')), 'hex'))
  returning id into agent_id;
end $$;

create or replace function public.create_pairing_code(p_workspace uuid, p_name text default 'Minha Starlink')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';  -- sem 0/O, 1/I/L
  rnd bytea;
  raw text := '';
  i int;
  exp timestamptz := now() + interval '15 minutes';
begin
  if not public.is_member(p_workspace, array['owner','admin']) then
    raise exception 'sem permissão para parear neste workspace' using errcode = '42501';
  end if;
  delete from public.pairing_codes where workspace_id = p_workspace and (expires_at < now() or used_at is not null);
  if (select count(*) from public.pairing_codes where workspace_id = p_workspace) >= 5 then
    raise exception 'muitos códigos ativos; espere alguns minutos' using errcode = '54000';
  end if;
  rnd := sha256(gen_random_uuid()::text::bytea || gen_random_uuid()::text::bytea || clock_timestamp()::text::bytea);
  for i in 0..7 loop
    raw := raw || substr(alphabet, 1 + (get_byte(rnd, i) % length(alphabet)), 1);
  end loop;
  insert into public.pairing_codes (code_hash, workspace_id, created_by, agent_name, expires_at)
  values (encode(sha256(convert_to(public._norm_code(raw), 'UTF8')), 'hex'), p_workspace, auth.uid(),
          left(coalesce(nullif(trim(p_name), ''), 'Minha Starlink'), 60), exp);
  return jsonb_build_object('code', substr(raw, 1, 4) || '-' || substr(raw, 5, 4), 'expires_at', exp);
end $$;

-- Chamada pelo AGENTE (papel anon): troca o código por um token próprio. Uso único.
create or replace function public.claim_pairing_code(p_code text, p_agent_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pc record;
  ag record;
begin
  update public.pairing_codes
     set used_at = now()
   where code_hash = encode(sha256(convert_to(public._norm_code(p_code), 'UTF8')), 'hex')
     and used_at is null and expires_at > now()
  returning * into pc;
  if not found then
    raise exception 'código inválido, expirado ou já usado' using errcode = '28000';
  end if;
  select * into ag from public._new_agent(pc.workspace_id, coalesce(p_agent_name, pc.agent_name));
  update public.pairing_codes set agent_id = ag.agent_id where code_hash = pc.code_hash;
  return jsonb_build_object(
    'agent_token', ag.token,
    'agent_id', ag.agent_id,
    'workspace_id', pc.workspace_id,
    'workspace_name', (select name from public.workspaces where id = pc.workspace_id)
  );
end $$;

-- Exclusão da própria conta (LGPD): apaga o usuário; workspaces que ele possui e todos os dados deles somem em
-- cascata. Workspaces de outras pessoas em que ele era só membro continuam existindo.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

-- Exportação dos dados da conta (LGPD): resumo em JSON de tudo que é dela.
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ws uuid[];
begin
  if auth.uid() is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;
  select coalesce(array_agg(workspace_id), '{}') into ws from public.workspace_members where user_id = auth.uid();
  return jsonb_build_object(
    'exportado_em', now(),
    'perfil', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'workspaces', (select coalesce(jsonb_agg(to_jsonb(w)), '[]') from public.workspaces w where w.id = any (ws)),
    'agentes', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.name, 'criado_em', a.created_at,
                                                             'visto_em', a.last_seen, 'revogado_em', a.revoked_at)), '[]')
                from public.agents a where a.workspace_id = any (ws)),
    'terminais', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.starlink_terminals t where t.workspace_id = any (ws)),
    'eventos', (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from public.connection_events e where e.workspace_id = any (ws)),
    'consumo_diario', (select coalesce(jsonb_agg(to_jsonb(u)), '[]') from public.usage_aggregates u where u.workspace_id = any (ws))
  );
end $$;

revoke all on function public._norm_code(text) from public;
revoke all on function public._new_agent(uuid, text) from public;
revoke all on function public.create_pairing_code(uuid, text) from public;
revoke all on function public.claim_pairing_code(text, text) from public;
revoke all on function public.delete_my_account() from public;
revoke all on function public.export_my_data() from public;
grant execute on function public.create_pairing_code(uuid, text) to authenticated;
grant execute on function public.claim_pairing_code(text, text) to anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.export_my_data() to authenticated;

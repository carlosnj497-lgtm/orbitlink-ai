-- ASTRYON — fecha as funções internas à API do Supabase.
--
-- Num projeto Supabase, os default privileges dão EXECUTE em toda função nova de `public` diretamente para
-- `anon` e `authenticated`. As migrations anteriores só faziam `revoke ... from public`, o que NÃO remove
-- esses grants: `apply_retention` (apaga dados de todos os workspaces) e `_new_agent` (cria token de agente
-- em qualquer workspace) ficavam chamáveis com a anon key via /rest/v1/rpc/.
--
-- Aqui: tira EXECUTE de todas as funções de `public` e devolve só a lista explícita abaixo. Funções novas
-- deixam de ganhar EXECUTE automático; cada migration futura precisa conceder o que expõe.

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
              and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')  -- extensões
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- Lista explícita do que a API expõe.
grant execute on function public.ingest_batch(text, jsonb)          to anon, authenticated;  -- agente (token próprio)
grant execute on function public.claim_pairing_code(text, text)     to anon, authenticated;  -- agente sem login
grant execute on function public.is_member(uuid, text[])            to authenticated;        -- usada nas policies
grant execute on function public.create_agent(uuid, text)           to authenticated;
grant execute on function public.revoke_agent(uuid)                 to authenticated;
grant execute on function public.create_pairing_code(uuid, text)    to authenticated;
grant execute on function public.delete_my_account()                to authenticated;
grant execute on function public.export_my_data()                   to authenticated;
grant execute on function public.cloud_workspace()                  to authenticated;
grant execute on function public.cloud_telemetry(bigint, bigint, int)            to authenticated;
grant execute on function public.cloud_usage_window(bigint, bigint)              to authenticated;
grant execute on function public.cloud_usage_series(bigint, bigint, text, text)  to authenticated;
grant execute on function public.cloud_quality(bigint, bigint, text)             to authenticated;
grant execute on function public.cloud_status()                     to authenticated;
-- Internas (sem grant): apply_retention, _new_agent, _norm_code, handle_new_user.
-- apply_retention continua disponível para o pg_cron / service_role (dono e superusuário).
grant execute on function public.apply_retention(int, int) to service_role;

-- Funções criadas daqui em diante não ganham EXECUTE automático.
-- (o EXECUTE para PUBLIC é um default global; o de anon/authenticated é por schema.)
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- Tabelas: anon nunca acessa diretamente; authenticated só escreve onde há policy de escrita.
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.alert_rules, public.ai_conversations, public.ai_messages, public.profiles to authenticated;
revoke all on public.pairing_codes from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon;

-- ai_messages: quem saiu do workspace perde acesso às mensagens das próprias conversas.
drop policy if exists ai_msg_own on public.ai_messages;
create policy ai_msg_own on public.ai_messages for all to authenticated
  using (exists (select 1 from public.ai_conversations c
                  where c.id = conversation_id and c.user_id = auth.uid() and public.is_member(c.workspace_id)))
  with check (exists (select 1 from public.ai_conversations c
                       where c.id = conversation_id and c.user_id = auth.uid() and public.is_member(c.workspace_id)));

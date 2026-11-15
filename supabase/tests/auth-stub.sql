-- STUB DE TESTE — imita o mínimo do Supabase (schema auth, auth.uid(), papéis anon/authenticated)
-- para rodar as migrations e testar RLS no PGlite, sem Docker. NÃO é aplicado no Supabase real.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', ''), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;

-- Privilégios padrão de um projeto Supabase real: toda função e tabela criada pelo dono das migrations em
-- `public` recebe EXECUTE/ALL direto para anon e authenticated (não só via PUBLIC). Sem isto, os testes não
-- pegam funções internas que ficaram chamáveis pela API (`revoke ... from public` não remove esses grants).
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

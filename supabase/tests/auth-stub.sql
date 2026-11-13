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

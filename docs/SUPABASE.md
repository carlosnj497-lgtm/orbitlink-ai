# Supabase (opcional)

O agente funciona sem Supabase. Quando configurado, ele envia agregados por minuto, eventos, capacidades e heartbeat para o seu projeto, protegidos por RLS.

## Aplicar as migrations

**Sem Docker:** use o SQL Editor do painel do Supabase.

1. Abra o projeto → SQL Editor → cole e execute `supabase/migrations/20261112000001_orbitlink_core.sql`.
2. Confira: Table Editor → as tabelas aparecem com o cadeado de RLS ativo.

Alternativa com a CLI (`supabase link` + `supabase db push`, que não exige Docker para o push remoto).

## Parear o agente

1. Crie sua conta (Authentication → Users, ou pelo fluxo de login). Um gatilho cria automaticamente o workspace "Minha Starlink" com você como dono.
2. Gere o token **localmente**, de modo que o token em si nunca seja enviado ao Supabase, só o hash:
   ```powershell
   cd apps\agent
   .venv\Scripts\python.exe -m orbitlink_agent supabase-token --email voce@exemplo.com --name "PC da sala"
   ```
   O comando imprime um `insert` com o hash. Execute-o no SQL Editor. Também existe a RPC `create_agent(workspace, nome)`, para quem chama com o JWT do usuário a partir de um app.
3. No `.env`:
   ```
   ORBITLINK_SUPABASE_URL=https://<projeto>.supabase.co
   ORBITLINK_SUPABASE_ANON_KEY=<anon key>
   ORBITLINK_SUPABASE_AGENT_TOKEN=olk_...
   ```
4. Reinicie o agente. Em `GET /v1/sync` (ou na Saúde da coleta, em "Sync pendente") a fila deve zerar.

## Garantias

- Nenhuma `service_role` no agente ou no painel. Só a anon key (pública) e o token do agente (guardado como hash no banco).
- `ingest_batch` faz upsert por chave natural, então reenviar não duplica. Agregados diários são recalculados por dia tocado.
- Offline: os itens ficam em `sync_queue` (SQLite), com backoff exponencial de até 30 min. Ao voltar, a fila é drenada em lotes de 500.
- Revogar um agente: `select public.revoke_agent('<agent_id>')`.
- Retenção: `select public.apply_retention();`. Para agendar, veja o comentário com `pg_cron` na migration.

## Testes de isolamento

`npm run test -w supabase` roda as migrations num Postgres real em WASM (PGlite), com um stub mínimo de `auth`, e verifica:

- A vê os próprios dados.
- B não vê nada de A.
- anon não lê tabelas.
- Ninguém grava telemetria diretamente.
- Token inválido ou revogado é recusado.
- Reenvio do mesmo lote é idempotente.

`supabase/seed/` contém só dados **artificiais** de desenvolvimento (nenhum seed é necessário em produção).

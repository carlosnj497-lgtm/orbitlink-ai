# Arquitetura

```
 Navegador ──HTTP──▶ Next.js (localhost, porta 3000)
                      │  /api/auth/*   login/setup → cookie httpOnly (SameSite=Strict)
                      │  /api/agent/*  proxy autenticado (+ SSE) — injeta token de serviço + sessão
                      ▼
               Agente FastAPI (localhost, porta 8787) ──gRPC──▶ Starlink Mini (IP-DA-ANTENA, porta 9200)
                │   ├─ Coletor asyncio (status 10 s, histórico 30 s, obstrução 5 min, capacidades 1 h)
                │   ├─ SQLite WAL (data/orbitlink.sqlite3) + migrations
                │   ├─ Alertas · Diagnóstico por regras · Relatórios · Controle auditado · IA (opcional)
                │   └─ Sync worker ──HTTPS──▶ Supabase RPC ingest_batch (opcional)
                └─ Listener ESP32 (todas as interfaces, porta 8788, opcional) ◀── HMAC ── ESP32 na LAN
```

## Decisões

| Tema | Decisão | Motivo |
|---|---|---|
| Schema gRPC | **Reflection** em runtime (`grpcio-reflection` + `protobuf`) | O conjunto de chamadas muda com o firmware. Protos compilados ficariam desatualizados. Campos ausentes continuam ausentes. |
| Conversão | `MessageToDict(always_print_fields_with_no_presence=True)` | Distingue "0 no schema" (ex.: 0 Mbps = ocioso) de "campo inexistente". |
| Teste sem antena | `FixtureTransport` + servidor gRPC sintético com reflection (`tests/fakegrpc`) | Exercita o caminho real de reflection. Toda fixture exige `_fixture.kind`. |
| Navegador ↔ agente | Sempre via proxy Next | O token de serviço nunca chega ao navegador, e o agente fica só em loopback. |
| Banco local | SQLite WAL, um writer com lock e `asyncio.to_thread` | Sem servidor extra e robusto offline. |
| Sincronização | RPC `ingest_batch` com anon key + token do agente | Sem `service_role` na máquina, com upsert idempotente. |
| ESP32 | Listener separado, apenas 3 rotas HMAC | Superfície mínima na LAN. A API principal continua em loopback. |
| IA | Loop manual de tools `strict`, somente leitura | O modelo não tem como executar ações. |

## Pipeline de dados

1. **Status** (`get_status`, ~10 s): normalizado em `DishStatus` (métricas com `source`), gravado em `status_samples`. Também abre e fecha eventos `status_outage` e `unreachable`.
2. **Histórico** (`get_history`, ~30 s): anel de N amostras de 1 s com contador `current`.
   - Lê só `[cursor, current)`, limitado ao anel. O excedente vira **lacuna** `history_lost`.
   - Reinício da antena = `current` diminuiu **ou** `uptime` menor que o tempo desde o último poll. Gera novo `boot_id` e evento `boot`.
   - PK `(terminal, boot_id, counter)` + `INSERT OR IGNORE` dão idempotência.
3. **Agregados por minuto**: `usage_minutes` (bytes = Σ bps × 1 s / 8, com cobertura = amostras/60) e `quality_minutes` (latência, jitter, perda e potência). São recalculados a partir das amostras e substituídos, nunca somados.
4. **Eventos derivados**: sequências ≥ 2 s de perda total geram `ping_drop` (confiança *derivado*). `get_history.outages` gera `outage` (*confirmado* se o timestamp é plausível).
5. **Lacunas**: agente parado (`agent_offline`, via heartbeat), antena inacessível e anel estourado. Ficam **fora** dos denominadores de disponibilidade e consumo.
6. **Retenção**: amostras de 1 s por 7 dias e agregados por 400 dias (configurável).

## Autenticação

- **Local:** administrador criado no primeiro acesso (só a partir do loopback), senha com hash scrypt e sessões opacas de 12 h guardadas como SHA-256. Login com limite de tentativas.
- **Serviço:** `ORBITLINK_API_TOKEN` (Bearer) obrigatório em todas as rotas `/v1` exceto `/v1/health`.
- **Supabase (opcional):** usuários na nuvem isolados por RLS. Se o Supabase ficar fora do ar, o acesso local continua funcionando normalmente, sem nenhum desvio de verificação.

## Endpoints principais (`/v1`)

`health`, `agent`, `status`, `capabilities`, `capabilities/refresh`, `telemetry`, `usage/summary|series|hourly-profile|compare|import/*`, `quality`, `events`, `obstruction`, `diagnose`, `diagnostics/summary|anomalies`, `control/actions|prepare|confirm|cancel|requests`, `alerts/*`, `reports/export`, `devices`, `esp32/*`, `ai/*`, `settings`, `sync`, `stream` (SSE).

OpenAPI: `http://localhost:8787/docs` (exige token para chamar). Tipos TS: `packages/shared/src/generated`.

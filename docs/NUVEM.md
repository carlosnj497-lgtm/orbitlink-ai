# Serviço na nuvem (contas por e-mail)

Com a nuvem, qualquer pessoa cria uma conta, conecta a Starlink com um código curto e acompanha de qualquer
lugar, sem servidor, Tailscale nem arquivo de configuração.

```
[Casa]  Starlink ← agente ASTRYON ──HTTPS──▶  Supabase (contas + RLS)  ──▶  painel na Vercel (login por e-mail)
          (Windows, aparelho ou servidor)       dados separados por conta
```

O agente continua necessário: a API da antena só existe dentro da rede da casa. A nuvem recebe agregados por
minuto (consumo, latência, perda, quedas), não as amostras de 1 segundo nem a lista de aparelhos da rede.

## 1. Banco (Supabase)

1. Crie um projeto em <https://supabase.com> (o plano gratuito serve para começar).
2. No **SQL Editor**, rode os arquivos de `supabase/migrations/` **na ordem do nome**, um de cada vez:
   - `20261112000001_astryon_core.sql` (se ainda não aplicou)
   - `20261115000001_pairing_and_account.sql`
   - `20261115000002_cloud_queries.sql`
   - `20261115000003_lock_function_grants.sql` (obrigatória: restringe funções internas)
   - `20261120000001_cloud_regressions.sql` (limites, agregações, lacunas e exportação da nuvem)

   Todos foram testados em Postgres real (`npm run test -w supabase`, inclusive isolamento entre contas).
3. Em **Authentication → Providers → Email**: deixe "Confirm email" ligado e o mínimo de senha em 10.
4. Em **Authentication → URL Configuration**: em "Site URL" coloque o endereço do painel na Vercel
   (ex.: `https://astryon.vercel.app`) e acrescente `https://astryon.vercel.app/login` e `https://astryon.vercel.app/login/redefinir` em "Redirect URLs"
   (a segunda é a página de "Esqueci a senha"; sem ela, o link do e-mail de recuperação não funciona).
5. Para cumprir a retenção de 400 dias informada no painel, agende a limpeza (requer a extensão pg_cron):
   `select cron.schedule('astryon-retention', '17 3 * * *', $$select public.apply_retention()$$);`

Anote em **Settings → API**: a *Project URL* e a chave *anon public*. As duas são públicas por desenho; quem
protege os dados é a RLS. **Nunca** use a chave `service_role` no painel nem no agente.

## 2. Painel (Vercel)

1. Em <https://vercel.com>, **Add New → Project** e importe o repositório do GitHub.
2. **Root Directory:** `apps/web`. O resto a Vercel detecta (Next.js, instalação pelo `package-lock.json` da raiz).
3. **Environment Variables:**

   | Variável | Valor |
   |---|---|
   | `ASTRYON_CLOUD` | `1` |
   | `NEXT_PUBLIC_ASTRYON_CLOUD` | `1` |
   | `ASTRYON_SUPABASE_URL` | a Project URL |
   | `ASTRYON_SUPABASE_ANON_KEY` | a chave anon public |
   | `ASTRYON_CLOUD_TIMEZONE` | `America/Sao_Paulo` (fuso dos gráficos) |

4. **Deploy.** Abra o endereço, crie a sua conta, confirme o e-mail e entre.

O mesmo código continua servindo o painel local: sem essas variáveis, ele fala com o agente como antes.

## 3. Conectar uma Starlink

1. No painel da nuvem: **Conta → Conectar a antena → Gerar código** (vale 15 minutos, uso único).
2. Digite o código no agente:
   - **Windows:** ícone do ASTRYON → **Conectar à conta…**
   - **Aparelho pronto:** `http://astryon.local/aparelho` no celular (veja [APARELHO.md](APARELHO.md)).
   - **Servidor Linux / painel local:** Configurações → **Conta na nuvem**, ou `astryon-agent pair CÓDIGO`.
3. Os dados aparecem no painel da nuvem em alguns minutos.

Para o instalador do Windows já vir apontando para a sua nuvem, crie no GitHub (Settings → Secrets and variables
→ Actions → **Variables**) `ASTRYON_CLOUD_SUPABASE_URL` e `ASTRYON_CLOUD_SUPABASE_ANON_KEY` e gere o instalador de novo.

## O que a nuvem mostra (e o que fica no painel local)

| Na nuvem | Só no painel local |
|---|---|
| Dashboard, Consumo, Qualidade, Antena, Eventos, Conta | Ao vivo (1 s), Central de IA, Controle da antena, ESP32, Alertas e Telegram, Clima, Relatórios PDF, Configurações do agente |

Os alertas e o bot do Telegram continuam funcionando, porque rodam no agente.

## Privacidade e LGPD

- Cada conta só enxerga os próprios dados (RLS no banco, testada).
- O identificador da antena vira hash antes de sair da casa; a localização não é enviada.
- Em **Conta**: baixar todos os dados (JSON), remover o acesso de um agente e excluir a conta (apaga tudo na nuvem).
- Termos em `/termos` e política em `/privacidade`, aceitos no cadastro. Revise os textos antes de abrir para o público.

## Custos

Supabase e Vercel têm planos gratuitos que comportam dezenas de antenas. O que mais cresce é o banco: cerca de
1.440 linhas por antena por dia (com limpeza aos 400 dias).

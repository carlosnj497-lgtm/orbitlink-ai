# Deploy HTTPS do backend (protótipo)

Este diretório sobe o backend FastAPI + Caddy com HTTPS automático via Docker Compose.

## Pré-requisitos

- Um servidor Linux com Docker e Docker Compose instalados.
- Um domínio ou subdomínio apontando para o IP do servidor (registro DNS tipo A).
- Portas 80 e 443 liberadas no firewall.

## Passo a passo

1. Edite o `Caddyfile` e troque `api.seudominio.com` pelo seu domínio real.
2. Suba os serviços:

```bash
cd prototypes/mobile-gateway/deploy
docker compose up -d --build
```

3. Verifique se o backend respondeu:

```bash
curl https://api.seudominio.com/api/v1/health
```

4. Abra o dashboard:

```
https://api.seudominio.com/dashboard
```

5. No app Flutter, ajuste `API_BASE_URL` em
   `app/astryon_mobile/lib/services/api_service.dart` para:

```
https://api.seudominio.com/api/v1
```

## Persistência

O banco SQLite fica no volume Docker `astryon_data`, montado em `/data/gateway.db`.
Para backup:

```bash
docker compose exec api sqlite3 /data/gateway.db ".backup '/data/backup.db'"
docker cp $(docker compose ps -q api):/data/backup.db ./backup.db
```

## Atualização

```bash
git pull
docker compose up -d --build
```

## ⚠️ Produção

Este deploy é um protótipo. Antes de expor publicamente:

- Troque CORS de `*` para origens específicas.
- Adicione autenticação de usuário (Supabase Auth, OAuth, etc.).
- Use Postgres gerenciado em vez de SQLite.
- Adicione rate limiting, logs estruturados e monitoramento.
- Configure backup automático e política de retenção.

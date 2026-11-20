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

5. No app Flutter, informe a URL do backend em **Configurações → Servidor**
   (engrenagem no dashboard). Como alternativa, compile com:

```bash
flutter build apk --release --dart-define=ASTRYON_API_BASE_URL=https://api.seudominio.com/api/v1
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

## Publicar uma atualização do app

**Automático (recomendado):** crie uma tag `vX.Y.Z` no repositório. O workflow
**Build Mobile Gateway APK** publica o APK e o `latest.json` numa GitHub Release
do repositório **público** de releases (`astryon-releases`, ajustável por
`ASTRYON_RELEASES_REPO`; a publicação usa o secret `RELEASES_TOKEN`). Depois,
aponte o backend para esse manifesto:

```
ASTRYON_RELEASE_MANIFEST_URL=https://github.com/carlosnj497-lgtm/astryon-releases/releases/latest/download/latest.json
```

O backend serve o manifesto em `/api/v1/app/latest` e faz o proxy do download em
`/api/v1/app/download`.

**Manual:** coloque o APK em `backend/releases/` (a versão sai do nome do arquivo
ou de `ASTRYON_APP_VERSION`) e reinicie o serviço:

```bash
docker compose up -d --build
```

Para não reconstruir a imagem a cada release, monte um volume e aponte
`ASTRYON_APK_DIR` para ele.

## ⚠️ Produção

Este deploy é um protótipo. Antes de expor publicamente:

- Defina `ASTRYON_CORS_ORIGINS` com origens específicas e `ASTRYON_ADMIN_TOKEN`
  para proteger as rotas de leitura agregada.
- Adicione autenticação de usuário (Supabase Auth, OAuth, etc.).
- Use Postgres gerenciado em vez de SQLite.
- Adicione rate limiting, logs estruturados e monitoramento.
- Configure backup automático e política de retenção.

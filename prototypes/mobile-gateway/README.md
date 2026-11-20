# ASTRYON Mobile Gateway — Protótipo

Protótipo funcional de um app mobile que funciona como gateway leve: lê a API local da antena Starlink (`192.168.100.1:9200`) e envia os dados para um backend central com dashboard web.

> ⚠️ Este é um protótipo de validação. Não use em produção sem adicionar autenticação forte, mTLS, rate limiting, criptografia e compliance (LGPD/GDPR).

---

## 🎯 Conceito

O usuário baixa o app no celular, conecta o celular no Wi-Fi da antena Starlink e faz login. O app lê a API local da antena e envia os dados para o servidor ASTRYON via conexão outbound (HTTPS).

```
┌─────────────────┐         Wi-Fi LAN         ┌─────────────────┐
│  Celular do     │  ───────────────────────► │  Antena Starlink│
│  usuário (app)  │   gRPC :9200               │  192.168.100.1  │
└─────────────────┘                            └─────────────────┘
         │
         │ HTTPS/MQTTS outbound
         ▼
┌─────────────────┐
│ Servidor ASTRYON│  ← FastAPI + SQLite (protótipo)
│  (seu servidor) │
└─────────────────┘
         │
         ▼
┌─────────────────┐
│ Dashboard web   │  ← HTML/JS + Chart.js (protótipo)
└─────────────────┘
```

---

## ✅ O que está implementado

### Backend (`backend/`)

- `POST /api/v1/auth/pairing` — gera código de pareamento
- `POST /api/v1/devices/register` — registra dispositivo e emite token
- `POST /api/v1/telemetry` — recebe telemetria autenticada por token
- `GET /api/v1/devices` — lista dispositivos
- `GET /api/v1/devices/{id}/telemetry` — últimos registros de um dispositivo
- `GET /api/v1/summary` — resumo agregado para o dashboard
- `GET /api/v1/app/latest` — manifesto da atualização do app (`{version, url, sha256, size, filename, notes}`)
- `GET /api/v1/app/download` — baixa o APK mais recente publicado em `backend/releases/`
- `GET /api/v1/health` — health check
- `GET /dashboard` — dashboard web com gráfico em tempo real

> As rotas de leitura agregada (`/devices`, `/devices/{id}/telemetry` e
> `/summary`) exigem o header `X-Admin-Token` **quando** a variável
> `ASTRYON_ADMIN_TOKEN` está definida; sem ela, o acesso continua aberto para o
> protótipo. O CORS é configurável por `ASTRYON_CORS_ORIGINS`.

### App Flutter (`app/astryon_mobile/`)

- Pareamento guiado por código de pareamento ou QR Code, com revisão antes do registro
- URL do backend configurável em **Configurações → Servidor** (ou `--dart-define=ASTRYON_API_BASE_URL=...`)
- Token do dispositivo no armazenamento seguro do Android (`flutter_secure_storage`)
- Verificação TCP da antena (`192.168.100.1:9200`)
- Envio de **amostra de demonstração** explicitamente marcada como tal (nunca como dado real)
- Coleta periódica em background com Workmanager (15 min), só com leitura real disponível
- Despareamento manual e saída automática para o pareamento quando o token é inválido
- Atualização do app pelo backend (Configurações → Atualizações): baixa o APK, confere o sha256 e abre o instalador do Android
- Serviço gRPC pronto para leitura real (requer geração dos protobufs)

### Deploy (`deploy/`)

- Docker Compose com FastAPI + Caddy
- HTTPS automático via Let's Encrypt
- Volume persistente para o SQLite

### Protobufs (`app/astryon_mobile/protos/`)

- Definições `.proto` da API Starlink (device, dish, wifi, etc.)
- Script `tool/gen_protos.sh` para gerar o código Dart

---

## 🚀 Fluxo de onboarding

1. Usuário cria conta no site/app.
2. Servidor gera um **token de pareamento** único.
3. Usuário abre o app mobile e digita o token (ou escaneia QR).
4. O app verifica se consegue alcançar `192.168.100.1:9200` na rede local.
5. Se sim, o app registra o dispositivo no servidor e começa a enviar telemetria.
6. Usuário vê os dados no dashboard web.

---

## 🔌 API entre app e servidor

### Base URL

```
https://api.astryon.example.com/api/v1
```

No protótipo local, use `http://localhost:8000/api/v1`.

### Autenticação

Cada dispositivo envia seu `device_token` no header:

```http
X-Device-Token: <device_token>
```

### Endpoints

#### 1. Criar token de pareamento

```http
POST /auth/pairing
Content-Type: application/json

{
  "user_id": "uuid-do-usuario"
}
```

Resposta:

```json
{
  "pairing_code": "A3B7-X9K2",
  "expires_at": "2026-11-21T10:00:00Z"
}
```

#### 2. Registrar dispositivo

```http
POST /devices/register
Content-Type: application/json

{
  "pairing_code": "A3B7-X9K2",
  "device_name": "Celular do Carlos",
  "starlink_ip": "192.168.100.1",
  "starlink_model": "unknown"
}
```

Resposta:

```json
{
  "device_id": "dev_abc123",
  "device_token": "tok_seguro_aqui",
  "status": "active"
}
```

#### 3. Enviar telemetria

```http
POST /telemetry
Content-Type: application/json
X-Device-Token: tok_seguro_aqui

{
  "timestamp": "2026-11-19T14:30:00Z",
  "source": "mobile_gateway",
  "data": {
    "reachable": true,
    "downlink_throughput_bps": 120500000,
    "uplink_throughput_bps": 15200000,
    "pop_ping_latency_ms": 38.0,
    "pop_ping_drop_rate": 0.0,
    "obstruction_fraction": 0.01
  }
}
```

Resposta:

```json
{
  "status": "ok",
  "received_at": "2026-11-19T14:30:01Z"
}
```

#### 4. Resumo para dashboard

```http
GET /summary
```

Resposta:

```json
{
  "generated_at": "2026-11-19T14:30:01Z",
  "device_count": 1,
  "online_count": 1,
  "sample_count": 42,
  "devices": [
    {
      "id": "dev_abc123",
      "name": "Celular do Carlos",
      "status": "active",
      "last_seen": "2026-11-19T14:30:01Z",
      "online": true
    }
  ],
  "recent_telemetry": []
}
```

---

## 📁 Estrutura

```
prototypes/mobile-gateway/
├── README.md
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   ├── .env.example
│   ├── Dockerfile
│   └── static/
│       └── index.html          # dashboard web
├── deploy/
│   ├── docker-compose.yml
│   ├── Caddyfile
│   └── README.md
└── app/astryon_mobile/
    ├── pubspec.yaml
    ├── prototypes/             # arquivos .proto da Starlink
    ├── tool/
    │   └── gen_protos.sh
    └── lib/
        ├── main.dart
        ├── pairing_code.dart
        ├── models/
        │   ├── telemetry.dart
        │   └── app_release.dart
        ├── services/
        │   ├── api_service.dart
        │   ├── api_exception.dart
        │   ├── app_config.dart
        │   ├── app_updater.dart
        │   ├── token_store.dart
        │   ├── version_compare.dart
        │   ├── starlink_service.dart
        │   ├── starlink_grpc_service.dart
        │   └── background_service.dart
        └── screens/
            ├── pairing_screen.dart
            ├── pairing_scanner_screen.dart
            ├── dashboard_screen.dart
            └── settings_screen.dart
```

---

## 🔄 Publicar uma atualização do app

Há dois caminhos; o **automático** é o recomendado:

**1. Automático (tag `v*`)** — crie e envie uma tag de versão:

```bash
git tag v0.3.1 && git push origin v0.3.1
```

O workflow **Build Mobile Gateway APK** compila o APK com a versão da tag e
publica, no repositório **público** de releases (`astryon-releases`, ajustável
por `ASTRYON_RELEASES_REPO`, via secret `RELEASES_TOKEN`), uma GitHub Release com
`astryon-mobile-<versão>.apk` e um `latest.json`
(`{version, url, sha256, size, filename}`). Aponte o backend para esse manifesto:

```
ASTRYON_RELEASE_MANIFEST_URL=https://github.com/carlosnj497-lgtm/astryon-releases/releases/latest/download/latest.json
```

O backend então serve esse manifesto em `/api/v1/app/latest` e faz o **proxy** do
download em `/api/v1/app/download`.

**2. Manual (arquivo local)** — copie o APK para `backend/releases/` (a versão
sai do nome do arquivo ou de `ASTRYON_APP_VERSION`) e reinicie/rode novamente o
backend. Não precisa configurar nada.

Em ambos os casos, o app vê a atualização em Configurações → Atualizações.

## ▶️ Como rodar o backend localmente

```bash
cd prototypes/mobile-gateway/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

- Documentação interativa: `http://localhost:8000/docs`
- Dashboard web: `http://localhost:8000/dashboard`

---

## 🐳 Deploy com HTTPS

Veja o guia completo em [`deploy/README.md`](deploy/README.md).

Resumo:

```bash
cd prototypes/mobile-gateway/deploy
# edite o Caddyfile com seu domínio
docker compose up -d --build
```

---

## 📱 Como rodar o app

1. Instale o Flutter: https://docs.flutter.dev/get-started/install
2. Gere as pastas de plataforma:

```bash
cd prototypes/mobile-gateway/app/astryon_mobile
flutter create .
```

3. Informe a URL do backend em **Configurações → Servidor** no app (ou compile
   com `--dart-define=ASTRYON_API_BASE_URL=https://seu.servidor/api/v1`).
4. Gere o código Dart dos protobufs (opcional, para leitura real):

```bash
bash tool/gen_protos.sh
```

5. Conecte um celular físico ao Wi-Fi da antena Starlink e execute:

```bash
flutter pub get
flutter run
```

> Emuladores não conseguem acessar a rede local da antena. Use um celular físico.

### Configuração Android (Workmanager)

No `android/app/src/main/AndroidManifest.xml`, adicione:

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
<uses-permission android:name="android.permission.WAKE_LOCK"/>
```

### Configuração iOS (background)

No `ios/Runner/Info.plist`, adicione:

```xml
<key>UIBackgroundModes</key>
<array>
  <string>fetch</string>
  <string>processing</string>
</array>
```

> O iOS limita a execução em background. Para produção, considere notificações push para acordar o app.

---

## ⚠️ Limitações conhecidas

- **Background no iOS:** o iOS limita execução contínua em segundo plano. No Android, o Workmanager tem frequência mínima de 15 minutos.
- **Disponibilidade:** se o usuário sair de casa, o celular não consegue mais ler a antena.
- **API gRPC real:** o serviço `starlink_grpc_service.dart` está pronto, mas depende da geração dos protobufs com `protoc`.
- **Segurança:** tokens simples em SQLite. Em produção, use mTLS, criptografia e banco seguro.
- **Escala:** SQLite não é adequado para múltiplos servidores. Migre para Postgres antes de escalar.

---

## 🔜 Próximos passos

1. Validar se o celular consegue acessar `192.168.100.1:9200` na rede Starlink.
2. Integrar `starlink_grpc_service.dart` ao dashboard após gerar os protobufs.
3. Adicionar envio em background com Workmanager (já implementado, requer configurar Android/iOS).
4. Evoluir o backend para Postgres multi-tenant + Row Level Security.
5. Adicionar mTLS e autenticação de usuários.
6. Criar dashboard SaaS de produção (Next.js) com autenticação.

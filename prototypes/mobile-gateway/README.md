# ASTRYON Mobile Gateway — Protótipo

Protótipo de um app mobile que funciona como gateway leve: lê a API local da antena Starlink (`192.168.100.1:9200`) e envia os dados para um backend central.

> ⚠️ Este é um protótipo de validação. Não use em produção sem adicionar autenticação forte, mTLS, criptografia, controle de erros e compliance (LGPD/GDPR).

---

## 🎯 Conceito

O usuário baixa o app no celular, conecta o celular no Wi-Fi da antena Starlink e faz login. O app passa a ler a API local da antena periodicamente e envia os dados para o servidor ASTRYON via conexão outbound (HTTPS).

```
┌─────────────────┐         Wi-Fi LAN         ┌─────────────────┐
│  Celular do     │  ───────────────────────► │  Antena Starlink│
│  usuário (app)  │   gRPC :9200 / TCP        │  192.168.100.1  │
└─────────────────┘                           └─────────────────┘
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
│ Dashboard SaaS  │  ← Next.js / web / mobile
└─────────────────┘
```

---

## 🚀 Fluxo de onboarding

1. Usuário cria conta no site/app.
2. Servidor gera um **token de pareamento** único.
3. Usuário abre o app mobile e digita o token (ou escaneia QR).
4. O app verifica se consegue alcançar `192.168.100.1:9200` na rede local.
5. Se sim, o app registra o dispositivo no servidor e começa a enviar telemetria.
6. Usuário vê os dados no dashboard.

---

## 🔌 API entre app e servidor

### Base URL

```
https://api.astryon.example.com/api/v1
```

No protótipo, use `http://localhost:8000/api/v1`.

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
  "expires_at": "2026-11-20T10:00:00Z"
}
```

#### 2. Registrar dispositivo (chamado pelo app)

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
    "snr": 42.0,
    "download_mbps": 120.5,
    "upload_mbps": 15.2,
    "latency_ms": 38.0
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

#### 4. Listar dispositivos

```http
GET /devices
```

Resposta:

```json
{
  "devices": [
    {
      "id": "dev_abc123",
      "name": "Celular do Carlos",
      "status": "online",
      "last_seen": "2026-11-19T14:30:01Z"
    }
  ]
}
```

---

## 📁 Estrutura

```
prototypes/mobile-gateway/
├── README.md                 # este arquivo
├── backend/                  # FastAPI de protótipo
│   ├── main.py
│   ├── requirements.txt
│   └── .env.example
└── app/astryon_mobile/       # Flutter app de protótipo
    ├── pubspec.yaml
    └── lib/
        ├── main.dart
        ├── services/
        │   ├── auth_service.dart
        │   ├── starlink_service.dart
        │   └── telemetry_service.dart
        └── screens/
            ├── pairing_screen.dart
            └── dashboard_screen.dart
```

---

## ▶️ Como rodar o backend

```bash
cd prototypes/mobile-gateway/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Acesse a documentação interativa em `http://localhost:8000/docs`.

---

## 📱 Como rodar o app

1. Instale o Flutter: https://docs.flutter.dev/get-started/install
2. Conecte um celular Android ou iOS (ou use emulador, lembrando que emulador não acessa rede local da antena).
3. Execute:

```bash
cd prototypes/mobile-gateway/app/astryon_mobile
flutter pub get
flutter run
```

> Para testar a leitura real da antena, o celular precisa estar conectado ao Wi-Fi do roteador Starlink.

---

## ⚠️ Limitações conhecidas

- **Background no iOS:** o iOS limita execução contínua em segundo plano. Para leituras frequentes, use WorkManager no Android ou notificações/push no iOS.
- **Disponibilidade:** se o usuário sair de casa, o celular não consegue mais ler a antena.
- **API gRPC real:** este protótipo faz apenas verificação TCP de acessibilidade. A leitura gRPC com os protobufs requer integração com `grpc-dart` e os arquivos `.proto` da antena.
- **Segurança:** tokens simples em SQLite. Em produção, use mTLS, criptografia e banco seguro.

---

## 🔜 Próximos passos

1. Validar se o celular consegue acessar `192.168.100.1:9200` na rede Starlink.
2. Integrar `grpc-dart` com os arquivos `.proto` da antena.
3. Adicionar envio em background com WorkManager/Background Fetch.
4. Evoluir o backend para Postgres multi-tenant + Row Level Security.
5. Adicionar mTLS e criptografia de dados em trânsito e em repouso.

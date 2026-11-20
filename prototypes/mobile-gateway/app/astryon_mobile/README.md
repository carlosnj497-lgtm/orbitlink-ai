# ASTRYON Mobile — App Gateway

Protótipo Flutter para validar o conceito de gateway mobile.

## Funcionalidades atuais

- Pareamento guiado com QR Code ou código manual e revisão antes do registro
- Permissão de câmera solicitada somente ao abrir o leitor de QR Code
- Registro do dispositivo no backend, com token guardado no armazenamento seguro do Android
- URL do backend configurável em **Configurações → Servidor** (ou `--dart-define=ASTRYON_API_BASE_URL=...`)
- Verificação de acessibilidade da antena Starlink (`192.168.100.1:9200`)
- Envio de amostra de demonstração, sempre marcada como demonstração
- Coleta periódica em background (Workmanager, 15 min), só com leitura real
- Despareamento manual e retorno ao pareamento quando o token é inválido
- Atualização do app pelo backend (Configurações → Atualizações): baixa o novo APK,
  confere o sha256 e abre o instalador do Android

## 🔄 Atualização do app

O backend publica a versão mais recente em `GET /api/v1/app/latest`
(`{version, url, sha256, size, filename, notes}`) e serve o APK em
`GET /api/v1/app/download`. Em **Configurações → Atualizações**, o app compara a
versão instalada com a publicada; se houver uma mais nova, baixa o APK, confere
o `sha256` e abre o instalador do Android.

Publicar uma versão: envie uma tag `vX.Y.Z` (`git tag v0.3.1 && git push origin
v0.3.1`) e o workflow publica o APK e o `latest.json` numa GitHub Release do
repositório público de releases (`astryon-releases`, via secret
`RELEASES_TOKEN`). Aponte o backend para `ASTRYON_RELEASE_MANIFEST_URL`. Como
alternativa, copie o `.apk` para `backend/releases/` (a versão sai do nome do
arquivo ou de `ASTRYON_APP_VERSION`).

## 📱 Como obter o APK Android

### Opção 1 — GitHub Actions (recomendado, sem instalar nada)

O repositório já tem o workflow **Build Mobile Gateway APK**.

1. Acesse o repositório no GitHub.
2. Vá em **Actions** → **Build Mobile Gateway APK**.
3. Clique em **Run workflow**.
4. Aguarde o build terminar.
5. Baixe o artefato **astryon-mobile-gateway-apk**.
6. Dentro dele estará o arquivo `app-release.apk`.
7. Envie o APK para o celular e instale (permita instalação de fontes desconhecidas).

### Opção 2 — Compilar localmente

1. Instale o Flutter: https://docs.flutter.dev/get-started/install
2. Gere as pastas de plataforma:

```bash
cd prototypes/mobile-gateway/app/astryon_mobile
flutter create . --platforms=android
```

3. Adicione as permissões no `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
<uses-permission android:name="android.permission.WAKE_LOCK"/>
<uses-permission android:name="android.permission.CAMERA"/>
```

4. Ajuste a URL do backend em **Configurações → Servidor** no app (a engrenagem
   no canto do dashboard). Como alternativa, compile com
   `--dart-define=ASTRYON_API_BASE_URL=https://seu.servidor/api/v1`.

### Formato do QR Code de pareamento

O leitor aceita o código impresso diretamente (por exemplo, `A3B7-X9K2`) ou um link
`astryon://pair?code=A3B7-X9K2`. URLs HTTPS com os parâmetros `code` ou
`pairing_code` também funcionam. Após a leitura, o app sempre mostra uma revisão
antes de registrar o dispositivo.

5. Gere e instale:

```bash
flutter pub get
flutter test
flutter build apk --release
```

O APK fica em `build/app/outputs/flutter-apk/app-release.apk`.

Para instalar direto no celular conectado por USB:

```bash
flutter install --release
```

## 🔐 Assinatura do APK

O workflow gera um APK **debug/release não assinado** com a chave padrão do Flutter. Para distribuir na Play Store ou fora dela de forma segura:

1. Gere uma keystore:

```bash
keytool -genkey -v -keystore astryon.jks -keyalg RSA -keysize 2048 -validity 10000 -alias astryon
```

2. Configure `android/key.properties` e `android/app/build.gradle.kts`.
3. Guarde a keystore e as senhas em segredo (nunca no Git).

## ⚠️ Limitações

- O APK gerado pelo workflow é para testes internos.
- O app precisa estar conectado ao Wi-Fi da antena para ler os dados locais.
- A leitura gRPC real requer gerar os protobufs com `tool/gen_protos.sh`; até lá o
  app não envia dado real — o botão do dashboard envia uma amostra marcada como
  demonstração.
- O background no Android tem frequência mínima de 15 minutos e só envia quando
  há leitura real disponível.

## Próximos passos

- Integrar `starlink_grpc_service.dart` ao dashboard após gerar os protobufs.
- Configurar assinatura de release.
- Publicar em um canal de testes (Firebase App Distribution ou Play Console interno).

# ASTRYON Mobile — App Gateway

Protótipo Flutter para validar o conceito de gateway mobile.

## Funcionalidades atuais

- Login com código de pareamento
- Registro do dispositivo no backend
- Verificação de acessibilidade da antena Starlink (`192.168.100.1:9200`)
- Envio de telemetria para o backend
- Coleta periódica em background (Workmanager, 15 min)

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
```

4. Ajuste a URL do backend em `lib/services/api_service.dart`.
5. Gere e instale:

```bash
flutter pub get
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
- A leitura gRPC real requer gerar os protobufs com `tool/gen_protos.sh`.
- O background no Android tem frequência mínima de 15 minutos.

## Próximos passos

- Integrar `starlink_grpc_service.dart` ao dashboard após gerar os protobufs.
- Configurar assinatura de release.
- Publicar em um canal de testes (Firebase App Distribution ou Play Console interno).

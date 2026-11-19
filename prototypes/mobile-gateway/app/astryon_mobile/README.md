# ASTRYON Mobile — App Gateway

Protótipo Flutter para validar o conceito de gateway mobile.

## Funcionalidades atuais

- Login com código de pareamento
- Registro do dispositivo no backend
- Verificação de acessibilidade da antena Starlink (`192.168.100.1:9200`)
- Envio simulado/placeholder de telemetria para o backend

## Como rodar

1. Instale o Flutter.
2. Conecte um celular Android/iOS na rede Starlink.
3. Edite `lib/services/api_service.dart` e aponte para o seu backend.
4. Execute:

```bash
flutter pub get
flutter run
```

> Emuladores não conseguem acessar a rede local da antena. Use um celular físico.

## Próximos passos

- Integrar `grpc-dart` com os arquivos `.proto` da antena.
- Adicionar envio periódico em background com `workmanager` (Android) / `background_fetch` (iOS).
- Implementar cache offline e reenvio quando a internet voltar.

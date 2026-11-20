# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

- Pessoas configurando o próprio gateway, com familiaridade básica com redes e Starlink.
- Clientes finais sem conhecimento técnico que precisam concluir o pareamento guiado.
- Ambos os perfis devem ser atendidos pela mesma experiência mobile.

## Product Purpose

O ASTRYON Mobile Gateway permite que um celular conectado ao Wi-Fi da antena Starlink leia seus dados locais e envie telemetria ao backend ASTRYON. A tela de pareamento registra o dispositivo com um código gerado no dashboard e um nome identificável; após o registro, o token fica armazenado no aparelho e o usuário segue para o dashboard mobile.

## Positioning

O produto usa o próprio celular como gateway entre a API local da antena (`192.168.100.1:9200`) e o monitoramento ASTRYON, sem depender do computador para essa coleta móvel. O projeto ASTRYON mais amplo prioriza operação local, origem explícita das métricas e ausência de dados inventados.

## Operating Context

- O aparelho precisa estar conectado ao Wi-Fi da antena para coletar os dados locais.
- O código de pareamento é gerado no dashboard/backend e informado no aplicativo.
- O fluxo é usado tanto por quem entende a configuração de rede quanto por clientes que precisam de instruções claras.
- O Android usa coleta periódica com Workmanager, limitada a intervalos mínimos de 15 minutos.

## Capabilities and Constraints

- Entrada manual do código de pareamento e do nome do dispositivo.
- Pareamento pelo endpoint existente de registro, com token e ID do dispositivo salvos no armazenamento seguro do aparelho.
- QR Code deve entrar no fluxo como nova forma de obter o código, com as integrações necessárias no aplicativo.
- A experiência deve cobrir orientação, validação, progresso, falha e sucesso sem prometer conexões que ainda não foram verificadas.
- A URL do backend é configurável no aplicativo (Configurações) e por `--dart-define`; o protótipo aceita HTTP na rede local e permite HTTPS fora dela.
- A leitura gRPC real depende da geração dos protobufs; até lá o app não envia telemetria inventada — a amostra de demonstração é sempre rotulada como demonstração.

## Brand Commitments

- Nome do produto: ASTRYON Mobile Gateway, parte do ASTRYON.
- Interface e mensagens em português do Brasil.
- Projeto independente, sem afiliação com Starlink ou SpaceX; não sugerir endosso.

## Evidence on Hand

- Visão geral e princípios do ASTRYON: `README.md`.
- Funcionalidades, limitações e arquitetura do protótipo: `prototypes/mobile-gateway/README.md`.
- Fluxo e instruções do aplicativo: `prototypes/mobile-gateway/app/astryon_mobile/README.md`.
- Implementação atual: `prototypes/mobile-gateway/app/astryon_mobile/lib/screens/pairing_screen.dart` e `lib/services/api_service.dart`.
- Não há demonstrações, validação em antena real ou ativos de marca mobile que possam ser apresentados como evidência adicional.

## Product Principles

- Guiar sem exigir conhecimento técnico, mantendo detalhes úteis acessíveis a usuários técnicos.
- Distinguir claramente código recebido, dispositivo registrado e antena conectada; uma etapa não deve fingir sucesso da seguinte.
- Oferecer escolha entre leitura por QR Code e digitação manual sem criar becos sem saída.
- Preservar dados e capturas reais: erros devem ser compreensíveis, sem mensagens de sucesso antecipadas.
- Respeitar padrões nativos do Android, acessibilidade e funcionamento com teclado e diferentes escalas de fonte.

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Uma pessoa só: o dono da Starlink Mini, que monitora a própria antena pelo servidor de casa (Ubuntu, Celeron J1800). Usa o painel no PC e no celular para saber se a internet está boa, entender quedas e acompanhar o consumo do mês.

## Product Purpose

OrbitLink AI monitora, diagnostica e controla com segurança uma Starlink Mini usando apenas a API local gRPC da antena. Sucesso: o dono vê em segundos se a conexão está saudável, descobre a causa quando não está e confia que cada número é real.

## Positioning

Funciona 100% local, sem nuvem obrigatória, e cada métrica mostra a origem (`real`, `calculada`, `estimada`, `importada`, `sensor_esp32`, `indisponível`, `demonstração`). Nada é inventado: lacuna de observação nunca vira zero.

## Operating Context

- Agente Python (FastAPI, SQLite, SSE) em loopback; painel Next.js atrás do Nginx, acessível na LAN e na Tailnet.
- Serviços systemd `orbitlink-agent` e `orbitlink-web`; o painel de produção roda `next start` a partir do repositório.
- Modo demonstração só em `/demo`, com faixa permanente.
- Integrações opcionais: ESP32, Supabase, Telegram/webhook, IA via Groq.

## Capabilities and Constraints

- Telas: visão geral, ao vivo, qualidade, consumo, interrupções, obstruções, antena, dispositivos, ESP32, alertas, relatórios, diagnósticos, Central de IA, controle, configurações, setup, registro.
- Central de IA: assistente Groq com ferramentas somente leitura, histórico de conversas (`ai/conversations`), regras como fallback sem chave. A IA só propõe ações; executar exige confirmação humana.
- Reiniciar a antena exige matriz de capacidades, administrador e código de uso único.
- Hardware modesto: animações leves, sem bibliotecas pesadas.
- Mudanças de visual ficam no frontend; agente, Supabase, systemd e contratos de API não mudam sem autorização.

## Brand Commitments

- Letreiro "SPACEX" na barra lateral e no cabeçalho mobile (`Wordmark.tsx`), feito com tipografia e arco próprios, sem o arquivo oficial do logo. Confirmado pelo dono em 14/11/2026.
- Projeto independente, sem afiliação com Starlink/SpaceX; não usar logos oficiais.
- Não apresentar Claude/Anthropic como parte do produto.
- Textos em português do Brasil.

## Evidence on Hand

- Dados reais vêm só do agente. A antena ainda pode estar ausente; telas precisam de estados vazios e de indisponibilidade honestos.
- Dados fictícios existem apenas em `src/lib/demo-data.ts`, usados em `/demo`.

## Product Principles

1. Honestidade dos dados acima de aparência: sem métricas fictícias, "Online" só com confirmação da API.
2. Estado da conexão legível em um relance, no PC e no celular.
3. Ações perigosas sempre com confirmação explícita.
4. Leve o suficiente para um servidor doméstico fraco.

## Accessibility & Inclusion

Contraste AA no tema escuro, respeito a `prefers-reduced-motion`, alvos de toque adequados no celular. O E2E roda axe sem violações sérias.

# Compatibilidade com a Starlink

## Fontes consultadas (nov/2026)

- API local oficial: `SpaceExplorationTechnologies/enterprise-api/device-api`. Define o serviço `SpaceX.API.Device.Device/Handle` e publica somente `get_diagnostics` (dish ≥ 2023.51.0, roteador ≥ 2023.55). Antena em `192.168.100.1:9200`, roteador em `192.168.1.1:9000`.
- `sparky8512/starlink-grpc-tools` (Unlicense): usa gRPC reflection para `get_status`, `get_history`, `dish_get_obstruction_map`, `reboot` etc. Histórico com amostras de 1 s em anel de ~15 min. Desde 2026-05, a **localização não está disponível via gRPC na maioria dos planos**.

## O que o OrbitLink usa

| Recurso | Chamada | Uso | Observação |
|---|---|---|---|
| Status | `get_status` → `dish_get_status` | leitura a cada 10 s | Tráfego **corrente** (não capacidade), latência e perda ao PoP, obstrução, alertas, uptime e firmware |
| Histórico | `get_history` → `dish_get_history` | leitura a cada 30 s | Anel de 1 s. `power_in` e `outages` só se o firmware enviar |
| Mapa de obstrução | `dish_get_obstruction_map` | a cada 5 min **se verificado** | Grade SNR (−1 = sem dado) |
| Info | `get_device_info` | sondagem | Hardware e firmware |
| Diagnóstico oficial | `get_diagnostics` | sondagem | Pode retornar UNIMPLEMENTED |
| Clientes Wi-Fi | `wifi_get_clients` (roteador) | sob demanda | Só se o roteador responder |
| Reiniciar | `reboot` | **somente** com confirmação | Nunca sondado. A autorização só é conhecida ao executar |
| Localização | `get_location` | **não consultado** | Privacidade |
| Stow | `dish_stow` | **não oferecido** | Fora do escopo |

## Matriz de capacidades (runtime)

Estados: `verificada`, `schema_presente` (existe no schema, mas não foi executada), `ausente_no_schema`, `campo_ausente`, `nao_implementada` (UNIMPLEMENTED), `negada` (PERMISSION_DENIED), `timeout`, `inalcancavel`, `erro` e `nao_consultada`.

Ela é renovada a cada hora e sempre que a antena volta a responder. Um indicador indisponível nunca bloqueia o resto do painel.

## Semântica obrigatória

- `downlink/uplink_throughput_bps` são **tráfego atual**. Mbps = bps / 1 000 000. O valor 0 normalmente indica **ocioso**.
- `pop_ping_latency_ms` é medida pela antena até o PoP. Não é ping até sites.
- O consumo é **estimado** pela integração das amostras de 1 s e não corresponde ao valor oficial. Use a importação de CSV para comparar com a conta.
- O timestamp de `outages.start_timestamp_ns` não tem época documentada. O OrbitLink testa época Unix e GPS e marca a confiança.

## Validação na sua rede (quando a Mini chegar)

1. Conecte o PC ao Wi-Fi da Mini **ou** ligue a Mini ao seu roteador e garanta a rota para `192.168.100.1`. Em modo bypass, isso costuma exigir uma rota estática `192.168.100.1/32 → WAN` no roteador.
2. Execute `scripts\diagnose.ps1`. O esperado é `[OK] Status da antena (get_status)` e `Histórico`.
3. Opcional: `scripts\diagnose.ps1 -SaveFixture apps\agent\tests\fixtures\mini_real.json`. Isso grava respostas reais **anonimizadas** (ID, localização e MACs removidos) para regressão.
4. Inicie o agente e confira na Visão Geral o selo **real** e o horário da primeira amostra.

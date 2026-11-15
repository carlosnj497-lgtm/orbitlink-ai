# Home Assistant (MQTT)

O agente pode publicar os dados da Starlink num broker MQTT. Com a descoberta automática ligada, os sensores
aparecem sozinhos no Home Assistant, agrupados no dispositivo **ASTRYON · nome da antena**.

## Ativar

1. No Home Assistant, instale o broker **Mosquitto** (Configurações → Complementos) e a integração **MQTT**.
   Crie um usuário para o ASTRYON.
2. No `.env` do agente (no Ubuntu: `/etc/astryon/astryon.env`), preencha:

   ```
   ASTRYON_MQTT_HOST=IP-DO-HOME-ASSISTANT
   ASTRYON_MQTT_PORT=1883
   ASTRYON_MQTT_USERNAME=astryon
   ASTRYON_MQTT_PASSWORD=senha-do-usuario
   ```

3. Reinicie o agente. Em Configurações → Conexões do painel, "MQTT / Home Assistant" deve mostrar **conectado**.

## Sensores

| Sensor | Unidade | Observação |
|---|---|---|
| Download / Upload | Mbit/s | Tráfego corrente, não capacidade da conexão |
| Latência até o PoP | ms | Medida pela antena até o ponto de presença da Starlink |
| Perda de ping | % | |
| Obstrução | % | |
| Estado da conexão | texto | conectada, degradada, offline... |
| Antena acessível | ligado/desligado | Se o agente consegue falar com a antena |
| Franquia usada no ciclo | % | Só com a franquia configurada; estimativa local |
| Disponibilidade 24 h | % | Segundos sem medição ficam fora da conta |
| Chuva agora (estimada) | mm/h | Só com o clima configurado |

Valor que a antena não informa vai como vazio e aparece como "desconhecido", nunca como zero.
Se o agente cair, o broker publica **offline** sozinho (last will) e os sensores ficam indisponíveis.

## Ideias de automação

- Avisar na Alexa ou no celular quando "Antena acessível" desligar por mais de 2 minutos.
- Ligar uma tomada inteligente para reiniciar o roteador quando a perda passar de 20% por 10 minutos.
- Acender uma luz vermelha quando a franquia passar de 90%.

## Opções

| Variável | Padrão | O que faz |
|---|---|---|
| `ASTRYON_MQTT_TLS` | `false` | Conecta com TLS (porta costuma ser 8883) |
| `ASTRYON_MQTT_TOPIC_PREFIX` | `astryon` | Prefixo dos tópicos `astryon/<id>/state` e `/status` |
| `ASTRYON_MQTT_DISCOVERY` | `true` | Publica a descoberta automática em `homeassistant/...` |
| `ASTRYON_MQTT_INTERVAL_S` | `30` | Intervalo de publicação, em segundos |

A senha do MQTT é tratada como segredo: não aparece no painel nem nos logs.

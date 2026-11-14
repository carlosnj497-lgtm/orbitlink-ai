# ESP32: nó de telemetria (opcional)

O ESP32 **não** fala com a antena. Ele mede o próprio ambiente e a alimentação (quando há sensores) e envia ao agente pela LAN, com mensagens assinadas. Sem ESP32, o OrbitLink funciona normalmente.

## Hardware

| Item | Necessário? | Observação |
|---|---|---|
| ESP32 DevKit v1 (ESP32-WROOM-32) | sim | Sozinho: heartbeat, RSSI, uptime e firmware |
| INA219 (I²C) | opcional | **Máximo de 26 V no barramento.** Para fontes acima disso, use INA226 (36 V) ou módulo isolado, sempre com fusível |
| DS18B20 | opcional | Temperatura ambiente/caixa, com pull-up de 4,7 kΩ no DATA |
| Sensor de presença de alimentação | opcional | Optoacoplador ou divisor que entregue **≤ 3,3 V** no GPIO34 |

> ⚠️ **Nunca** ligue sensores de baixa tensão na rede AC. Não use relés para desligar a Starlink: isso está fora do escopo e exigiria projeto elétrico específico. A temperatura interna da antena só aparece se a própria API expuser.

### Pinagem (DevKit v1)

| Função | GPIO |
|---|---|
| I²C SDA / SCL (INA219) | 21 / 22 |
| OneWire (DS18B20) | 4 |
| Entrada de alimentação presente | 34 (somente entrada, sem pull-up interno) |
| LED de status | 2 |
| Reset de configuração (segurar 5 s) | 0 (BOOT) |

## Compilar e gravar via USB

Instale o driver USB-serial da placa (CP210x ou CH340, conforme o modelo).

```powershell
cd C:\...\starlink
python -m venv tools-venv
tools-venv\Scripts\python.exe -m pip install platformio
cd apps\esp32-firmware
..\..\tools-venv\Scripts\pio.exe run -e esp32dev                    # só a placa (padrão)
..\..\tools-venv\Scripts\pio.exe run -e esp32dev -t upload          # gravar (porta COM detectada)
..\..\tools-venv\Scripts\pio.exe device monitor -b 115200           # ver logs
# Com sensores: ajuste include\config.h e use -e esp32dev_sensors
```

Ambos os ambientes compilam neste repositório (verificado em 12/11/2026: `esp32dev` usa 80% da flash).

## Parear

1. No `.env`, defina `ORBITLINK_ESP32_ENABLED=true` e reinicie (`stop.ps1` + `start.ps1`). Libere a porta 8788 **só para a rede privada** (veja [WINDOWS_SETUP.md](WINDOWS_SETUP.md)).
2. No painel, abra **Centro ESP32 → Gerar código de pareamento**. O código vale 10 minutos e uma única vez.
3. Ligue o ESP32. Ele cria o Wi-Fi `OrbitLink-Setup-XXXX`. Conecte-se, escolha sua rede e informe:
   - **IP do agente**: o IP deste PC na sua rede local (`SEU-IP`)
   - **Porta**: 8788
   - **Código** de 6 dígitos
4. O nó aparece como **online** no painel em até 30 s.

## Protocolo v1

- `POST /esp32/v1/pair` `{code, device_id, firmware, sensors[]}` → `{secret, server_time}`
- `POST /esp32/v1/ingest` e `/heartbeat` com cabeçalhos `X-OL-Device`, `X-OL-Ts`, `X-OL-Nonce` e `X-OL-Sig = hex(HMAC_SHA256(secret, device\nts\nnonce\nsha256(body)))`
- Corpo: `{"v":1,"readings":[{"seq","ts"|0,"age_ms"?,"sensor","value","quality":"ok|uncalibrated|fault"}],"status":{rssi,uptime_s,fw,heap,buffered,dropped}}`
- Relógio: NTP quando há internet. Senão, o firmware usa o `server_time` do agente.
- Buffer: anel de 64 leituras. Quando enche, **descarta a mais antiga** e conta em `dropped`. O reenvio é idempotente por `(nó, seq, sensor)`.
- `power.present = 0` abre o evento `power_loss`, que é usado no diagnóstico como hipótese ao coincidir com "antena inacessível".
- OTA: desativado neste MVP. Qualquer atualização futura será autenticada e só sob pedido.

## Testar sem placa (emulador)

```powershell
apps\agent\.venv\Scripts\python.exe scripts\esp32_emulator.py pair --code 123456
apps\agent\.venv\Scripts\python.exe scripts\esp32_emulator.py run --count 5 --power-loss
apps\agent\.venv\Scripts\python.exe scripts\esp32_emulator.py replay     # deve responder 401
```

Os dados do emulador são sintéticos. Remova o nó emulado no painel depois.

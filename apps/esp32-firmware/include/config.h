// ASTRYON — configuração de hardware do nó ESP32.
// Sensores são opcionais e ficam DESLIGADOS no ambiente padrão (esp32dev). Sem sensor, nenhum dado elétrico é enviado.
#pragma once

#ifndef OL_FW_VERSION
#define OL_FW_VERSION "0.0.0"
#endif

// ---- Pinos (ESP32 DevKit v1) ------------------------------------------------
#define OL_PIN_RESET_BUTTON 0      // botão BOOT: segurar 5 s apaga configuração/pareamento
#define OL_PIN_STATUS_LED 2        // LED azul da DevKit
#define OL_PIN_I2C_SDA 21          // INA219
#define OL_PIN_I2C_SCL 22
#define OL_PIN_ONEWIRE 4           // DS18B20 (resistor pull-up 4,7 kΩ para 3V3)
#define OL_PIN_POWER_SENSE 34      // entrada SOMENTE com optoacoplador/divisor adequado (máx. 3,3 V!)

// ---- INA219 (medição DC) ----------------------------------------------------
// ATENÇÃO: INA219 suporta até 26 V no barramento. A alimentação da Starlink Mini (12–48 V DC conforme a fonte)
// pode exceder esse limite: use INA226 (36 V) ou módulo isolado adequado, com fusível. Nunca ligue em AC.
#define OL_INA219_ADDR 0x40
#define OL_INA219_MAX_BUS_V 26.0f
#define OL_INA219_CALIBRATED 0     // 1 somente após calibrar com multímetro; senão leituras saem como "uncalibrated"

// ---- Temporização -----------------------------------------------------------
#define OL_SAMPLE_INTERVAL_MS 30000UL
#define OL_SEND_INTERVAL_MS 30000UL
#define OL_HTTP_TIMEOUT_MS 8000
#define OL_RING_CAPACITY 64        // leituras guardadas durante falhas de Wi-Fi; ao encher, descarta a MAIS ANTIGA

// ---- Rede -------------------------------------------------------------------
#define OL_DEFAULT_AGENT_PORT 8788
#define OL_AP_PREFIX "ASTRYON-Setup-"

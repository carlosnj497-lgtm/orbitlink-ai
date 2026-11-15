// ASTRYON — nó de telemetria ESP32 (protocolo v1).
//
// O ESP32 NÃO fala com a antena Starlink: ele mede o próprio ambiente/alimentação (quando há sensores) e envia
// ao agente ASTRYON pela LAN, com mensagens assinadas (HMAC-SHA256, nonce único, timestamp).
//
// Fluxo:
//  1. Primeiro boot: abre o portal Wi-Fi "ASTRYON-Setup-XXXX" (WiFiManager). Informe Wi-Fi, IP do agente e o
//     código de pareamento de 6 dígitos gerado no painel (Centro ESP32).
//  2. O firmware chama POST /esp32/v1/pair e guarda o segredo no NVS (Preferences). O código é de uso único.
//  3. A cada 30 s: lê sensores habilitados, guarda num anel de 64 leituras e envia /esp32/v1/ingest assinado.
//  4. Segurar o botão BOOT por 5 s apaga Wi-Fi e pareamento.

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <esp_random.h>
#include <mbedtls/base64.h>
#include <mbedtls/md.h>
#include <time.h>

#include "config.h"

#if OL_ENABLE_INA219
#include <Adafruit_INA219.h>
#include <Wire.h>
static Adafruit_INA219 ina219(OL_INA219_ADDR);
static bool inaOk = false;
#endif
#if OL_ENABLE_DS18B20
#include <DallasTemperature.h>
#include <OneWire.h>
static OneWire oneWire(OL_PIN_ONEWIRE);
static DallasTemperature ds18b20(&oneWire);
#endif

struct Reading {
  uint32_t seq;
  uint32_t ts;        // epoch s (0 = relógio desconhecido; usa age)
  uint32_t takenMs;   // millis() da leitura, para calcular age_ms
  char sensor[28];
  float value;
  bool hasValue;
  const char *quality;
};

static Preferences prefs;
static Reading ring[OL_RING_CAPACITY];
static size_t ringHead = 0, ringCount = 0;
static uint32_t dropped = 0, seqCounter = 0;
static String deviceId, agentHost, secretB64;
static uint16_t agentPort = OL_DEFAULT_AGENT_PORT;
static int64_t timeOffset = 0;  // servidor - relógio local (quando não há NTP)
static bool timeKnown = false;
static uint32_t lastSample = 0, lastSend = 0, backoffMs = 0;

// ------------------------------------------------------------------ utilidades
static String hexOf(const uint8_t *buf, size_t n) {
  static const char *h = "0123456789abcdef";
  String s;
  s.reserve(n * 2);
  for (size_t i = 0; i < n; i++) {
    s += h[buf[i] >> 4];
    s += h[buf[i] & 0xF];
  }
  return s;
}

static String sha256Hex(const String &data) {
  uint8_t out[32];
  mbedtls_md(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), (const uint8_t *)data.c_str(), data.length(), out);
  return hexOf(out, 32);
}

static String hmacHex(const String &msg) {
  uint8_t key[64];
  size_t keyLen = 0;
  if (mbedtls_base64_decode(key, sizeof(key), &keyLen, (const uint8_t *)secretB64.c_str(), secretB64.length()) != 0) return "";
  uint8_t out[32];
  mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), key, keyLen, (const uint8_t *)msg.c_str(), msg.length(), out);
  memset(key, 0, sizeof(key));
  return hexOf(out, 32);
}

static String randomNonce() {
  uint8_t b[12];
  esp_fill_random(b, sizeof(b));
  return hexOf(b, sizeof(b));
}

static uint32_t nowEpoch() {
  time_t t = time(nullptr);
  if (t > 1700000000) {
    timeKnown = true;
    return (uint32_t)t;
  }
  if (timeOffset != 0) return (uint32_t)((int64_t)(millis() / 1000) + timeOffset);
  return 0;
}

static void ledBlink(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(OL_PIN_STATUS_LED, HIGH);
    delay(60);
    digitalWrite(OL_PIN_STATUS_LED, LOW);
    delay(90);
  }
}

// ------------------------------------------------------------------ anel de leituras
static void push(const char *sensor, float value, bool hasValue, const char *quality) {
  Reading &r = ring[(ringHead + ringCount) % OL_RING_CAPACITY];
  if (ringCount == OL_RING_CAPACITY) {  // cheio: descarta a mais antiga (política documentada)
    ringHead = (ringHead + 1) % OL_RING_CAPACITY;
    dropped++;
  } else {
    ringCount++;
  }
  r.seq = ++seqCounter;
  r.ts = nowEpoch();
  r.takenMs = millis();
  strncpy(r.sensor, sensor, sizeof(r.sensor) - 1);
  r.sensor[sizeof(r.sensor) - 1] = 0;
  r.value = value;
  r.hasValue = hasValue;
  r.quality = quality;
  prefs.putUInt("seq", seqCounter);  // seq monotônico entre reinícios => idempotência no agente
}

static void sampleSensors() {
#if OL_ENABLE_INA219
  if (inaOk) {
    float busV = ina219.getBusVoltage_V();
    float shuntmV = ina219.getShuntVoltage_mV();
    float currentA = ina219.getCurrent_mA() / 1000.0f;
    float v = busV + shuntmV / 1000.0f;
    const char *q = OL_INA219_CALIBRATED ? "ok" : "uncalibrated";
    if (v > OL_INA219_MAX_BUS_V || v < 0) q = "fault";
    push("power.voltage_v", v, true, q);
    push("power.current_a", currentA, true, q);
    push("power.power_w", v * currentA, true, q);
  } else {
    push("power.voltage_v", 0, false, "fault");
  }
#endif
#if OL_ENABLE_DS18B20
  ds18b20.requestTemperatures();
  float t = ds18b20.getTempCByIndex(0);
  if (t == DEVICE_DISCONNECTED_C) push("env.temp_c", 0, false, "fault");
  else push("env.temp_c", t, true, "ok");
#endif
#if OL_ENABLE_POWER_SENSE
  push("power.present", digitalRead(OL_PIN_POWER_SENSE) ? 1.0f : 0.0f, true, "ok");
#endif
}

// ------------------------------------------------------------------ HTTP
static String baseUrl() { return "http://" + agentHost + ":" + String(agentPort); }

static int signedPost(const char *path, const String &body, String &resp) {
  uint32_t ts = nowEpoch();
  if (ts == 0) return -100;  // sem relógio: o agente recusaria (janela de tempo)
  String nonce = randomNonce();
  String sig = hmacHex(deviceId + "\n" + String(ts) + "\n" + nonce + "\n" + sha256Hex(body));
  if (sig.isEmpty()) return -101;
  HTTPClient http;
  http.setTimeout(OL_HTTP_TIMEOUT_MS);
  if (!http.begin(baseUrl() + path)) return -102;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-OL-Device", deviceId);
  http.addHeader("X-OL-Ts", String(ts));
  http.addHeader("X-OL-Nonce", nonce);
  http.addHeader("X-OL-Sig", sig);
  int code = http.POST(body);
  resp = http.getString();
  http.end();
  return code;
}

static void syncTimeFromAgent() {
  HTTPClient http;
  http.setTimeout(OL_HTTP_TIMEOUT_MS);
  if (!http.begin(baseUrl() + "/esp32/v1/time")) return;
  if (http.GET() == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) {
      timeOffset = (int64_t)doc["server_time"].as<uint32_t>() - (int64_t)(millis() / 1000);
    }
  }
  http.end();
}

static bool pairWithAgent(const String &code) {
  JsonDocument doc;
  doc["code"] = code;
  doc["device_id"] = deviceId;
  doc["firmware"] = OL_FW_VERSION;
  JsonArray s = doc["sensors"].to<JsonArray>();
#if OL_ENABLE_INA219
  s.add("power.voltage_v");
  s.add("power.current_a");
  s.add("power.power_w");
#endif
#if OL_ENABLE_DS18B20
  s.add("env.temp_c");
#endif
#if OL_ENABLE_POWER_SENSE
  s.add("power.present");
#endif
  String body;
  serializeJson(doc, body);
  HTTPClient http;
  http.setTimeout(OL_HTTP_TIMEOUT_MS);
  if (!http.begin(baseUrl() + "/esp32/v1/pair")) return false;
  http.addHeader("Content-Type", "application/json");
  int code_ = http.POST(body);
  String resp = http.getString();
  http.end();
  if (code_ != 200) {
    Serial.printf("[astryon] pareamento recusado: HTTP %d\n", code_);
    return false;
  }
  JsonDocument r;
  if (deserializeJson(r, resp)) return false;
  secretB64 = r["secret"].as<String>();
  timeOffset = (int64_t)r["server_time"].as<uint32_t>() - (int64_t)(millis() / 1000);
  prefs.putString("secret", secretB64);
  Serial.println("[astryon] pareado com sucesso");
  return true;
}

static void sendBatch() {
  if (secretB64.isEmpty()) return;
  if (!timeKnown && timeOffset == 0) syncTimeFromAgent();
  JsonDocument doc;
  doc["v"] = 1;
  JsonArray arr = doc["readings"].to<JsonArray>();
  size_t n = min(ringCount, (size_t)50);
  for (size_t i = 0; i < n; i++) {
    const Reading &r = ring[(ringHead + i) % OL_RING_CAPACITY];
    JsonObject o = arr.add<JsonObject>();
    o["seq"] = r.seq;
    o["ts"] = r.ts;
    if (r.ts == 0) o["age_ms"] = millis() - r.takenMs;
    o["sensor"] = r.sensor;
    if (r.hasValue) o["value"] = r.value;
    else o["value"] = nullptr;
    o["quality"] = r.quality;
  }
  JsonObject st = doc["status"].to<JsonObject>();
  st["rssi"] = WiFi.RSSI();
  st["uptime_s"] = millis() / 1000;
  st["fw"] = OL_FW_VERSION;
  st["heap"] = ESP.getFreeHeap();
  st["buffered"] = ringCount;
  st["dropped"] = dropped;
  String body, resp;
  serializeJson(doc, body);
  int code = signedPost(n ? "/esp32/v1/ingest" : "/esp32/v1/heartbeat", body, resp);
  if (code == 200) {
    ringHead = (ringHead + n) % OL_RING_CAPACITY;
    ringCount -= n;
    backoffMs = 0;
    JsonDocument r;
    if (!deserializeJson(r, resp) && r["server_time"].is<uint32_t>() && !timeKnown)
      timeOffset = (int64_t)r["server_time"].as<uint32_t>() - (int64_t)(millis() / 1000);
    ledBlink(1);
  } else {
    backoffMs = min<uint32_t>(backoffMs ? backoffMs * 2 : 5000, 300000);
    Serial.printf("[astryon] envio falhou (%d), nova tentativa em %lus\n", code, (unsigned long)(backoffMs / 1000));
    if (code == 401) syncTimeFromAgent();
  }
}

// ------------------------------------------------------------------ setup/loop
static void factoryResetIfHeld() {
  uint32_t start = millis();
  while (digitalRead(OL_PIN_RESET_BUTTON) == LOW) {
    if (millis() - start > 5000) {
      Serial.println("[astryon] apagando configuração e pareamento");
      prefs.clear();
      WiFiManager wm;
      wm.resetSettings();
      ledBlink(10);
      ESP.restart();
    }
    delay(50);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(OL_PIN_STATUS_LED, OUTPUT);
  pinMode(OL_PIN_RESET_BUTTON, INPUT_PULLUP);
#if OL_ENABLE_POWER_SENSE
  pinMode(OL_PIN_POWER_SENSE, INPUT);
#endif
  prefs.begin("astryon", false);
  uint64_t mac = ESP.getEfuseMac();
  char id[32];
  snprintf(id, sizeof(id), "esp32-%04x%08lx", (uint16_t)(mac >> 32), (unsigned long)mac);
  deviceId = String(id);
  agentHost = prefs.getString("host", "");
  agentPort = prefs.getUShort("port", OL_DEFAULT_AGENT_PORT);
  secretB64 = prefs.getString("secret", "");
  seqCounter = prefs.getUInt("seq", 0);
  factoryResetIfHeld();

  WiFiManager wm;
  WiFiManagerParameter pHost("host", "IP do agente ASTRYON", agentHost.c_str(), 64);
  WiFiManagerParameter pPort("port", "Porta (padrão 8788)", String(agentPort).c_str(), 6);
  WiFiManagerParameter pCode("code", "Código de pareamento (6 dígitos)", "", 7);
  wm.addParameter(&pHost);
  wm.addParameter(&pPort);
  wm.addParameter(&pCode);
  wm.setConfigPortalTimeout(300);
  String ap = String(OL_AP_PREFIX) + deviceId.substring(deviceId.length() - 4);
  bool needPortal = secretB64.isEmpty() || agentHost.isEmpty();
  bool ok = needPortal ? wm.startConfigPortal(ap.c_str()) : wm.autoConnect(ap.c_str());
  if (!ok) ESP.restart();
  if (strlen(pHost.getValue())) {
    agentHost = pHost.getValue();
    prefs.putString("host", agentHost);
  }
  if (strlen(pPort.getValue())) {
    agentPort = (uint16_t)atoi(pPort.getValue());
    prefs.putUShort("port", agentPort);
  }
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  syncTimeFromAgent();
  if (strlen(pCode.getValue()) == 6) pairWithAgent(String(pCode.getValue()));

#if OL_ENABLE_INA219
  Wire.begin(OL_PIN_I2C_SDA, OL_PIN_I2C_SCL);
  inaOk = ina219.begin();
#endif
#if OL_ENABLE_DS18B20
  ds18b20.begin();
#endif
  Serial.printf("[astryon] %s fw %s agente %s:%u %s\n", deviceId.c_str(), OL_FW_VERSION, agentHost.c_str(), agentPort,
                secretB64.isEmpty() ? "(NÃO PAREADO)" : "(pareado)");
}

void loop() {
  factoryResetIfHeld();
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(min<uint32_t>(backoffMs ? backoffMs : 2000, 60000));
    backoffMs = min<uint32_t>(backoffMs ? backoffMs * 2 : 2000, 60000);
    return;
  }
  uint32_t now = millis();
  if (now - lastSample >= OL_SAMPLE_INTERVAL_MS || lastSample == 0) {
    lastSample = now;
    sampleSensors();
  }
  if (now - lastSend >= max<uint32_t>(OL_SEND_INTERVAL_MS, backoffMs) || lastSend == 0) {
    lastSend = now;
    sendBatch();
  }
  delay(50);
}

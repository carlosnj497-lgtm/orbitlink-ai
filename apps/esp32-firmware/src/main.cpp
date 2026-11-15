// ASTRYON — nó de telemetria ESP32 (ingest v1, pareamento v2).
//
// O ESP32 NÃO fala com a antena Starlink: ele mede o próprio ambiente/alimentação (quando há sensores) e envia
// ao agente ASTRYON pela LAN, com mensagens assinadas (HMAC-SHA256, nonce único, timestamp).
//
// Fluxo:
//  1. Primeiro boot: abre o portal Wi-Fi "ASTRYON-Setup-XXXX" (WiFiManager), PROTEGIDO por senha própria deste
//     aparelho (aparece no monitor serial, 115200 baud). Informe Wi-Fi, IP do agente e o código de pareamento
//     (XXXX-XXXX-XXXX) gerado no painel (Centro ESP32).
//  2. Pareamento v2: o código NUNCA é enviado. O firmware deriva uma chave dele (PBKDF2), manda só uma prova
//     (HMAC) e recebe o segredo HMAC cifrado (AES-256-GCM). Quem escuta a rede não vê o código nem o segredo.
//     O segredo fica no NVS (Preferences). O código é de uso único.
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
#include <mbedtls/gcm.h>
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

static void hmacRaw(const uint8_t *key, size_t keyLen, const uint8_t *msg, size_t msgLen, uint8_t out[32]) {
  mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), key, keyLen, msg, msgLen, out);
}

// PBKDF2-HMAC-SHA256 com 32 bytes de saída (um bloco). Implementado com a API mbedtls_md_hmac_*, estável entre o
// mbedtls 2.28 (Arduino-ESP32 2.x) e o 3.x, em vez de mbedtls_pkcs5_pbkdf2_hmac*, cuja assinatura mudou.
static bool pbkdf2Sha256(const uint8_t *pass, size_t passLen, const uint8_t *salt, size_t saltLen, uint32_t iter,
                         uint8_t out[32]) {
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  if (mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1) != 0) {
    mbedtls_md_free(&ctx);
    return false;
  }
  const uint8_t block[4] = {0, 0, 0, 1};
  uint8_t u[32];
  mbedtls_md_hmac_starts(&ctx, pass, passLen);
  mbedtls_md_hmac_update(&ctx, salt, saltLen);
  mbedtls_md_hmac_update(&ctx, block, 4);
  mbedtls_md_hmac_finish(&ctx, u);
  memcpy(out, u, 32);
  for (uint32_t i = 1; i < iter; i++) {
    mbedtls_md_hmac_reset(&ctx);
    mbedtls_md_hmac_update(&ctx, u, 32);
    mbedtls_md_hmac_finish(&ctx, u);
    for (int j = 0; j < 32; j++) out[j] ^= u[j];
    if ((i & 1023) == 0) yield();  // não dispara o watchdog
  }
  memset(u, 0, sizeof(u));
  mbedtls_md_free(&ctx);
  return true;
}

// Igual a normalize_code do agente: maiúsculas, só letras e dígitos, O->0 e I/L->1.
static String normalizeCode(const String &in) {
  String out;
  for (size_t i = 0; i < in.length(); i++) {
    char c = toupper((unsigned char)in[i]);
    if (c == 'O') c = '0';
    if (c == 'I' || c == 'L') c = '1';
    if ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z')) out += c;
  }
  return out;
}

static const char *PAIR_SALT = "astryon-esp32-pair-v2";
static const uint32_t PAIR_ITER = 20000;

// K = PBKDF2(código); K_auth = HMAC(K, "auth"); K_enc = HMAC(K, "enc")
static bool pairKeys(const String &codeNorm, uint8_t kAuth[32], uint8_t kEnc[32]) {
  uint8_t k[32];
  if (!pbkdf2Sha256((const uint8_t *)codeNorm.c_str(), codeNorm.length(), (const uint8_t *)PAIR_SALT, strlen(PAIR_SALT),
                    PAIR_ITER, k))
    return false;
  hmacRaw(k, 32, (const uint8_t *)"auth", 4, kAuth);
  hmacRaw(k, 32, (const uint8_t *)"enc", 3, kEnc);
  memset(k, 0, sizeof(k));
  return true;
}

static String pairProof(const uint8_t kAuth[32], const String &nonce) {
  String msg = "pair\n" + deviceId + "\n" + nonce;
  uint8_t out[32];
  hmacRaw(kAuth, 32, (const uint8_t *)msg.c_str(), msg.length(), out);
  return hexOf(out, 32);
}

// Decifra o segredo HMAC (32 bytes) da resposta. false = chave errada ou resposta adulterada.
static bool openSecret(const uint8_t kEnc[32], const String &ivB64, const String &ctB64, const String &nonce,
                       uint8_t secret[32]) {
  uint8_t iv[16], ct[64];
  size_t ivLen = 0, ctLen = 0;
  if (mbedtls_base64_decode(iv, sizeof(iv), &ivLen, (const uint8_t *)ivB64.c_str(), ivB64.length()) != 0 || ivLen != 12)
    return false;
  if (mbedtls_base64_decode(ct, sizeof(ct), &ctLen, (const uint8_t *)ctB64.c_str(), ctB64.length()) != 0 || ctLen != 48)
    return false;
  String aad = deviceId + "\n" + nonce;
  mbedtls_gcm_context gcm;
  mbedtls_gcm_init(&gcm);
  bool ok = mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, kEnc, 256) == 0 &&
            mbedtls_gcm_auth_decrypt(&gcm, 32, iv, 12, (const uint8_t *)aad.c_str(), aad.length(), ct + 32, 16, ct,
                                     secret) == 0;
  mbedtls_gcm_free(&gcm);
  if (!ok) memset(secret, 0, 32);
  return ok;
}

// Senha do portal de configuração: própria deste aparelho, derivada de um segredo aleatório guardado no NVS
// (criado no primeiro boot) e do device_id. Muda depois de um reset de fábrica (botão BOOT por 5 s).
static String portalPassword() {
  static const char *A = "23456789ABCDEFGHJKMNPQRSTVWXYZ";  // sem 0/1/O/I/L: fácil de ler no monitor serial
  uint8_t seed[16];
  if (prefs.getBytes("apseed", seed, sizeof(seed)) != sizeof(seed)) {
    esp_fill_random(seed, sizeof(seed));
    prefs.putBytes("apseed", seed, sizeof(seed));
  }
  uint8_t mac[32];
  hmacRaw(seed, sizeof(seed), (const uint8_t *)deviceId.c_str(), deviceId.length(), mac);
  memset(seed, 0, sizeof(seed));
  String pw;
  for (int i = 0; i < 12; i++) pw += A[mac[i] % 30];
  return pw;
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

static bool pairWithAgent(const String &codeTyped) {
  String code = normalizeCode(codeTyped);
  if (code.length() != 12) {
    Serial.println("[astryon] código de pareamento deve ter 12 caracteres (XXXX-XXXX-XXXX)");
    return false;
  }
  uint8_t kAuth[32], kEnc[32];
  if (!pairKeys(code, kAuth, kEnc)) return false;
  uint8_t nb[16];
  esp_fill_random(nb, sizeof(nb));
  String nonce = hexOf(nb, sizeof(nb));

  JsonDocument doc;
  doc["v"] = 2;
  doc["device_id"] = deviceId;
  doc["nonce"] = nonce;
  doc["proof"] = pairProof(kAuth, nonce);
  memset(kAuth, 0, sizeof(kAuth));
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
  if (!http.begin(baseUrl() + "/esp32/v1/pair")) {
    memset(kEnc, 0, sizeof(kEnc));
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  int code_ = http.POST(body);
  String resp = http.getString();
  http.end();
  if (code_ != 200) {
    memset(kEnc, 0, sizeof(kEnc));
    Serial.printf("[astryon] pareamento recusado: HTTP %d %s\n", code_, code_ == 426 ? "(agente pede firmware novo)" : "");
    return false;
  }
  JsonDocument r;
  if (deserializeJson(r, resp)) {
    memset(kEnc, 0, sizeof(kEnc));
    return false;
  }
  uint8_t secret[32];
  bool ok = openSecret(kEnc, r["iv"].as<String>(), r["secret_enc"].as<String>(), nonce, secret);
  memset(kEnc, 0, sizeof(kEnc));
  if (!ok) {
    Serial.println("[astryon] resposta de pareamento não confere (código errado ou resposta adulterada)");
    return false;
  }
  uint8_t b64[64];
  size_t b64Len = 0;
  mbedtls_base64_encode(b64, sizeof(b64) - 1, &b64Len, secret, sizeof(secret));
  memset(secret, 0, sizeof(secret));
  b64[b64Len] = 0;
  secretB64 = String((const char *)b64);
  memset(b64, 0, sizeof(b64));
  timeOffset = (int64_t)r["server_time"].as<uint32_t>() - (int64_t)(millis() / 1000);
  prefs.putString("secret", secretB64);
  Serial.println("[astryon] pareado com sucesso");
  return true;
}

#if OL_PAIR_SELFTEST
// Vetores fixos, iguais a apps/agent/tests/test_ops.py::test_esp32_pair_v2_known_answer_vectors.
// Compile com -DOL_PAIR_SELFTEST=1 e confira "selftest OK" no monitor serial.
static void pairSelfTest() {
  String saved = deviceId;
  deviceId = "esp32-aabbccddeeff";
  const String nonce = "00112233445566778899aabbccddeeff";
  uint8_t kAuth[32], kEnc[32], secret[32];
  bool ok = normalizeCode("k7qf 2m9x-ab3d") == "K7QF2M9XAB3D" && normalizeCode("O1L-i") == "0111" &&
            pairKeys("K7QF2M9XAB3D", kAuth, kEnc) &&
            pairProof(kAuth, nonce) == "4087518af4e1eefc6bec8b7701c13b1ed226d3a58e708487dae5bc144308bf67" &&
            openSecret(kEnc, "AAAAAAAAAAAAAAAA", "UqlDAcZUgNpCyN8RVuX0TrUQvFUKf2SEttFrhQBzRrq11OWeUUjLO5OcO9XO8NgI", nonce,
                       secret);
  for (int i = 0; ok && i < 32; i++) ok = secret[i] == i;
  deviceId = saved;
  Serial.printf("[astryon] pareamento v2 selftest %s\n", ok ? "OK" : "FALHOU");
}
#endif

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
  WiFiManagerParameter pCode("code", "Código de pareamento (XXXX-XXXX-XXXX)", "", 20);
  wm.addParameter(&pHost);
  wm.addParameter(&pPort);
  wm.addParameter(&pCode);
  wm.setConfigPortalTimeout(300);
  String ap = String(OL_AP_PREFIX) + deviceId.substring(deviceId.length() - 4);
  String apPass = portalPassword();
  // A senha só aparece aqui (cabo USB): quem está perto mas sem acesso ao aparelho não entra no portal.
  Serial.printf("[astryon] portal de configuração: rede %s, senha %s\n", ap.c_str(), apPass.c_str());
  bool needPortal = secretB64.isEmpty() || agentHost.isEmpty();
  bool ok = needPortal ? wm.startConfigPortal(ap.c_str(), apPass.c_str()) : wm.autoConnect(ap.c_str(), apPass.c_str());
  if (!ok) ESP.restart();
  if (strlen(pHost.getValue())) {
    agentHost = pHost.getValue();
    prefs.putString("host", agentHost);
  }
  if (strlen(pPort.getValue())) {
    char *end = nullptr;
    long port = strtol(pPort.getValue(), &end, 10);
    if (end && *end == 0 && port >= 1 && port <= 65535) {
      agentPort = (uint16_t)port;
      prefs.putUShort("port", agentPort);
    } else {
      Serial.printf("[astryon] porta inválida \"%s\": mantendo %u\n", pPort.getValue(), agentPort);
    }
  }
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  syncTimeFromAgent();
#if OL_PAIR_SELFTEST
  pairSelfTest();
#endif
  if (strlen(pCode.getValue())) pairWithAgent(String(pCode.getValue()));

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

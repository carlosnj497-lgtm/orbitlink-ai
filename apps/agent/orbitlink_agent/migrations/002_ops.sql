-- Controle auditado, alertas, ESP32 e conversas de IA.

CREATE TABLE control_requests (
  operation_id  TEXT PRIMARY KEY,
  action        TEXT NOT NULL,
  target        TEXT NOT NULL,
  requested_by  INTEGER NOT NULL,
  origin        TEXT NOT NULL,             -- ui | assistant
  reason        TEXT,
  nonce_hash    TEXT NOT NULL,
  status        TEXT NOT NULL,             -- pending | executing | accepted | failed | timeout | expired | cancelled
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  confirmed_at  INTEGER,
  finished_at   INTEGER,
  result_detail TEXT
);

CREATE TABLE control_audit_logs (
  id            INTEGER PRIMARY KEY,
  operation_id  TEXT,
  ts            INTEGER NOT NULL,
  actor         TEXT NOT NULL,
  event         TEXT NOT NULL,
  detail        TEXT
);
CREATE INDEX idx_audit_ts ON control_audit_logs (ts);

CREATE TABLE alert_rules (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL,
  operator       TEXT NOT NULL,            -- gt | lt
  threshold      REAL NOT NULL,
  min_duration_s INTEGER NOT NULL DEFAULT 0,
  window_s       INTEGER NOT NULL DEFAULT 300,
  severity       TEXT NOT NULL,            -- info | warn | crit
  cooldown_s     INTEGER NOT NULL DEFAULT 900,
  hysteresis     REAL NOT NULL DEFAULT 0.1,
  enabled        INTEGER NOT NULL DEFAULT 1,
  silenced_until INTEGER,
  params_json    TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE alert_events (
  id            INTEGER PRIMARY KEY,
  rule_id       INTEGER NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,             -- active | resolved
  severity      TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  resolved_at   INTEGER,
  last_value    REAL,
  occurrences   INTEGER NOT NULL DEFAULT 1,
  message       TEXT NOT NULL,
  acknowledged_at INTEGER,
  acknowledged_by TEXT
);
CREATE INDEX idx_alert_events_status ON alert_events (status, started_at);

CREATE TABLE esp32_nodes (
  id              INTEGER PRIMARY KEY,
  device_id       TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  secret_enc      TEXT NOT NULL,           -- segredo HMAC protegido (DPAPI no Windows)
  firmware        TEXT,
  sensors_json    TEXT,
  created_at      INTEGER NOT NULL,
  last_seen       INTEGER,
  last_ip_masked  TEXT,
  rssi            INTEGER,
  uptime_s        INTEGER,
  enabled         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE esp32_pairing_codes (
  code_hash   TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_by  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);

CREATE TABLE esp32_nonces (
  device_id TEXT NOT NULL,
  nonce     TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  PRIMARY KEY (device_id, nonce)
);

CREATE TABLE esp32_sensor_readings (
  node_id     INTEGER NOT NULL REFERENCES esp32_nodes(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  ts          INTEGER NOT NULL,            -- horário do dispositivo (validado)
  received_at INTEGER NOT NULL,
  sensor      TEXT NOT NULL,               -- ex.: power.voltage_v, env.temp_c, power.present
  value       REAL,
  quality     TEXT NOT NULL,               -- ok | uncalibrated | fault
  PRIMARY KEY (node_id, seq, sensor)
) WITHOUT ROWID;
CREATE INDEX idx_esp32_readings_ts ON esp32_sensor_readings (node_id, ts);

CREATE TABLE ai_conversations (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  title       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE ai_messages (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,           -- user | assistant
  content         TEXT NOT NULL,
  tools_json      TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE TABLE ai_usage_daily (
  day            TEXT PRIMARY KEY,
  requests       INTEGER NOT NULL DEFAULT 0,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0
);

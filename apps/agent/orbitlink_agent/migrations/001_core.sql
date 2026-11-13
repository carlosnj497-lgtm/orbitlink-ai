-- OrbitLink AI — schema local (SQLite). Timestamps em segundos UTC (epoch, INTEGER).

CREATE TABLE terminals (
  id               INTEGER PRIMARY KEY,
  terminal_key     TEXT NOT NULL UNIQUE,          -- hash do ID do terminal; ID bruto nunca é salvo
  name             TEXT,
  target           TEXT NOT NULL,
  hardware_version TEXT,
  software_version TEXT,
  origin           TEXT NOT NULL,                  -- grpc | fixture
  first_seen       INTEGER NOT NULL,
  last_seen        INTEGER NOT NULL
);

CREATE TABLE capabilities (
  target      TEXT NOT NULL,
  key         TEXT NOT NULL,
  device      TEXT NOT NULL,
  label       TEXT NOT NULL,
  origin      TEXT NOT NULL,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL,
  available   INTEGER NOT NULL,
  offered     INTEGER NOT NULL,
  detail      TEXT,
  checked_at  INTEGER NOT NULL,
  PRIMARY KEY (target, key)
);

CREATE TABLE status_samples (
  id                   INTEGER PRIMARY KEY,
  terminal_id          INTEGER NOT NULL REFERENCES terminals(id),
  ts                   INTEGER NOT NULL,
  state                TEXT NOT NULL,
  state_reason         TEXT,
  downlink_bps         REAL,
  uplink_bps           REAL,
  pop_latency_ms       REAL,
  pop_drop_rate        REAL,
  obstruction_fraction REAL,
  currently_obstructed INTEGER,
  uptime_s             INTEGER,
  software_version     TEXT,
  alerts_json          TEXT,
  outage_json          TEXT,
  origin               TEXT NOT NULL,
  UNIQUE (terminal_id, ts)
);
CREATE INDEX idx_status_terminal_ts ON status_samples (terminal_id, ts);

-- Amostras de 1 s do buffer circular. A PK garante idempotência entre polls.
CREATE TABLE history_samples (
  terminal_id    INTEGER NOT NULL REFERENCES terminals(id),
  boot_id        TEXT NOT NULL,
  counter        INTEGER NOT NULL,
  ts             INTEGER NOT NULL,
  drop_rate      REAL,
  latency_ms     REAL,
  downlink_bps   REAL,
  uplink_bps     REAL,
  power_w        REAL,
  origin         TEXT NOT NULL,
  PRIMARY KEY (terminal_id, boot_id, counter)
) WITHOUT ROWID;
CREATE INDEX idx_history_terminal_ts ON history_samples (terminal_id, ts);

CREATE TABLE history_cursors (
  terminal_id   INTEGER PRIMARY KEY REFERENCES terminals(id),
  boot_id       TEXT NOT NULL,
  last_current  INTEGER NOT NULL,
  last_poll_at  INTEGER NOT NULL,
  buffer_len    INTEGER
);

-- Lacunas de observação: NUNCA são tratadas como queda nem preenchidas com zeros.
CREATE TABLE observation_gaps (
  id            INTEGER PRIMARY KEY,
  terminal_id   INTEGER,
  kind          TEXT NOT NULL,                  -- history_lost | agent_offline | dish_unreachable
  start_ts      INTEGER NOT NULL,
  end_ts        INTEGER,
  samples_lost  INTEGER,
  detail        TEXT,
  UNIQUE (terminal_id, kind, start_ts)
);
CREATE INDEX idx_gaps_ts ON observation_gaps (start_ts);

-- Consumo estimado por minuto: integração de bps (amostras de 1 s) / 8.
CREATE TABLE usage_minutes (
  terminal_id  INTEGER NOT NULL REFERENCES terminals(id),
  minute_ts    INTEGER NOT NULL,
  bytes_down   REAL NOT NULL,
  bytes_up     REAL NOT NULL,
  samples      INTEGER NOT NULL,
  coverage     REAL NOT NULL,                  -- amostras / 60
  source       TEXT NOT NULL,                  -- calculada | demonstracao
  PRIMARY KEY (terminal_id, minute_ts)
) WITHOUT ROWID;

-- Qualidade por minuto (derivada das amostras de 1 s). Retida por mais tempo que o bruto.
CREATE TABLE quality_minutes (
  terminal_id     INTEGER NOT NULL REFERENCES terminals(id),
  minute_ts       INTEGER NOT NULL,
  samples         INTEGER NOT NULL,
  latency_samples INTEGER NOT NULL,
  latency_avg     REAL,
  latency_min     REAL,
  latency_max     REAL,
  jitter_avg      REAL,                 -- média de |Δlatência| entre amostras consecutivas
  drop_avg        REAL,
  full_drop_s     INTEGER NOT NULL,     -- segundos com perda total de ping ao PoP
  downlink_max_bps REAL,
  uplink_max_bps  REAL,
  power_avg_w     REAL,
  source          TEXT NOT NULL,
  PRIMARY KEY (terminal_id, minute_ts)
) WITHOUT ROWID;

CREATE TABLE usage_imports (
  id          INTEGER PRIMARY KEY,
  filename    TEXT NOT NULL,
  sha256      TEXT NOT NULL UNIQUE,
  imported_at INTEGER NOT NULL,
  rows        INTEGER NOT NULL,
  mapping_json TEXT NOT NULL
);

CREATE TABLE usage_imported (
  id           INTEGER PRIMARY KEY,
  import_id    INTEGER NOT NULL REFERENCES usage_imports(id) ON DELETE CASCADE,
  period_start INTEGER NOT NULL,
  period_end   INTEGER NOT NULL,
  bytes_down   REAL,
  bytes_up     REAL,
  bytes_total  REAL NOT NULL,
  UNIQUE (period_start, period_end)
);

CREATE TABLE connection_events (
  id           INTEGER PRIMARY KEY,
  terminal_id  INTEGER,
  kind         TEXT NOT NULL,       -- outage | ping_drop | unreachable | boot | state_change
  cause        TEXT,
  start_ts     INTEGER NOT NULL,
  end_ts       INTEGER,
  duration_s   REAL,
  confidence   TEXT NOT NULL,       -- confirmado | derivado | indeterminado
  evidence_json TEXT,
  UNIQUE (terminal_id, kind, start_ts)
);
CREATE INDEX idx_events_ts ON connection_events (start_ts);

CREATE TABLE obstruction_snapshots (
  id            INTEGER PRIMARY KEY,
  terminal_id   INTEGER NOT NULL REFERENCES terminals(id),
  ts            INTEGER NOT NULL,
  num_rows      INTEGER NOT NULL,
  num_cols      INTEGER NOT NULL,
  snr_json      TEXT NOT NULL,
  min_elevation_deg REAL,
  max_theta_deg REAL,
  origin        TEXT NOT NULL,
  UNIQUE (terminal_id, ts)
);

CREATE TABLE agent_heartbeats (
  ts               INTEGER PRIMARY KEY,
  dish_reachable   INTEGER NOT NULL,
  router_reachable INTEGER,
  last_status_ts   INTEGER,
  version          TEXT NOT NULL
);

CREATE TABLE sync_queue (
  id          INTEGER PRIMARY KEY,
  entity      TEXT NOT NULL,
  record_key  TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  synced_at   INTEGER,
  UNIQUE (entity, record_key)
);
CREATE INDEX idx_sync_pending ON sync_queue (synced_at, id);

CREATE TABLE settings_kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Autenticação local
CREATE TABLE local_users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT
);

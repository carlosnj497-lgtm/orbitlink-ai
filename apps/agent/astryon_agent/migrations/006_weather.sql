-- Clima por hora (Open-Meteo). Estimativa regional do modelo meteorológico, não um sensor no local:
-- serve só para correlacionar com a conexão ("coincidiu com chuva forte"), nunca como causa.
-- Horas futuras são previsão (is_forecast = 1) e são reescritas a cada busca.
CREATE TABLE weather_hourly (
  hour_ts          INTEGER PRIMARY KEY,   -- início da hora (UTC, epoch s)
  temperature_c    REAL,
  precipitation_mm REAL,                  -- chuva + neve + garoa na hora
  rain_mm          REAL,
  cloud_cover_pct  REAL,
  wind_kmh         REAL,
  gust_kmh         REAL,
  weather_code     INTEGER,               -- código WMO
  is_forecast      INTEGER NOT NULL DEFAULT 0,
  fetched_at       INTEGER NOT NULL,
  source           TEXT NOT NULL          -- open-meteo
);

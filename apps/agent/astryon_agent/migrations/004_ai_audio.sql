-- Uso do assistente de áudio (nota de voz transcrita). Tabela separada da de texto: a cota e o custo
-- são medidos em segundos de áudio, não em tokens de conversa.

CREATE TABLE ai_audio_usage_daily (
  day                 TEXT PRIMARY KEY,
  requests            INTEGER NOT NULL DEFAULT 0,
  audio_seconds       INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd  REAL    NOT NULL DEFAULT 0
);

-- Fila persistente de notificações (webhook, Telegram). Quem avisa que a antena caiu muitas vezes depende da própria
-- antena para sair à internet: a mensagem espera aqui e é reenviada quando a conexão volta.

CREATE TABLE notification_outbox (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  channel          TEXT NOT NULL,            -- webhook | telegram
  payload_json     TEXT NOT NULL,            -- sem segredos: só severidade, mensagem e horários
  created_at       INTEGER NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  INTEGER NOT NULL,
  sent_at          INTEGER,
  failed_at        INTEGER,                  -- desistência (erro permanente ou idade máxima)
  last_error       TEXT
);
CREATE INDEX idx_notification_outbox_due ON notification_outbox (sent_at, failed_at, next_attempt_at);

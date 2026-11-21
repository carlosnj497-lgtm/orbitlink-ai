-- Recuperação de senha por e-mail no modo local.
-- O e-mail é guardado no usuário; os códigos enviados ficam só como hash, com validade e uso único.
ALTER TABLE local_users ADD COLUMN email TEXT;

CREATE TABLE password_reset_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used_at     INTEGER
);

CREATE INDEX idx_password_reset_user ON password_reset_tokens(user_id, created_at);

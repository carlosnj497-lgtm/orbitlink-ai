-- Pareamento ESP32 v2: o código não trafega mais pela rede. Guarda a chave derivada do código (PBKDF2), cifrada
-- como os demais segredos, para conferir a prova do dispositivo e cifrar o segredo HMAC na resposta.
-- Códigos v1 (6 dígitos, sem chave) deixam de valer.
ALTER TABLE esp32_pairing_codes ADD COLUMN key_enc TEXT;
UPDATE esp32_pairing_codes SET used_at = COALESCE(used_at, strftime('%s', 'now')) WHERE key_enc IS NULL;

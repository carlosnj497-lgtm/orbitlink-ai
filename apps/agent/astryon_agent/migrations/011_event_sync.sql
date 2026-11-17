-- Confirmações por revisão: encerramentos durante o envio continuam pendentes.
CREATE TABLE event_sync (
  event_id INTEGER PRIMARY KEY REFERENCES connection_events(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1,
  synced_revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO event_sync(event_id) SELECT id FROM connection_events;
CREATE TRIGGER event_sync_insert AFTER INSERT ON connection_events BEGIN
  INSERT INTO event_sync(event_id) VALUES (NEW.id)
  ON CONFLICT(event_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER event_sync_update AFTER UPDATE ON connection_events BEGIN
  UPDATE event_sync SET revision = revision + 1 WHERE event_id = NEW.id;
END;

-- No messages or transcripts are stored here. Reservations are never refunded.
CREATE TABLE IF NOT EXISTS brief_keys (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL);
INSERT OR IGNORE INTO brief_keys(id, value) VALUES(1, lower(hex(randomblob(32))));

CREATE TABLE IF NOT EXISTS brief_usage (
  id TEXT PRIMARY KEY,
  session TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  turn INTEGER NOT NULL CHECK(turn BETWEEN 1 AND 4),
  created_at INTEGER NOT NULL,
  UNIQUE(session, turn)
);
CREATE INDEX IF NOT EXISTS brief_usage_day ON brief_usage(day);
CREATE INDEX IF NOT EXISTS brief_usage_ip ON brief_usage(day, ip_hash, created_at);



-- AppCaptures D1 schema. Mini-side: wrangler d1 create appcaptures_db
-- then: wrangler d1 execute appcaptures_db --file schema.sql
CREATE TABLE IF NOT EXISTS waitlist (
  email TEXT PRIMARY KEY,
  platform TEXT,
  source TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_waitlist_at ON waitlist (at);

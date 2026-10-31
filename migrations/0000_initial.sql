-- Initial waitlist schema migration (AC-003)
CREATE TABLE IF NOT EXISTS waitlist (
  email TEXT PRIMARY KEY,
  platform TEXT,
  source TEXT,
  at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

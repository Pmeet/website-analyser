CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  name TEXT,
  mode TEXT NOT NULL DEFAULT 'queue',          -- 'queue' | 'client'
  total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | running | done | error
  error TEXT,
  domain TEXT,
  performance INTEGER,
  seo INTEGER,
  security_grade TEXT,
  email_ok INTEGER,
  stack TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  hook TEXT,
  report_text TEXT,
  result_json TEXT,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_batch_items_batch ON batch_items(batch_id, position);
CREATE INDEX IF NOT EXISTS idx_batch_items_status ON batch_items(batch_id, status);

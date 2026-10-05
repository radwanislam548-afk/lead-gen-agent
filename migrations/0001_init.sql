-- D1 migration: initial schema
-- Apply with: wrangler d1 migrations apply leadgen --remote

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE,
  source TEXT,
  niche TEXT,
  website TEXT,
  social_url TEXT,
  page_title TEXT,
  page_text_snippet TEXT,
  subs_or_followers INTEGER,
  status TEXT DEFAULT 'new',
  first_line TEXT,
  sent_at TEXT,
  followup_count INTEGER DEFAULT 0,
  replied_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_sent_at ON leads(sent_at);

CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER,
  type TEXT,
  sent_at TEXT DEFAULT (datetime('now')),
  resend_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_emaillog_lead ON email_log(lead_id);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);

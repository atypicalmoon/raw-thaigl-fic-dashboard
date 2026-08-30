CREATE TABLE IF NOT EXISTS review_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  link TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  current_cp TEXT NOT NULL DEFAULT '',
  candidate_cps TEXT NOT NULL DEFAULT '',
  tag TEXT NOT NULL DEFAULT '',
  trigger_reason TEXT NOT NULL DEFAULT '',
  publish_date TEXT NOT NULL DEFAULT '',
  source_status TEXT NOT NULL DEFAULT '',
  source_revision TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_items_active_kind ON review_items(active, kind);

CREATE TABLE IF NOT EXISTS review_decisions (
  item_id TEXT PRIMARY KEY REFERENCES review_items(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  new_cp TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft',
  user_email TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_review_decisions_state ON review_decisions(state);

CREATE TABLE IF NOT EXISTS review_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  event TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT '',
  new_cp TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  user_email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_history_created_at ON review_history(created_at DESC);

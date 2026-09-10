
CREATE TABLE IF NOT EXISTS watchlist (
  code TEXT PRIMARY KEY,
  name TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_snapshots (
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  close REAL,
  setup REAL,
  opportunity REAL,
  entry REAL,
  hold REAL,
  persistence REAL,
  bottom REAL,
  ignition REAL,
  trend REAL,
  state TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (code, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_date ON daily_snapshots(trade_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_code_date ON daily_snapshots(code, trade_date DESC);

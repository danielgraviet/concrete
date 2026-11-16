-- Per-user monthly request counter for the AI proxy.
-- period is the UTC month, 'YYYY-MM'. One unit = one /v1/chat call.
CREATE TABLE IF NOT EXISTS usage (
  uid        TEXT    NOT NULL,
  period     TEXT    NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (uid, period)
);

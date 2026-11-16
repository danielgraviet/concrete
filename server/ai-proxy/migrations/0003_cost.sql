-- Per-user monthly OpenRouter spend (USD, as reported in `usage.cost`), for owner
-- visibility only. The quota itself stays request-count based (`used`).
ALTER TABLE usage ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0;

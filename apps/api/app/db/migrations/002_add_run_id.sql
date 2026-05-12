-- Add run_id to existing databases (safe to re-run — IF NOT EXISTS guard via try/catch at app level)
ALTER TABLE events ADD COLUMN IF NOT EXISTS run_id VARCHAR;

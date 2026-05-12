-- All events in one wide flat table.
-- Columnar storage means NULLs for event-type-specific columns are essentially free.
CREATE TABLE IF NOT EXISTS events (
  -- Identity (all events)
  event_id      VARCHAR NOT NULL,
  trace_id      VARCHAR NOT NULL,
  project_id    VARCHAR NOT NULL,
  timestamp     TIMESTAMPTZ NOT NULL,
  event_type    VARCHAR NOT NULL,
  run_id        VARCHAR,          -- optional run grouping key from producer

  -- Trace-level (trace_started / trace_completed)
  agent_name          VARCHAR,
  user_id             VARCHAR,
  session_id          VARCHAR,
  trace_status        VARCHAR,     -- success | error | timeout | cancelled
  trace_duration_ms   INTEGER,
  total_steps         INTEGER,
  total_llm_calls     INTEGER,
  total_tool_calls    INTEGER,
  total_input_tokens  INTEGER,
  total_output_tokens INTEGER,
  total_cost_usd      DOUBLE,
  input_text          VARCHAR,
  output_text         VARCHAR,
  tags                VARCHAR[],
  metadata            VARCHAR,     -- JSON string

  -- LLM call (llm_call)
  model         VARCHAR,
  provider      VARCHAR,
  latency_ms    INTEGER,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd      DOUBLE,
  step_status   VARCHAR,           -- success | error | timeout
  error_type    VARCHAR,
  temperature   DOUBLE,
  cached        BOOLEAN,

  -- Tool call (tool_call)
  tool_name     VARCHAR,
  retry_count   INTEGER,
  input_summary VARCHAR,

  -- Shared step fields
  step_index    INTEGER,
  step_type     VARCHAR,

  -- Error / retry
  error_message   VARCHAR,
  recoverable     BOOLEAN,
  retry_reason    VARCHAR,
  attempt_number  INTEGER,

  PRIMARY KEY (event_id)
);

CREATE INDEX IF NOT EXISTS idx_events_trace_id
  ON events (trace_id);

CREATE INDEX IF NOT EXISTS idx_events_project_time
  ON events (project_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_events_agent
  ON events (agent_name);

CREATE INDEX IF NOT EXISTS idx_events_model
  ON events (model);

CREATE INDEX IF NOT EXISTS idx_events_tool
  ON events (tool_name);

-- Pre-aggregated summary for dashboard KPI queries.
-- model is NOT NULL (empty string when not applicable) so we can use it in the PK.
CREATE TABLE IF NOT EXISTS trace_hourly_summary (
  project_id      VARCHAR NOT NULL,
  hour            TIMESTAMPTZ NOT NULL,
  agent_name      VARCHAR NOT NULL,
  model           VARCHAR NOT NULL DEFAULT '',
  trace_count     INTEGER,
  success_count   INTEGER,
  error_count     INTEGER,
  avg_duration_ms DOUBLE,
  p50_duration_ms DOUBLE,
  p95_duration_ms DOUBLE,
  p99_duration_ms DOUBLE,
  total_input_tokens  BIGINT,
  total_output_tokens BIGINT,
  total_cost_usd  DOUBLE,
  avg_steps       DOUBLE,
  PRIMARY KEY (project_id, hour, agent_name, model)
);

-- API key → project mapping (would be PostgreSQL in production)
CREATE TABLE IF NOT EXISTS projects (
  project_id  VARCHAR PRIMARY KEY,
  name        VARCHAR NOT NULL,
  api_key     VARCHAR UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Seed the dev project (hardcoded for prototype)
INSERT OR IGNORE INTO projects (project_id, name, api_key)
VALUES ('proj_dev_001', 'Dev Project', 'dev_project_key');

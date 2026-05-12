CREATE TABLE IF NOT EXISTS nl_miss_log (
    id         VARCHAR NOT NULL PRIMARY KEY,   -- UUID
    query      VARCHAR NOT NULL,
    project_id VARCHAR,
    api_key    VARCHAR,
    ts         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nl_miss_ts ON nl_miss_log (ts);

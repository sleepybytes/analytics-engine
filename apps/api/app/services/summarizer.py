import asyncio
import logging

from ..db.duckdb import DuckDBManager

logger = logging.getLogger(__name__)

_REFRESH_SQL = """
INSERT OR REPLACE INTO trace_hourly_summary
SELECT
    project_id,
    date_trunc('hour', timestamp)   AS hour,
    agent_name,
    ''                              AS model,
    count(*)                        AS trace_count,
    count(*) FILTER (WHERE trace_status = 'success') AS success_count,
    count(*) FILTER (WHERE trace_status = 'error')   AS error_count,
    avg(trace_duration_ms)          AS avg_duration_ms,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY trace_duration_ms) AS p50_duration_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY trace_duration_ms) AS p95_duration_ms,
    percentile_cont(0.99) WITHIN GROUP (ORDER BY trace_duration_ms) AS p99_duration_ms,
    sum(total_input_tokens)         AS total_input_tokens,
    sum(total_output_tokens)        AS total_output_tokens,
    sum(total_cost_usd)             AS total_cost_usd,
    avg(total_steps)                AS avg_steps
FROM events
WHERE event_type = 'trace_completed'
  AND agent_name IS NOT NULL
GROUP BY project_id, hour, agent_name
"""


def _sync_refresh() -> None:
    with DuckDBManager.write_lock:
        DuckDBManager.get_conn().execute(_REFRESH_SQL)


async def refresh_summary() -> None:
    """Refresh trace_hourly_summary. Uses the singleton write connection."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _sync_refresh)
    logger.info("trace_hourly_summary refreshed")

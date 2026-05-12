import time
from datetime import datetime, timezone

from ..db.duckdb import DuckDBManager
from .registry import QUERY_REGISTRY


def _resolve_project(api_key: str) -> str | None:
    from ..db.duckdb import writer
    return writer.get_project_id(api_key)


def _rows_to_dicts(cursor) -> list[dict]:
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def _default_window() -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.isoformat(), now.isoformat()


def run_named_query(
    query_id: str,
    project_id: str,
    start_time: str | None = None,
    end_time: str | None = None,
    agent_name: str | None = None,
    model: str | None = None,
) -> dict:
    qdef = QUERY_REGISTRY.get(query_id)
    if qdef is None:
        raise KeyError(f"Unknown query_id: {query_id}")

    if not start_time or not end_time:
        start_time, end_time = _default_window()

    # Build positional params matching the SQL placeholder order.
    # Every query starts with (project_id, start_time, end_time).
    # Queries with optional agent_name/model repeat the value twice:
    #   (? IS NULL OR col = ?) — first ? = the value or None, second = same value.
    params: list = [project_id, start_time, end_time]

    if "agent_name" in qdef.params:
        params += [agent_name, agent_name]
    if "model" in qdef.params:
        params += [model, model]

    cur = DuckDBManager.cursor()
    t0 = time.perf_counter()
    cur.execute(qdef.sql, params)
    rows = _rows_to_dicts(cur)
    query_time_ms = round((time.perf_counter() - t0) * 1000, 2)

    return {
        "query_id":      query_id,
        "chart_type":    qdef.chart_type,
        "description":   qdef.description,
        "start_time":    start_time,
        "end_time":      end_time,
        "row_count":     len(rows),
        "query_time_ms": query_time_ms,
        "data":          rows,
    }


_KPI_FROM_SUMMARY = """
    SELECT
        SUM(trace_count)                                                        AS total_traces,
        SUM(success_count)                                                      AS success_count,
        SUM(error_count)                                                        AS error_count,
        ROUND(SUM(trace_count * avg_duration_ms) / NULLIF(SUM(trace_count), 0), 1) AS avg_duration_ms,
        ROUND(SUM(trace_count * p95_duration_ms) / NULLIF(SUM(trace_count), 0), 1) AS p95_duration_ms,
        ROUND(SUM(total_cost_usd), 4)                                           AS total_cost_usd,
        SUM(total_input_tokens)                                                 AS total_input_tokens,
        SUM(total_output_tokens)                                                AS total_output_tokens
    FROM trace_hourly_summary
    WHERE project_id = ?
      AND hour BETWEEN ? AND ?
"""

_KPI_FROM_EVENTS = """
    SELECT
        COUNT(*)                                                          AS total_traces,
        SUM(CASE WHEN trace_status = 'success' THEN 1 ELSE 0 END)        AS success_count,
        SUM(CASE WHEN trace_status NOT IN ('success','running') AND trace_status IS NOT NULL
                 THEN 1 ELSE 0 END)                                       AS error_count,
        ROUND(AVG(trace_duration_ms), 1)                                  AS avg_duration_ms,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY trace_duration_ms), 1) AS p95_duration_ms,
        ROUND(SUM(total_cost_usd), 4)                                     AS total_cost_usd,
        SUM(total_input_tokens)                                            AS total_input_tokens,
        SUM(total_output_tokens)                                           AS total_output_tokens
    FROM events
    WHERE project_id = ?
      AND event_type  = 'trace_completed'
      AND timestamp  BETWEEN ? AND ?
"""


def _summary_has_data(project_id: str, start_time: str, end_time: str) -> bool:
    cur = DuckDBManager.cursor()
    cur.execute(
        "SELECT 1 FROM trace_hourly_summary WHERE project_id = ? AND hour BETWEEN ? AND ? LIMIT 1",
        [project_id, start_time, end_time],
    )
    return cur.fetchone() is not None


def kpi_summary(project_id: str, start_time: str, end_time: str) -> dict:
    params = [project_id, start_time, end_time]
    cur = DuckDBManager.cursor()

    if _summary_has_data(project_id, start_time, end_time):
        cur.execute(_KPI_FROM_SUMMARY, params)
    else:
        cur.execute(_KPI_FROM_EVENTS, params)

    row = cur.fetchone()
    cols = [d[0] for d in cur.description]
    return dict(zip(cols, row)) if row else {}

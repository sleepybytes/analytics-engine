from ..db.duckdb import DuckDBManager


def _rows_to_dicts(cursor) -> list[dict]:
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def list_traces(
    project_id: str,
    start_time: str,
    end_time: str,
    agent_name: str | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    sql = """
        SELECT
            trace_id,
            COALESCE(agent_name, 'unknown')  AS agent_name,
            run_id,
            trace_status                     AS status,
            trace_duration_ms                AS duration_ms,
            COALESCE(total_steps, 0)         AS total_steps,
            COALESCE(total_llm_calls, 0)     AS total_llm_calls,
            COALESCE(total_tool_calls, 0)    AS total_tool_calls,
            ROUND(total_cost_usd, 4)         AS cost_usd,
            input_text,
            output_text,
            timestamp::VARCHAR               AS started_at
        FROM events
        WHERE project_id = ?
          AND event_type  = 'trace_completed'
          AND timestamp  BETWEEN ? AND ?
          AND (? IS NULL OR agent_name = ?)
          AND (? IS NULL OR trace_status = ?)
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
    """

    count_sql = """
        SELECT COUNT(*)
        FROM events
        WHERE project_id = ?
          AND event_type  = 'trace_completed'
          AND timestamp  BETWEEN ? AND ?
          AND (? IS NULL OR agent_name = ?)
          AND (? IS NULL OR trace_status = ?)
    """

    params = [project_id, start_time, end_time,
              agent_name, agent_name,
              status, status]

    cur = DuckDBManager.cursor()
    cur.execute(count_sql, params)
    total = cur.fetchone()[0]

    cur.execute(sql, params + [limit, offset])
    rows = _rows_to_dicts(cur)

    return {
        "total":  total,
        "limit":  limit,
        "offset": offset,
        "traces": rows,
    }


def get_trace(project_id: str, trace_id: str) -> dict | None:
    sql = """
        SELECT
            event_id,
            event_type,
            timestamp::VARCHAR   AS timestamp,
            agent_name,
            step_index,
            COALESCE(step_status, trace_status) AS status,
            model,
            latency_ms,
            input_tokens,
            output_tokens,
            cost_usd,
            tool_name,
            error_type,
            error_message,
            step_status,
            trace_status,
            trace_duration_ms,
            total_steps,
            total_llm_calls,
            total_tool_calls,
            total_cost_usd,
            input_text,
            output_text,
            metadata
        FROM events
        WHERE project_id = ?
          AND trace_id   = ?
        ORDER BY timestamp, step_index NULLS LAST
    """
    cur = DuckDBManager.cursor()
    cur.execute(sql, [project_id, trace_id])
    rows = _rows_to_dicts(cur)

    if not rows:
        return None

    # Separate the summary row (trace_completed) from span rows
    summary = next((r for r in rows if r["event_type"] == "trace_completed"), None)
    spans   = [r for r in rows if r["event_type"] != "trace_completed"]

    return {
        "trace_id": trace_id,
        "summary":  summary,
        "events":   spans,
        "event_count": len(rows),
    }

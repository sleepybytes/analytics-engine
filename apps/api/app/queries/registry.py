from dataclasses import dataclass


@dataclass
class QueryDef:
    sql: str
    chart_type: str
    params: list[str]
    description: str = ""


QUERY_REGISTRY: dict[str, QueryDef] = {
    "trace_volume": QueryDef(
        description="Trace count per hour by agent",
        chart_type="line",
        params=["project_id", "start_time", "end_time", "agent_name"],
        sql="""
            SELECT
                date_trunc('hour', timestamp)::VARCHAR AS hour,
                COALESCE(agent_name, 'unknown')         AS agent_name,
                COUNT(*)                                AS trace_count
            FROM events
            WHERE project_id = ?
              AND event_type  = 'trace_started'
              AND timestamp  BETWEEN ? AND ?
              AND (? IS NULL OR agent_name = ?)
            GROUP BY 1, 2
            ORDER BY 1
        """,
    ),

    "avg_llm_latency_by_model": QueryDef(
        description="P50/P95 LLM latency by model over time",
        chart_type="line",
        params=["project_id", "start_time", "end_time", "model"],
        sql="""
            SELECT
                date_trunc('hour', timestamp)::VARCHAR                              AS hour,
                COALESCE(model, 'unknown')                                          AS model,
                ROUND(AVG(latency_ms), 1)                                           AS avg_ms,
                ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms), 1)  AS p50_ms,
                ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms), 1) AS p95_ms
            FROM events
            WHERE project_id = ?
              AND event_type  = 'llm_call'
              AND timestamp  BETWEEN ? AND ?
              AND (? IS NULL OR model = ?)
            GROUP BY 1, 2
            ORDER BY 1
        """,
    ),

    "tool_error_rate": QueryDef(
        description="Error rate and call volume by tool name",
        chart_type="bar",
        params=["project_id", "start_time", "end_time"],
        sql="""
            SELECT
                COALESCE(tool_name, 'unknown')                                               AS tool_name,
                COUNT(*)                                                                      AS total_calls,
                SUM(CASE WHEN step_status != 'success' THEN 1 ELSE 0 END)                   AS error_calls,
                ROUND(100.0 * SUM(CASE WHEN step_status != 'success' THEN 1 ELSE 0 END)
                      / NULLIF(COUNT(*), 0), 2)                                              AS error_rate_pct
            FROM events
            WHERE project_id = ?
              AND event_type  = 'tool_call'
              AND timestamp  BETWEEN ? AND ?
            GROUP BY 1
            ORDER BY error_rate_pct DESC
        """,
    ),

    "token_usage_by_agent": QueryDef(
        description="Token consumption broken down by agent",
        chart_type="bar",
        params=["project_id", "start_time", "end_time"],
        sql="""
            SELECT
                COALESCE(agent_name, 'unknown') AS agent_name,
                SUM(input_tokens)               AS total_input_tokens,
                SUM(output_tokens)              AS total_output_tokens,
                SUM(input_tokens + output_tokens) AS total_tokens
            FROM events
            WHERE project_id = ?
              AND event_type  = 'llm_call'
              AND timestamp  BETWEEN ? AND ?
            GROUP BY 1
            ORDER BY total_tokens DESC
        """,
    ),

    "cost_per_run_by_model": QueryDef(
        description="Total and average cost per LLM call, grouped by model",
        chart_type="bar",
        params=["project_id", "start_time", "end_time", "model"],
        sql="""
            SELECT
                COALESCE(model, 'unknown') AS model,
                COUNT(*)                   AS call_count,
                ROUND(SUM(cost_usd), 4)   AS total_cost_usd,
                ROUND(AVG(cost_usd), 6)   AS avg_cost_per_call_usd
            FROM events
            WHERE project_id = ?
              AND event_type  = 'llm_call'
              AND cost_usd   IS NOT NULL
              AND timestamp  BETWEEN ? AND ?
              AND (? IS NULL OR model = ?)
            GROUP BY 1
            ORDER BY total_cost_usd DESC
        """,
    ),

    "top_slow_traces": QueryDef(
        description="Top 10 slowest completed traces",
        chart_type="table",
        params=["project_id", "start_time", "end_time", "agent_name"],
        sql="""
            SELECT
                trace_id,
                COALESCE(agent_name, 'unknown') AS agent_name,
                trace_status,
                trace_duration_ms,
                COALESCE(total_steps, 0)        AS total_steps,
                COALESCE(total_llm_calls, 0)    AS total_llm_calls,
                ROUND(total_cost_usd, 4)        AS total_cost_usd,
                timestamp::VARCHAR              AS timestamp
            FROM events
            WHERE project_id = ?
              AND event_type  = 'trace_completed'
              AND timestamp  BETWEEN ? AND ?
              AND (? IS NULL OR agent_name = ?)
            ORDER BY trace_duration_ms DESC NULLS LAST
            LIMIT 10
        """,
    ),

    "avg_steps_by_outcome": QueryDef(
        description="Average step count and duration grouped by trace outcome",
        chart_type="bar",
        params=["project_id", "start_time", "end_time"],
        sql="""
            SELECT
                COALESCE(trace_status, 'unknown') AS trace_status,
                COUNT(*)                          AS trace_count,
                ROUND(AVG(total_steps), 2)        AS avg_steps,
                ROUND(AVG(trace_duration_ms), 1)  AS avg_duration_ms
            FROM events
            WHERE project_id = ?
              AND event_type  = 'trace_completed'
              AND timestamp  BETWEEN ? AND ?
            GROUP BY 1
            ORDER BY trace_count DESC
        """,
    ),

    "model_usage_distribution": QueryDef(
        description="LLM call volume and token share per model",
        chart_type="bar",
        params=["project_id", "start_time", "end_time"],
        sql="""
            SELECT
                COALESCE(model, 'unknown') AS model,
                COUNT(*)                   AS call_count,
                SUM(input_tokens)          AS total_input_tokens,
                SUM(output_tokens)         AS total_output_tokens,
                ROUND(SUM(cost_usd), 4)   AS total_cost_usd
            FROM events
            WHERE project_id = ?
              AND event_type  = 'llm_call'
              AND timestamp  BETWEEN ? AND ?
            GROUP BY 1
            ORDER BY call_count DESC
        """,
    ),
}

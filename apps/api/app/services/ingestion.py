import asyncio
import json

from fastapi import HTTPException

from ..db.duckdb import writer
from ..models.events import AgentEvent, CapturePayload

_TRACE_EVENTS = {"trace_started", "trace_completed"}


def _status_normalise(s: str | None) -> str | None:
    """Map 'failed' → 'error' so DB values stay consistent."""
    return "error" if s == "failed" else s


def _event_to_flat(event: AgentEvent, project_id: str) -> dict:
    meta = event.metadata or {}
    is_trace = event.event_type in _TRACE_EVENTS
    status = _status_normalise(event.status)

    # latencyMs means different things per event type
    trace_duration = event.latency_ms if is_trace else None
    step_latency   = event.latency_ms if not is_trace else None

    # cost_usd at top-level is total cost for trace events, per-call cost otherwise
    trace_cost = event.cost_usd if is_trace else None
    call_cost  = event.cost_usd if not is_trace else None

    # Promote well-known metadata keys to dedicated columns
    remaining_meta = {
        k: v for k, v in meta.items()
        if k not in ("input", "output", "tags", "message", "reason",
                     "attempt", "temperature", "cached", "provider", "step_type",
                     "total_steps", "total_llm_calls", "total_tool_calls",
                     "total_input_tokens", "total_output_tokens")
    }

    return {
        "event_id":   event.event_id,
        "trace_id":   event.trace_id,
        "project_id": project_id,
        "timestamp":  event.timestamp,
        "event_type": event.event_type,
        "run_id":     event.run_id,

        # trace-level
        "agent_name":          event.agent_name,
        "user_id":             event.user_id,
        "session_id":          None,
        "trace_status":        status if is_trace else None,
        "trace_duration_ms":   trace_duration,
        "total_steps":         meta.get("total_steps"),
        "total_llm_calls":     meta.get("total_llm_calls"),
        "total_tool_calls":    meta.get("total_tool_calls"),
        "total_input_tokens":  meta.get("total_input_tokens"),
        "total_output_tokens": meta.get("total_output_tokens"),
        "total_cost_usd":      trace_cost,
        "input_text":          meta.get("input"),
        "output_text":         meta.get("output"),
        "tags":                meta.get("tags"),
        "metadata":            json.dumps(remaining_meta) if remaining_meta else None,

        # llm call
        "model":        event.model,
        "provider":     meta.get("provider"),
        "latency_ms":   step_latency,
        "input_tokens": event.input_tokens,
        "output_tokens":event.output_tokens,
        "cost_usd":     call_cost,
        "step_status":  status if not is_trace else None,
        "error_type":   event.error_type,
        "temperature":  meta.get("temperature"),
        "cached":       meta.get("cached"),

        # tool call
        "tool_name":    event.tool_name,
        "retry_count":  None,
        "input_summary":meta.get("query"),

        # step
        "step_index":   event.step_index,
        "step_type":    meta.get("step_type"),

        # error / retry
        "error_message":  meta.get("message"),
        "recoverable":    meta.get("recoverable"),
        "retry_reason":   meta.get("reason"),
        "attempt_number": meta.get("attempt"),
    }


async def ingest(payload: CapturePayload) -> dict:
    project_id = writer.get_project_id(payload.api_key)
    if project_id is None:
        raise HTTPException(status_code=401, detail="Invalid API key")

    if not payload.batch:
        raise HTTPException(status_code=400, detail="batch must not be empty")
    if len(payload.batch) > 500:
        raise HTTPException(status_code=400, detail="batch exceeds maximum size of 500")

    rows = [_event_to_flat(e, project_id) for e in payload.batch]

    try:
        writer.enqueue_nowait(rows)
    except asyncio.QueueFull:
        from .alert import ingest_error
        ingest_error("queue_full", f"Dropped batch of {len(rows)} events — queue at capacity", len(rows))
        raise HTTPException(status_code=429, detail="Write queue full, retry later")

    trace_ids = list({r["trace_id"] for r in rows})
    return {"ingested": len(rows), "trace_ids": trace_ids}

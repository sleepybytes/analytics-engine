from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

# Flat camelCase event — matches the producer payload exactly.
# All per-type fields are optional (NULL in DuckDB for non-applicable events).
# Ingestion service extracts semantic fields from `metadata` where needed.

VALID_EVENT_TYPES = {
    "trace_started", "trace_completed",
    "llm_call", "tool_call", "step_completed",
    "error", "retry",
}


class AgentEvent(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    # ── required base fields ──────────────────────────────────────────────────
    event_id:   str = Field(alias="eventId")
    trace_id:   str = Field(alias="traceId")
    timestamp:  str
    event_type: str = Field(alias="eventType")

    # ── identity / grouping ───────────────────────────────────────────────────
    run_id:     Optional[str] = Field(None, alias="runId")
    agent_name: Optional[str] = Field(None, alias="agentName")
    user_id:    Optional[str] = Field(None, alias="userId")

    # ── shared step fields ────────────────────────────────────────────────────
    step_index: Optional[int]   = Field(None, alias="stepIndex")
    status:     Optional[str]   = None      # running | success | failed | error | timeout | cancelled

    # ── LLM / token fields ───────────────────────────────────────────────────
    model:         Optional[str]   = None
    latency_ms:    Optional[int]   = Field(None, alias="latencyMs")
    input_tokens:  Optional[int]   = Field(None, alias="inputTokens")
    output_tokens: Optional[int]   = Field(None, alias="outputTokens")
    cost_usd:      Optional[float] = Field(None, alias="costUsd")

    # ── tool / error fields ───────────────────────────────────────────────────
    tool_name:  Optional[str] = Field(None, alias="toolName")
    error_type: Optional[str] = Field(None, alias="errorType")

    # ── generic bag ───────────────────────────────────────────────────────────
    metadata: Optional[dict[str, Any]] = None


class CapturePayload(BaseModel):
    api_key: str
    batch:   list[AgentEvent]
    sent_at: str

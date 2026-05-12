from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query

from ..db.duckdb import writer
from ..queries.traces import get_trace, list_traces

router = APIRouter(prefix="/api/traces", tags=["traces"])


def _resolve_project(api_key: str) -> str:
    project_id = writer.get_project_id(api_key)
    if project_id is None:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return project_id


def _default_times() -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=7)).isoformat()
    return start, now.isoformat()


@router.get("")
def get_traces(
    api_key:    str = Query(...),
    start_time: str | None = Query(None),
    end_time:   str | None = Query(None),
    agent_name: str | None = Query(None),
    status:     str | None = Query(None),
    limit:      int = Query(50, ge=1, le=500),
    offset:     int = Query(0, ge=0),
):
    project_id = _resolve_project(api_key)
    if not start_time or not end_time:
        start_time, end_time = _default_times()
    return list_traces(project_id, start_time, end_time, agent_name, status, limit, offset)


@router.get("/{trace_id}")
def get_trace_detail(trace_id: str, api_key: str = Query(...)):
    project_id = _resolve_project(api_key)
    result = get_trace(project_id, trace_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Trace not found")
    return result

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query

from ..db.duckdb import writer
from ..queries.analytics import kpi_summary, run_named_query
from ..queries.registry import QUERY_REGISTRY
from ..services.nl_query import resolve

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _resolve_project(api_key: str) -> str:
    project_id = writer.get_project_id(api_key)
    if project_id is None:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return project_id


def _default_times() -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=7)).isoformat()
    return start, now.isoformat()


@router.get("/queries")
def list_queries():
    """List all available named queries."""
    return {
        qid: {"chart_type": q.chart_type, "description": q.description, "params": q.params}
        for qid, q in QUERY_REGISTRY.items()
    }


@router.get("/kpi")
def get_kpi(
    api_key: str = Query(...),
    start_time: str | None = Query(None),
    end_time:   str | None = Query(None),
):
    project_id = _resolve_project(api_key)
    if not start_time or not end_time:
        start_time, end_time = _default_times()
    return kpi_summary(project_id, start_time, end_time)


@router.get("/nl")
def natural_language_query(
    q:          str = Query(..., description="Natural language query"),
    api_key:    str = Query(...),
    start_time: str | None = Query(None),
    end_time:   str | None = Query(None),
    agent_name: str | None = Query(None),
    model:      str | None = Query(None),
):
    project_id = _resolve_project(api_key)
    query_id = resolve(q)
    if not start_time or not end_time:
        start_time, end_time = _default_times()
    result = run_named_query(query_id, project_id, start_time, end_time, agent_name, model)
    result["nl_query"] = q
    return result


@router.get("/{query_id}")
def run_query(
    query_id:   str,
    api_key:    str = Query(...),
    start_time: str | None = Query(None),
    end_time:   str | None = Query(None),
    agent_name: str | None = Query(None),
    model:      str | None = Query(None),
):
    project_id = _resolve_project(api_key)
    try:
        return run_named_query(query_id, project_id, start_time, end_time, agent_name, model)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

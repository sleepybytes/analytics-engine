from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query

from ..db.duckdb import DuckDBManager, writer
from ..queries.analytics import kpi_summary, run_named_query
from ..queries.registry import QUERY_REGISTRY
from ..services.alert import nl_miss
from ..services.nl_query import SUPPORTED_EXAMPLES, resolve

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


@router.get("/nl/misses")
def get_nl_misses(
    api_key: str = Query(...),
    limit:   int = Query(50, ge=1, le=500),
):
    _resolve_project(api_key)
    cur = DuckDBManager.cursor()
    cur.execute(
        "SELECT id, query, project_id, ts::VARCHAR AS ts FROM nl_miss_log ORDER BY ts DESC LIMIT ?",
        [limit],
    )
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    return {"total": len(rows), "misses": rows}


@router.get("/nl")
async def natural_language_query(
    q:          str = Query(..., description="Natural language query"),
    api_key:    str = Query(...),
    start_time: str | None = Query(None),
    end_time:   str | None = Query(None),
    agent_name: str | None = Query(None),
    model:      str | None = Query(None),
):
    project_id = _resolve_project(api_key)
    nl = resolve(q)
    if nl is None:
        await nl_miss(q, project_id=project_id, api_key=api_key)
        raise HTTPException(
            status_code=400,
            detail=f"Could not match '{q}' to a known metric. Try: {', '.join(SUPPORTED_EXAMPLES)}",
        )
    # NL-extracted params take precedence; explicit query params are fallback
    effective_agent = nl.agent_name or agent_name
    effective_model = nl.model      or model
    effective_start = nl.start_time or start_time
    effective_end   = nl.end_time   or end_time
    if not effective_start or not effective_end:
        effective_start, effective_end = _default_times()
    result = run_named_query(
        nl.query_id, project_id,
        effective_start, effective_end,
        effective_agent, effective_model,
    )
    result["nl_query"]  = q
    result["extracted"] = nl.extracted
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

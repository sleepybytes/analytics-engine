import asyncio
import json
import logging
from datetime import datetime, timezone
from uuid import uuid4

from ..config import settings
from ..db.duckdb import DuckDBManager

logger = logging.getLogger(__name__)


# ── shared webhook ────────────────────────────────────────────────────────────

async def _fire_webhook(payload: dict) -> None:
    try:
        import urllib.request
        body = json.dumps(payload).encode()
        req  = urllib.request.Request(
            settings.alert_webhook_url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, urllib.request.urlopen, req)
        logger.debug("Webhook fired: event=%s", payload.get("event"))
    except Exception:
        logger.exception("Webhook POST failed (url=%s)", settings.alert_webhook_url)


# ── NL miss ───────────────────────────────────────────────────────────────────

def _sync_log_nl_miss(miss_id: str, query: str, project_id: str | None, api_key: str | None) -> None:
    with DuckDBManager.write_lock:
        DuckDBManager.get_conn().execute(
            "INSERT OR IGNORE INTO nl_miss_log (id, query, project_id, api_key, ts) VALUES (?, ?, ?, ?, ?)",
            [miss_id, query, project_id, api_key, datetime.now(timezone.utc).isoformat()],
        )


async def nl_miss(query: str, project_id: str | None = None, api_key: str | None = None) -> None:
    """Log an unmatched NL query to DB and fire the webhook. Never raises."""
    miss_id = str(uuid4())
    ts      = datetime.now(timezone.utc).isoformat()

    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _sync_log_nl_miss, miss_id, query, project_id, api_key)
    except Exception:
        logger.exception("Failed to log NL miss to DB")

    if settings.alert_webhook_url:
        asyncio.create_task(_fire_webhook({
            "event":      "nl_query_miss",
            "query":      query,
            "project_id": project_id,
            "ts":         ts,
            "detail":     f"No rule matched '{query}'",
        }))


# ── ingest / engine errors ────────────────────────────────────────────────────

def ingest_error(error_type: str, detail: str | None = None, batch_size: int | None = None) -> None:
    """
    Called from the DuckDB drain loop (thread executor, not async).
    Logs at ERROR level and fires the webhook so you know the engine is in trouble.
    Never raises.
    """
    logger.error("Engine error [%s] batch_size=%s — %s", error_type, batch_size, detail)

    if not settings.alert_webhook_url:
        return

    ts = datetime.now(timezone.utc).isoformat()
    payload = {
        "event":      "engine_error",
        "error_type": error_type,
        "detail":     detail,
        "batch_size": batch_size,
        "ts":         ts,
    }
    try:
        loop = asyncio.get_event_loop()
        loop.call_soon_threadsafe(
            lambda: asyncio.create_task(_fire_webhook(payload))
        )
    except Exception:
        logger.exception("Failed to schedule engine error webhook")

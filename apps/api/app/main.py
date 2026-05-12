import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db.duckdb import writer
from .routes import capture, health, query, traces
from .services.summarizer import refresh_summary

logging.basicConfig(level=settings.log_level.upper())

logger = logging.getLogger(__name__)

_SUMMARY_INTERVAL_S = 300  # refresh every 5 minutes


async def _summary_loop() -> None:
    while True:
        await asyncio.sleep(_SUMMARY_INTERVAL_S)
        try:
            await refresh_summary()
        except Exception:
            logger.exception("trace_hourly_summary refresh failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await writer.start(settings.db_path)
    summary_task = asyncio.create_task(_summary_loop())
    yield
    summary_task.cancel()
    try:
        await summary_task
    except asyncio.CancelledError:
        pass
    await writer.stop()


app = FastAPI(title="Agent Analytics Engine", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(capture.router)
app.include_router(health.router)
app.include_router(query.router)
app.include_router(traces.router)

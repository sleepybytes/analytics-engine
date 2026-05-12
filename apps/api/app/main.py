import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db.duckdb import writer
from .routes import capture, health, query, traces

logging.basicConfig(level=settings.log_level.upper())


@asynccontextmanager
async def lifespan(app: FastAPI):
    await writer.start(settings.db_path)
    yield
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

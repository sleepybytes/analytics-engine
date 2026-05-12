import asyncio
import logging
import threading
from pathlib import Path

import duckdb

logger = logging.getLogger(__name__)

COLUMNS = [
    "event_id", "trace_id", "project_id", "timestamp", "event_type", "run_id",
    "agent_name", "user_id", "session_id", "trace_status", "trace_duration_ms",
    "total_steps", "total_llm_calls", "total_tool_calls", "total_input_tokens",
    "total_output_tokens", "total_cost_usd", "input_text", "output_text",
    "tags", "metadata",
    "model", "provider", "latency_ms", "input_tokens", "output_tokens",
    "cost_usd", "step_status", "error_type", "temperature", "cached",
    "tool_name", "retry_count", "input_summary",
    "step_index", "step_type",
    "error_message", "recoverable", "retry_reason", "attempt_number",
]

_INSERT_SQL = (
    f"INSERT OR IGNORE INTO events ({', '.join(COLUMNS)}) "
    f"VALUES ({', '.join('?' for _ in COLUMNS)})"
)


class DuckDBManager:
    """
    Strict process-wide singleton for the DuckDB connection.

    Rules:
    - Only one duckdb.connect() call ever happens (in init()).
    - All writes (INSERT, summary refresh) acquire write_lock.
    - Reads use cursor() — DuckDB cursors are thread-safe for concurrent reads
      and do not need the write_lock.
    """

    _conn: duckdb.DuckDBPyConnection | None = None
    write_lock = threading.Lock()  # held by writer AND summarizer for any mutation

    # ── lifecycle ─────────────────────────────────────────────────────────────

    @classmethod
    def init(cls, db_path: str) -> None:
        if cls._conn is not None:
            return
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        cls._conn = duckdb.connect(db_path)
        cls._run_migrations()
        logger.info("DuckDBManager initialized, db=%s", db_path)

    @classmethod
    def close(cls) -> None:
        if cls._conn is not None:
            cls._conn.close()
            cls._conn = None
            logger.info("DuckDBManager closed")

    # ── connection access ─────────────────────────────────────────────────────

    @classmethod
    def get_conn(cls) -> duckdb.DuckDBPyConnection:
        if cls._conn is None:
            raise RuntimeError("DuckDBManager.init() has not been called")
        return cls._conn

    @classmethod
    def cursor(cls) -> duckdb.DuckDBPyConnection:
        """Return a fresh cursor for read-only queries.
        Cursors share the parent connection but are safe to use from multiple
        threads without holding write_lock."""
        return cls.get_conn().cursor()

    # ── project cache ─────────────────────────────────────────────────────────

    @classmethod
    def load_projects(cls) -> dict[str, str]:
        with cls.write_lock:
            rows = cls._conn.execute("SELECT api_key, project_id FROM projects").fetchall()
        return {r[0]: r[1] for r in rows}

    # ── migrations ────────────────────────────────────────────────────────────

    @classmethod
    def _run_migrations(cls) -> None:
        migrations_dir = Path(__file__).parent / "migrations"
        for path in sorted(migrations_dir.glob("*.sql")):
            logger.info("Running migration: %s", path.name)
            with cls.write_lock:
                cls._conn.execute(path.read_text())


# ── async write queue ─────────────────────────────────────────────────────────

class DuckDBWriter:
    """
    Async event ingestion queue.
    Uses DuckDBManager for the actual connection — never calls duckdb.connect().
    """

    def __init__(self) -> None:
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=10_000)
        self._worker_task: asyncio.Task | None = None
        self._projects: dict[str, str] = {}

    async def start(self, db_path: str) -> None:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, DuckDBManager.init, db_path)
        self._projects = await loop.run_in_executor(None, DuckDBManager.load_projects)
        self._worker_task = asyncio.create_task(self._drain_loop())
        logger.info("DuckDBWriter started")

    async def stop(self) -> None:
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, DuckDBManager.close)
        logger.info("DuckDBWriter stopped")

    # ── public API ────────────────────────────────────────────────────────────

    def get_project_id(self, api_key: str) -> str | None:
        return self._projects.get(api_key)

    def enqueue_nowait(self, events: list[dict]) -> None:
        if self._queue.qsize() + len(events) > self._queue.maxsize:
            raise asyncio.QueueFull()
        for event in events:
            self._queue.put_nowait(event)

    # ── drain loop ────────────────────────────────────────────────────────────

    async def _drain_loop(self) -> None:
        buffer: list[dict] = []
        while True:
            try:
                event = await asyncio.wait_for(self._queue.get(), timeout=0.1)
                buffer.append(event)
                if len(buffer) >= 500:
                    await self._flush_buffer(buffer)
                    buffer.clear()
            except asyncio.TimeoutError:
                if buffer:
                    await self._flush_buffer(buffer)
                    buffer.clear()
            except asyncio.CancelledError:
                if buffer:
                    await self._flush_buffer(buffer)
                raise

    async def _flush_buffer(self, buffer: list[dict]) -> None:
        rows = [tuple(e.get(col) for col in COLUMNS) for e in buffer]
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._sync_insert, rows)
        logger.debug("Flushed %d events to DuckDB", len(buffer))

    def _sync_insert(self, rows: list[tuple]) -> None:
        with DuckDBManager.write_lock:
            DuckDBManager.get_conn().executemany(_INSERT_SQL, rows)


# ── module singleton ──────────────────────────────────────────────────────────
# db_path wired in at startup via writer.start(settings.db_path)
writer = DuckDBWriter()

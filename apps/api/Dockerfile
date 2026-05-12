FROM python:3.12-slim AS base
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS development
COPY app/ ./app/
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["uvicorn", "app.main:app", "--reload", "--host", "0.0.0.0", "--port", "8000"]

FROM base AS production
COPY app/ ./app/
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# workers=1 is a hard requirement: DuckDB allows exactly one writer per file.
# Multiple workers = multiple processes = concurrent writes = "database is locked" errors.
CMD ["gunicorn", "app.main:app", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--workers", "1", \
     "--bind", "0.0.0.0:8000", \
     "--timeout", "60"]

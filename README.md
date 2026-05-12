# Agent Trace Analytics Engine

PostHog for LLM agent runs. Every LLM call, tool use, retry, and error your agent makes is captured as a structured event, stored in a columnar analytics store, and surfaced through a dashboard with natural-language query support.

---

## Quick Start

```bash
# 1. Start the full stack (API + frontend)
docker compose up -d

# 2. Open the dashboard
open http://localhost:3000

# 3. Load sample data (1 000 traces, ~15 K events, 30-day spread)
cd simulator && npm install && npm run demo
```

That's it. The dashboard at `localhost:3000` will populate with charts as events land.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  localhost:3000  (nginx)                                    │
│  ┌─────────────────┐   /api/*  ┌──────────────────────────┐ │
│  │  React + Vite   │ ────────► │  FastAPI  (port 8000)    │ │
│  │  Recharts / SWR │          │  POST /capture            │ │
│  └─────────────────┘          │  GET  /api/analytics/*    │ │
│                               │  GET  /api/traces/*       │ │
│                               └──────────┬───────────────┘ │
│                                          │ write queue      │
│                                   ┌──────▼──────┐          │
│                                   │   DuckDB    │          │
│                                   │  (file vol) │          │
│                                   └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

| Port | Service |
|------|---------|
| `3000` | Nginx — serves frontend + proxies `/api/*` to the API |
| `8080` | FastAPI — direct access for curl / SDK |

---

## Repository Layout

```
analytics-engine/
├── docker-compose.yml          # docker compose up → full stack
│
├── packages/
│   └── sdk/                    # TypeScript SDK (publishable)
│       └── src/
│           ├── analytics.ts    # AgentAnalytics class + initAgentAnalytics()
│           ├── trace.ts        # TraceHandle — captures events per run
│           ├── batch-queue.ts  # Count + interval flush (default: 50 events / 5s)
│           ├── http-client.ts  # Exponential backoff, retries 429/502/503/504
│           └── types.ts        # AgentEvent interface (camelCase flat schema)
│
├── apps/
│   ├── api/                    # Python FastAPI backend
│   │   └── app/
│   │       ├── main.py         # FastAPI app, lifespan, CORS
│   │       ├── db/
│   │       │   ├── duckdb.py   # DuckDBManager singleton + DuckDBWriter async queue
│   │       │   └── migrations/ # 001_init.sql — events, projects, summary tables
│   │       ├── routes/
│   │       │   ├── capture.py  # POST /capture
│   │       │   ├── query.py    # GET /api/analytics/*
│   │       │   └── traces.py   # GET /api/traces, GET /api/traces/:id
│   │       ├── services/
│   │       │   ├── ingestion.py   # camelCase→snake_case mapper, enqueues to DuckDB
│   │       │   └── nl_query.py    # Keyword → query_id resolver
│   │       └── queries/
│   │           ├── registry.py    # 8 named SQL queries with chart_type metadata
│   │           ├── analytics.py   # run_named_query(), kpi_summary()
│   │           └── traces.py      # list_traces(), get_trace()
│   │
│   └── web/                    # React + Vite frontend
│       ├── src/
│       │   ├── App.tsx         # Nav + page routing (no react-router needed)
│       │   ├── lib/api.ts      # Typed fetch wrapper — all API calls
│       │   ├── hooks/useAnalytics.ts  # SWR hooks, 5-min refresh
│       │   ├── pages/
│       │   │   ├── Dashboard.tsx      # KPI cards + 4 Recharts charts
│       │   │   ├── TraceExplorer.tsx  # Paginated traces + slide-in event detail
│       │   │   └── Analytics.tsx      # NL query input + results
│       │   └── components/
│       │       ├── KpiCard.tsx
│       │       ├── FilterBar.tsx      # Time range (1h/24h/7d/30d) + agent filter
│       │       ├── TraceDetail.tsx    # Event timeline in a slide-over panel
│       │       └── charts/
│       │           ├── VolumeChart.tsx   # Line — trace count per hour by agent
│       │           ├── LatencyChart.tsx  # Line — P50/P95 LLM latency by model
│       │           └── BarChart.tsx      # Generic bar (model dist, tool errors, etc.)
│       ├── nginx.conf          # SPA fallback + /api/* proxy
│       └── Dockerfile          # Multi-stage: node build → nginx serve
│
└── simulator/                  # Toy agent data generator
    └── src/
        ├── run.ts              # CLI entry — --mode demo|bench
        ├── simulator.ts        # Batch sender with retry
        ├── builder.ts          # Trace/event construction helpers
        └── agents/
            ├── research.ts     # Web search + summarize pattern
            ├── code.ts         # Plan + implement + review pattern
            └── qa.ts           # Retrieval + answer pattern
```

---

## SDK Usage

```typescript
import { initAgentAnalytics } from '@analytics-engine/sdk'

const analytics = initAgentAnalytics({
  apiKey: 'dev_project_key',
  host:   'http://localhost:8080',
})

async function runAgent(userQuery: string) {
  const trace = analytics.startTrace({
    agentName: 'my-agent',
    input:     userQuery,
  })

  // Capture an LLM call
  trace.captureLLMCall({
    model:        'gpt-4o',
    latencyMs:    1240,
    inputTokens:  512,
    outputTokens: 180,
    costUsd:      0.0031,
  })

  // Capture a tool call
  trace.captureToolCall({
    toolName:  'web_search',
    latencyMs: 430,
    status:    'success',
  })

  // End the trace
  trace.end({ status: 'success', output: 'Answer generated.' })

  await analytics.flush()  // ensure events are sent before process exits
}
```

Events are batched (default: 50 events or 5 seconds) and sent with exponential backoff retry.

---

## API Reference

All query endpoints require `?api_key=<your_key>`.

### Ingestion

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/capture` | Ingest a batch of events (max 500 per request) |

### Analytics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/analytics/kpi` | KPI summary — count, success rate, latency, cost |
| `GET` | `/api/analytics/queries` | List all 8 named queries with chart_type metadata |
| `GET` | `/api/analytics/{query_id}` | Run a named query with optional filters |
| `GET` | `/api/analytics/nl?q=...` | Natural-language → query routing |

**Named queries:** `trace_volume` · `avg_llm_latency_by_model` · `tool_error_rate` · `token_usage_by_agent` · `cost_per_run_by_model` · `top_slow_traces` · `avg_steps_by_outcome` · `model_usage_distribution`

**Common query params:** `start_time`, `end_time`, `agent_name`, `model`

### Traces

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/traces` | Paginated trace list with filters |
| `GET` | `/api/traces/{trace_id}` | Full trace detail — summary + all events |

**Trace params:** `start_time`, `end_time`, `agent_name`, `status`, `limit`, `offset`

### Examples

```bash
API_KEY=dev_project_key
BASE=http://localhost:8080

# KPI summary for last 7 days
curl "$BASE/api/analytics/kpi?api_key=$API_KEY"

# Model usage distribution
curl "$BASE/api/analytics/model_usage_distribution?api_key=$API_KEY"

# Natural language query
curl "$BASE/api/analytics/nl?api_key=$API_KEY&q=show+me+the+slowest+traces"

# Paginated traces
curl "$BASE/api/traces?api_key=$API_KEY&limit=20&offset=0"

# Single trace detail
curl "$BASE/api/traces/<trace_id>?api_key=$API_KEY"
```

---

## Event Schema

All events share a single flat camelCase shape. Unused fields are `null`.

```typescript
interface AgentEvent {
  // required
  eventId:      string        // UUID v4 — idempotency key
  traceId:      string        // groups all events in one agent run
  timestamp:    string        // ISO 8601

  eventType:    'trace_started' | 'trace_completed' | 'llm_call'
              | 'tool_call' | 'step_completed' | 'error' | 'retry'

  // identity
  agentName?:   string
  runId?:       string
  userId?:      string

  // status / ordering
  status?:      'running' | 'success' | 'failed' | 'error' | 'timeout' | 'cancelled'
  stepIndex?:   number

  // LLM
  model?:       string
  latencyMs?:   number
  inputTokens?: number
  outputTokens?:number
  costUsd?:     number

  // tool / error
  toolName?:    string
  errorType?:   string

  // extras (input, output, tags, provider, temperature, …)
  metadata?:    Record<string, unknown>
}
```

The ingestion layer promotes well-known `metadata` keys to dedicated DB columns: `input`, `output`, `tags`, `message`, `reason`, `attempt`, `temperature`, `cached`, `provider`, `step_type`, and the `total_*` aggregates on `trace_completed`.

---

## Key Design Decisions

**DuckDB as the analytics store.** Single embedded file, zero ops overhead, columnar storage with vectorised execution. Aggregation over 1 M events runs in ~50–200 ms. One writer per process — the API uses an asyncio queue with a background drain loop so all writes are serialised through a single connection.

**Single flat event table.** Wide table, columnar storage means null columns cost almost nothing. No joins needed for any dashboard query.

**Async write queue.** `DuckDBWriter` buffers events in an `asyncio.Queue(maxsize=10_000)` and flushes in batches of up to 500 every 100 ms. This keeps the `/capture` endpoint non-blocking.

**camelCase SDK → snake_case DB.** The SDK emits camelCase (`eventId`, `traceId`, `latencyMs`). The FastAPI layer accepts either form via Pydantic `Field(alias=...)` and maps to the DB's snake_case columns in `ingestion.py`.

**NL query routing.** Simple keyword regex rules in `nl_query.py` — no LLM needed. "show slow traces" → `top_slow_traces`, "cost by model" → `cost_per_run_by_model`, etc.

---

## Development

### Running locally (without Docker)

```bash
# API (requires Python 3.12+)
cd apps/api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DB_PATH=./dev.duckdb uvicorn app.main:app --reload --port 8080

# Frontend (hot-reload via Vite proxy → localhost:8080)
cd apps/web
npm install && npm run dev
# open http://localhost:5173
```

### Rebuilding Docker images after code changes

```bash
# API hot-reloads automatically (bind-mounted via docker-compose)

# Frontend — rebuild image after changes
docker compose build web && docker compose up -d web
```

### Simulator modes

```bash
cd simulator
npm run demo   # 1 000 traces (~15 K events), 30-day spread
npm run bench  # 10 000 traces (~130 K events)

# Point at a different API
API_URL=http://my-api:8080 API_KEY=my_key npm run demo
```

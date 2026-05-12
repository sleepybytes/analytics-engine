# Production Architecture — Scaling to 100 M Events

## Current state (prototype)

```
SDK → POST /capture → asyncio.Queue → DuckDB file
                                           ↑
                              single writer, single process
```

DuckDB is the right choice for a prototype: zero ops, excellent analytics performance at <10 M rows, and near-identical SQL to ClickHouse. Every architectural decision was made to make the migration tractable — flat wide table, columnar layout, no application-level joins, a single ingestion service.

At 100 M events the prototype breaks on three axes:

| Constraint | Why it breaks |
|---|---|
| Single writer | One uvicorn process, one DuckDB connection. Cannot add API replicas. |
| File-based storage | No replication, no HA, no distributed reads. One disk → one failure domain. |
| No streaming ingest | asyncio.Queue is in-process. Restart = lost events. No replay. |

---

## Target architecture

```
                    ┌─────────────────────────────────────────┐
                    │               Clients                   │
                    │  (SDK agents, HTTP producers)           │
                    └──────────────┬──────────────────────────┘
                                   │ POST /capture
                    ┌──────────────▼──────────────────────────┐
                    │         API Tier  (3+ replicas)         │
                    │         FastAPI + uvicorn               │
                    │    validates → publishes to Kafka       │
                    └──────────────┬──────────────────────────┘
                                   │ produce
                    ┌──────────────▼──────────────────────────┐
                    │          Kafka / Redpanda               │
                    │   topic: agent_events  (7-day retention)│
                    │   3 brokers × 12 partitions             │
                    └──────────────┬──────────────────────────┘
                                   │ consume (Kafka table engine)
                    ┌──────────────▼──────────────────────────┐
                    │         ClickHouse Cluster              │
                    │  3 shards × 2 replicas  (6 nodes)      │
                    │  events (ReplicatedMergeTree)           │
                    │  trace_hourly_mv (real-time MatView)    │
                    └──────────────┬──────────────────────────┘
                                   │ query
                    ┌──────────────▼──────────────────────────┐
                    │         Query API  (stateless)          │
                    │         same FastAPI routes             │
                    │         read from ClickHouse            │
                    └──────────────┬──────────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────────┐
                    │         React Dashboard                 │
                    │         (unchanged)                     │
                    └─────────────────────────────────────────┘
```

---

## 1. Storage — DuckDB → ClickHouse

### Why ClickHouse

- Same columnar, vectorised execution model as DuckDB — queries are structurally identical.
- ReplicatedMergeTree gives HA + replication for free.
- Materialized views replace the background summariser task with a zero-lag, server-side aggregate.
- Native Kafka table engine: no separate consumer process.
- Inserts at 500 K–1 M rows/s per node; 100 M events loaded in minutes.

### Table DDL

```sql
-- Distributed table (client-facing)
CREATE TABLE events ON CLUSTER '{cluster}' (
    event_id        String,
    trace_id        String,
    project_id      LowCardinality(String),
    timestamp       DateTime64(3, 'UTC'),
    event_type      LowCardinality(String),
    run_id          Nullable(String),
    agent_name      LowCardinality(String),
    user_id         Nullable(String),
    session_id      Nullable(String),
    trace_status    LowCardinality(String),
    trace_duration_ms  Nullable(Int32),
    total_steps        Nullable(Int32),
    total_llm_calls    Nullable(Int32),
    total_tool_calls   Nullable(Int32),
    total_input_tokens Nullable(Int64),
    total_output_tokens Nullable(Int64),
    total_cost_usd     Nullable(Float64),
    input_text      Nullable(String),
    output_text     Nullable(String),
    model           LowCardinality(String),
    provider        LowCardinality(String),
    latency_ms      Nullable(Int32),
    input_tokens    Nullable(Int32),
    output_tokens   Nullable(Int32),
    cost_usd        Nullable(Float64),
    step_status     LowCardinality(String),
    error_type      LowCardinality(String),
    tool_name       LowCardinality(String),
    step_index      Nullable(Int32),
    step_type       LowCardinality(String),
    error_message   Nullable(String),
    recoverable     Nullable(Bool),
    retry_reason    Nullable(String),
    attempt_number  Nullable(Int32),
    metadata        String DEFAULT '{}'
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/{cluster}/tables/{shard}/events',
    '{replica}'
)
PARTITION BY toYYYYMM(timestamp)          -- prune whole months in range queries
ORDER BY (project_id, toStartOfHour(timestamp), trace_id, event_type)
TTL timestamp + INTERVAL 12 MONTH        -- auto-drop events older than 1 year
SETTINGS index_granularity = 8192;

-- Distributed layer (routes queries to shards)
CREATE TABLE events_dist ON CLUSTER '{cluster}'
ENGINE = Distributed('{cluster}', default, events, rand());
```

### Key schema choices

**`LowCardinality(String)`** on `agent_name`, `model`, `event_type`, `project_id` — encodes repeated strings as integers internally, reducing storage by 3–5× and speeding up GROUP BY.

**`PARTITION BY toYYYYMM(timestamp)`** — ClickHouse skips entire month partitions when the WHERE clause constrains timestamp. A 7-day query on 100 M events only reads ~2 month partitions.

**`ORDER BY (project_id, toStartOfHour(timestamp), ...)`** — primary sort key. Dashboard queries filter on `project_id` first, then a time window. This sort order makes those queries read the minimum number of granules.

**`TTL timestamp + INTERVAL 12 MONTH`** — data expires automatically. No manual cleanup job.

### Materialized view (replaces background summariser)

```sql
CREATE MATERIALIZED VIEW trace_hourly_mv
ON CLUSTER '{cluster}'
ENGINE = ReplicatedSummingMergeTree(...)
PARTITION BY toYYYYMM(hour)
ORDER BY (project_id, hour, agent_name, model)
AS
SELECT
    project_id,
    toStartOfHour(timestamp)      AS hour,
    agent_name,
    model,
    countIf(event_type = 'trace_started')           AS trace_count,
    countIf(trace_status = 'success')               AS success_count,
    countIf(trace_status NOT IN ('success','running','')) AS error_count,
    avgIf(trace_duration_ms, event_type = 'trace_completed') AS avg_duration_ms,
    quantileIf(0.95)(trace_duration_ms, event_type = 'trace_completed') AS p95_duration_ms,
    sumIf(total_cost_usd, event_type = 'trace_completed')    AS total_cost_usd,
    sumIf(total_input_tokens,  event_type = 'trace_completed') AS total_input_tokens,
    sumIf(total_output_tokens, event_type = 'trace_completed') AS total_output_tokens
FROM events
GROUP BY project_id, hour, agent_name, model;
```

This view is updated in real-time on every insert — no cron, no refresh lag.

---

## 2. Ingestion — asyncio.Queue → Kafka

### Why Kafka

The asyncio queue is in-process: API restart = lost events. At 100 M events/day (~1 200 events/s average, 10 K+ peak), you need durable buffering and the ability to run multiple API replicas.

**Kafka gives:**
- Durable log — events survive API restarts and ClickHouse downtime.
- Backpressure — producers block or return 429 if brokers are full, rather than silently dropping.
- Replay — reprocess the last 7 days of events by rewinding the consumer offset.
- Fan-out — future consumers (alerts, ML pipelines) subscribe to the same topic.

### Kafka → ClickHouse (native integration)

```sql
-- ClickHouse reads directly from Kafka; no separate consumer process needed
CREATE TABLE events_kafka ON CLUSTER '{cluster}' (
    raw String
)
ENGINE = Kafka
SETTINGS
    kafka_broker_list     = 'broker1:9092,broker2:9092,broker3:9092',
    kafka_topic_list      = 'agent_events',
    kafka_group_name      = 'clickhouse_ingest',
    kafka_format          = 'JSONEachRow',
    kafka_num_consumers   = 4,
    kafka_max_block_size  = 65536;

-- A view that parses raw JSON and writes to the main table
CREATE MATERIALIZED VIEW events_kafka_mv ON CLUSTER '{cluster}'
TO events AS
SELECT
    JSONExtractString(raw, 'event_id')   AS event_id,
    JSONExtractString(raw, 'trace_id')   AS trace_id,
    -- … all other fields
FROM events_kafka;
```

### API changes

Replace the `DuckDBWriter` with a Kafka producer:

```python
# services/producer.py
from aiokafka import AIOKafkaProducer
import orjson

class KafkaProducer:
    def __init__(self, brokers: str, topic: str):
        self._topic = topic
        self._producer = AIOKafkaProducer(
            bootstrap_servers=brokers,
            value_serializer=orjson.dumps,
            compression_type='lz4',        # ~4× smaller payloads
            linger_ms=5,                   # micro-batch for throughput
            max_batch_size=1_000_000,
        )

    async def start(self): await self._producer.start()
    async def stop(self):  await self._producer.stop()

    async def send_batch(self, events: list[dict]) -> None:
        for event in events:
            await self._producer.send(self._topic, value=event)
        # fire-and-forget; Kafka handles durability
```

`POST /capture` now publishes to Kafka and returns immediately — no write-path latency from ClickHouse. The API is now stateless and horizontally scalable.

---

## 3. Query layer — SQL compatibility

DuckDB and ClickHouse share ~90% of the SQL used in `queries/registry.py`. The changes are mechanical:

| DuckDB | ClickHouse |
|---|---|
| `PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY col)` | `quantile(0.95)(col)` |
| `date_trunc('hour', ts)` | `toStartOfHour(ts)` |
| `timestamp::VARCHAR` | `toString(timestamp)` |
| `INSERT OR IGNORE` | `INSERT INTO … (deduplication via ReplicatedMergeTree)` |
| `COALESCE(x, 0)` | `ifNull(x, 0)` |
| `COUNT(*) FILTER (WHERE …)` | `countIf(…)` |
| `ROUND(x, 2)` | `round(x, 2)` |

Every query in `registry.py` needs these token substitutions — no structural changes.

### Connection pooling

Replace the DuckDB singleton with `clickhouse-connect`:

```python
import clickhouse_connect

client = clickhouse_connect.get_client(
    host=settings.clickhouse_host,
    port=8123,
    database='default',
    username=settings.clickhouse_user,
    password=settings.clickhouse_password,
    compress=True,
    query_retries=2,
)

def run_query(sql: str, params: list) -> list[dict]:
    result = client.query(sql, parameters=params)
    return [dict(zip(result.column_names, row)) for row in result.result_rows]
```

`clickhouse-connect` is async-safe and connection-pool backed — no `write_lock` needed.

---

## 4. Infrastructure

### Minimum viable production cluster

```
                    ┌─────────────────────────────────┐
                    │    Load Balancer  (nginx/ALB)   │
                    └──────┬──────┬──────┬────────────┘
                           │      │      │
                  ┌────────▼┐  ┌──▼─────┐  ┌──▼─────┐
                  │ API     │  │ API    │  │ API    │
                  │ replica │  │replica │  │replica │
                  └────────┬┘  └──┬─────┘  └──┬─────┘
                           │      │            │
                    ┌──────▼──────▼────────────▼──────┐
                    │   Kafka  (3 brokers, 12 parts)  │
                    └──────────────┬──────────────────┘
                                   │
           ┌───────────────────────┼───────────────────────┐
           │  Shard 1              │  Shard 2              │  Shard 3
    ┌──────▼──────┐         ┌──────▼──────┐         ┌──────▼──────┐
    │  CH node 1  │◄──────► │  CH node 3  │◄──────► │  CH node 5  │
    │  (primary)  │  replic │  (primary)  │  replic │  (primary)  │
    └──────┬──────┘         └──────┬──────┘         └──────┬──────┘
    ┌──────▼──────┐         ┌──────▼──────┐         ┌──────▼──────┐
    │  CH node 2  │         │  CH node 4  │         │  CH node 6  │
    │  (replica)  │         │  (replica)  │         │  (replica)  │
    └─────────────┘         └─────────────┘         └─────────────┘
```

### Node sizing for 100 M events

| Component | Size | Count | Notes |
|---|---|---|---|
| API | 2 vCPU / 2 GB | 3+ | Stateless, autoscale on CPU |
| Kafka broker | 4 vCPU / 16 GB / 1 TB NVMe | 3 | 7-day retention at ~500 bytes/event ≈ 350 GB |
| ClickHouse node | 16 vCPU / 64 GB / 4 TB NVMe | 6 | 100 M × 500 bytes compressed ≈ 50 GB per shard |

ClickHouse compresses columnar data at 5–10×, so 100 M events at ~1 KB raw ≈ **10–20 GB per shard** with LZ4. The sizing above has 20× headroom for 1 B+ events.

### Kubernetes manifests (sketch)

```yaml
# API — horizontal pod autoscaler
apiVersion: apps/v1
kind: Deployment
metadata: { name: analytics-api }
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: api
        image: analytics-api:latest
        resources:
          requests: { cpu: 500m, memory: 512Mi }
          limits:   { cpu: 2000m, memory: 2Gi }
        env:
        - { name: KAFKA_BROKERS,       valueFrom: { secretKeyRef: { name: kafka, key: brokers } } }
        - { name: CLICKHOUSE_HOST,     valueFrom: { secretKeyRef: { name: clickhouse, key: host } } }
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  scaleTargetRef: { name: analytics-api }
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource: { name: cpu, target: { type: Utilization, averageUtilization: 60 } }
```

---

## 5. Migration strategy

Run both systems in parallel. Zero-downtime, rollback at any phase.

```
Phase 1 — Dual write (week 1–2)
  API writes to:  DuckDB queue (existing)  +  Kafka (new)
  Queries read from: DuckDB (unchanged)
  Goal: validate Kafka throughput and ClickHouse schema under real traffic.

Phase 2 — Read cutover (week 3)
  API writes to:  Kafka only
  Queries read from: ClickHouse
  DuckDB: kept running in read-only mode for rollback
  Goal: validate query results match. Run shadow-read comparisons.

Phase 3 — Cleanup (week 4)
  Remove DuckDB code paths.
  Archive DuckDB file to object storage (S3/GCS).
  Done.
```

### Shadow-read comparison script

```python
# Run both and diff results — catches SQL translation bugs before cutover
async def shadow_compare(query_id: str, params: dict):
    duck_result = run_duckdb_query(query_id, params)
    ch_result   = run_clickhouse_query(query_id, params)
    if duck_result != ch_result:
        logger.warning("Shadow diff on %s: duck=%s ch=%s", query_id, duck_result, ch_result)
```

---

## 6. What does NOT change

These components require zero modification:

- **TypeScript SDK** — emits the same camelCase flat events to `POST /capture`. The SDK has no knowledge of the storage layer.
- **`POST /capture` contract** — same endpoint, same Pydantic model, same 400/422/429 behaviour. Only the write destination changes (Kafka instead of DuckDB queue).
- **`GET /api/analytics/*` routes** — same URL structure, same query params, same JSON response shape. Only the SQL dialect changes internally.
- **React dashboard** — zero changes. It talks to the query API, not the database.
- **`/api/traces` routes** — same response shape, SQL token substitution only.
- **NL query resolver** — pure Python keyword matching, no storage dependency.

---

## 7. Observability at scale

Add these before going to production:

```python
# Track ingest lag: time between event.timestamp and now()
# If > 60s consistently → Kafka consumer is falling behind
ingest_lag_seconds = (datetime.utcnow() - event.timestamp).total_seconds()
metrics.histogram('ingest_lag_seconds', ingest_lag_seconds)

# Track Kafka producer errors
metrics.increment('kafka_produce_errors', tags=['topic:agent_events'])

# ClickHouse query latency per query_id
with metrics.timer('clickhouse_query_seconds', tags=[f'query:{query_id}']):
    result = run_named_query(...)
```

**Key dashboards to build** (in your own tool, naturally):

| Metric | Alert threshold |
|---|---|
| Kafka consumer lag | > 100 K messages |
| Ingest lag p99 | > 30 s |
| `/capture` p99 latency | > 500 ms |
| ClickHouse disk usage | > 70% |
| Query p95 latency | > 2 s |

---

## 8. Cost estimate (AWS, us-east-1)

| Component | Instance | $/month |
|---|---|---|
| API (3×) | t3.small | $50 |
| Kafka (3×) | m6i.xlarge + 1 TB gp3 | $750 |
| ClickHouse (6×) | r6i.4xlarge + 4 TB gp3 | $6 000 |
| Load balancer | ALB | $25 |
| **Total** | | **~$6 800/month** |

At 100 M events/month that's **$0.068 per 1 000 events**. ClickHouse Cloud or Altinity reduce ops overhead at similar cost. At 1 B events, the ClickHouse nodes scale vertically (r6i.8xlarge) rather than adding shards — cost grows sub-linearly.

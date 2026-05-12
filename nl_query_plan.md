# NL Query Engine — Improvement Plan

## Current State

Keyword substring matcher in `nl_query.py`:
- Ordered list of `(keywords[], query_id)` tuples
- First match wins — no scoring, no ranking
- Entity extraction via hardcoded regex patterns
- LLM fallback: none (returns 400)

**Problems at scale:**
- Adding coverage requires editing Python source
- Order of rules creates silent priority bugs ("errors" before "error rate")
- No stemming — "failed", "failing", "fails" are separate entries
- No confidence signal — a weak match looks the same as a strong one
- No way to know what fraction of real queries are falling through

---

## Phase 1 — Config-Driven Rule Engine

Move rules out of code into YAML so they can be edited, reviewed, and hot-reloaded
without a deploy.

### File layout

```
apps/api/app/nl/
  rules/
    intents.yml       # intent → query_id mappings
    synonyms.yml      # word → canonical form (stemming substitute)
    entities.yml      # entity extraction patterns
  engine.py           # loads + evaluates rules
  fallback.py         # LLM fallback (Phase 3)
```

### `intents.yml` structure

```yaml
intents:
  - id: tool_error_rate
    query_id: tool_error_rate
    description: "Error and failure rates broken down by tool"
    keywords:
      - tool error
      - tool fail
      - tool failure
      - failing tool
      - broken tool
      - which tool
      - errors of
      - errors for
      - failing
    phrases:                      # multi-token phrases scored higher than bare keywords
      - "which tools are failing"
      - "what is broken"
      - "tool reliability"
    examples:                     # used in error messages and docs
      - "which tools are failing"
      - "tool error rate last 24h"
      - "errors of qa agent today"

  - id: avg_llm_latency_by_model
    query_id: avg_llm_latency_by_model
    description: "P50/P95 LLM latency broken down by model"
    keywords:
      - latency
      - response time
      - p95
      - p50
      - p99
      - how fast
      - inference time
      - performing
      - model performance
    phrases:
      - "how is X performing"
      - "model speed"
      - "time to respond"
    examples:
      - "gpt-4o latency last 7d"
      - "how is claude-3-opus performing today"
      - "model performance for research agent"
```

### `synonyms.yml` structure

Normalises words before matching so a single keyword covers all surface forms.

```yaml
synonyms:
  # verb stems
  fail:     [failing, failed, fails, failure, failures]
  error:    [errors, erroring, errored]
  spend:    [spending, spent]
  run:      [running, ran, runs]
  perform:  [performing, performed, performance]
  slow:     [slower, slowest, slowing, slowed]

  # domain synonyms
  cost:     [price, spend, billing, dollar, usd, money, budget]
  latency:  [response time, lag, speed, ms, millisecond, inference time]
  token:    [tokens, context, prompt size, bandwidth]
  trace:    [traces, run, runs, execution, log, logs]
  model:    [gpt, claude, gemini, llama, mistral, o1]
```

### `entities.yml` structure

```yaml
entities:
  time_window:
    patterns:
      - regex: 'last\s+(\d+)\s+hour'
        type: relative
        unit: hours
        group: 1
      - regex: 'last\s+(\d+)\s+day'
        type: relative
        unit: days
        group: 1
      - regex: '\b(\d+)h\b'
        type: relative
        unit: hours
        group: 1
      - keyword: today
        type: named
        value: today
      - keyword: yesterday
        type: named
        value: yesterday
      - keyword: this week
        type: named
        value: 7d
      - keyword: this month
        type: named
        value: 30d

  agent:
    patterns:
      - regex: '\b([a-z][a-z0-9]*[-_]agent)\b'
        priority: 10          # highest — explicit suffix
      - regex: '\b([a-z][a-z0-9_\-]{1,})\s+agent\b'
        priority: 8
      - regex: '\bfor\s+(?:agent\s+)?([a-z][a-z0-9_\-]{1,})\b'
        priority: 6
      - regex: '\b([a-z][a-z0-9_\-]{1,})\s+(?:logs?|traces?|runs?)\b'
        priority: 4
    stop_words:
      - [the, a, an, my, our, for, by, in, on, at, from, all, any, each,
         per, with, show, get, give, list, make, made, did, do, have, had,
         what, which, how, when, where, who, why, trace, model, tool, agent]

  model:
    known_values:             # sorted longest-first at load time
      - gpt-4o-mini
      - gpt-4o
      - gpt-4-turbo
      - gpt-4
      - gpt-3.5-turbo
      - claude-3-5-sonnet
      - claude-3-5-haiku
      - claude-3-opus
      - claude-3-sonnet
      - claude-3-haiku
      - gemini-1.5-pro
      - gemini-1.5-flash
      - llama-3.1
      - llama-3
      - mistral-large
      - mistral-7b
      - o1-mini
      - o1-preview
      - o1
```

### Scoring engine

Replace first-match with a scored approach so an ambiguous query picks the
highest-confidence intent rather than whichever rule appears first in the file.

```python
@dataclass
class IntentScore:
    query_id: str
    score:    float          # 0.0 – 1.0
    matched:  list[str]      # which keywords/phrases triggered

def score_intent(query: str, intent: IntentDef) -> IntentScore:
    tokens = tokenize_and_stem(query)   # apply synonyms.yml
    score  = 0.0
    matched = []

    for phrase in intent.phrases:       # multi-word phrase → higher weight
        if phrase in query.lower():
            score += 0.4
            matched.append(phrase)

    for kw in intent.keywords:          # single keyword → lower weight
        if kw in tokens:
            score += 0.2
            matched.append(kw)

    return IntentScore(intent.query_id, min(score, 1.0), matched)

def resolve(query: str) -> NLResult | None:
    scores = [score_intent(query, i) for i in load_intents()]
    best   = max(scores, key=lambda s: s.score)

    if best.score < 0.2:               # below confidence floor → Phase 3 fallback
        return llm_fallback(query)

    return build_result(best, query)
```

**Confidence thresholds:**

| Score | Action |
|---|---|
| ≥ 0.6 | High confidence — use directly |
| 0.2 – 0.6 | Medium — use but include `"confidence": "low"` in response |
| < 0.2 | No match — go to LLM fallback |

---

## Phase 2 — Coverage Gaps to Close

### New intent categories not yet mapped

| User intent | Example queries | Suggested query_id |
|---|---|---|
| Retry behaviour | "how many retries", "retry rate", "flaky calls" | new: `retry_rate` |
| Cache hit rate | "cache hits", "how much is cached", "cache efficiency" | new: `cache_hit_rate` |
| User activity | "most active users", "which user runs most", "user breakdown" | new: `usage_by_user` |
| Cost trend | "is cost increasing", "cost over time", "spend trend" | reuse: `cost_per_run_by_model` with time grouping |
| Error detail | "show me error messages", "what errors occurred" | new or extend `top_slow_traces` |
| Agent comparison | "compare research vs code agent", "which agent is better" | new: `agent_comparison` |

### Entity extraction gaps

| Gap | Example | Fix |
|---|---|---|
| Relative model comparison | "gpt vs claude" | parse both sides as models |
| Ordinal limit | "top 5 traces", "show 20 results" | extract N → pass as `limit` param |
| Absolute date range | "from May 1 to May 10" | add ISO / natural date parser |
| Metric modifier | "average cost", "total tokens", "max latency" | extract aggregation hint |
| Sort direction | "worst traces", "best performing model" | map worst/best → ORDER BY direction |
| Percentile request | "p99 latency", "99th percentile" | extract percentile → map to SQL |

### Synonym gaps (common words not yet covered)

```yaml
# add to synonyms.yml
investigate: [debug, diagnose, inspect, analyse, analyze]
expensive:   [costly, pricey, high cost, overbudget]
broken:      [busted, failing, down, not working, issue]
agent:       [bot, assistant, worker, service, pipeline]
```

---

## Phase 3 — LLM Fallback

When the rule engine scores below the confidence floor, call Claude to parse the
query and return a structured `NLResult`.

### Design

```
User query
    │
    ▼
Rule engine  ──score ≥ 0.2──►  NLResult (fast, free)
    │
  score < 0.2
    │
    ▼
Response cache (Redis / in-memory LRU)
    │
  cache miss
    │
    ▼
Claude API  ──structured output──►  NLResult
    │
    ▼
Cache write (TTL 1 hour)
    │
    ▼
Log to `nl_fallback_log` table  (query, matched_query_id, latency_ms)
```

### Prompt design

```python
SYSTEM = """
You are a query router for an agent analytics platform.
Given a natural language query, return a JSON object with:
  - query_id: one of {query_ids}
  - agent_name: string or null
  - model: string or null
  - start_time: ISO8601 or null
  - end_time: ISO8601 or null
  - confidence: "high" | "medium" | "low"

Return ONLY valid JSON. No explanation.
Current time (UTC): {now}
""".strip()

USER = "Query: {query}"
```

### Structured output (tool use)

Use Claude's tool use to guarantee JSON schema compliance — no regex parsing of
the response needed.

```python
TOOL = {
    "name": "route_query",
    "description": "Route a natural language query to an analytics query",
    "input_schema": {
        "type": "object",
        "properties": {
            "query_id":   {"type": "string", "enum": list(QUERY_REGISTRY.keys())},
            "agent_name": {"type": ["string", "null"]},
            "model":      {"type": ["string", "null"]},
            "start_time": {"type": ["string", "null"], "format": "date-time"},
            "end_time":   {"type": ["string", "null"], "format": "date-time"},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        },
        "required": ["query_id", "confidence"],
    },
}
```

### Fallback policy

```python
MAX_FALLBACK_RPS   = 5          # rate-limit LLM calls
FALLBACK_TIMEOUT_S = 3.0        # if Claude takes > 3s, return 400
CACHE_TTL_S        = 3600       # cache identical queries for 1 hour
LOG_ALL_FALLBACKS  = True       # log to nl_fallback_log for rule improvement
```

### Using fallback data to improve rules

Every LLM fallback call is a rule gap. Weekly process:
1. Query `nl_fallback_log` for the top 20 queries by frequency
2. Add the high-confidence ones as new keywords/phrases in `intents.yml`
3. This gradually pushes coverage back to the rule engine (free + fast path)

---

## Phase 4 — Observability

Track NL query health as a first-class metric.

### `nl_query_log` table

```sql
CREATE TABLE nl_query_log (
    id           INTEGER PRIMARY KEY,
    query        VARCHAR NOT NULL,
    matched_id   VARCHAR,              -- null = no match
    via          VARCHAR,              -- 'rules' | 'llm' | 'cache'
    confidence   DOUBLE,
    agent_name   VARCHAR,
    model        VARCHAR,
    time_window  VARCHAR,
    latency_ms   INTEGER,
    ts           TIMESTAMPTZ DEFAULT now()
);
```

### Metrics to surface

| Metric | How to compute |
|---|---|
| Rule hit rate | `COUNT WHERE via='rules'` / total |
| LLM fallback rate | `COUNT WHERE via='llm'` / total |
| No-match rate | `COUNT WHERE matched_id IS NULL` / total |
| Top unmatched queries | `GROUP BY query WHERE matched_id IS NULL ORDER BY COUNT DESC` |
| Avg rule latency | `AVG(latency_ms) WHERE via='rules'` |
| Avg LLM latency | `AVG(latency_ms) WHERE via='llm'` |

### `/api/analytics/nl/stats` endpoint

```json
{
  "rule_hit_rate": 0.84,
  "llm_fallback_rate": 0.09,
  "no_match_rate": 0.07,
  "top_unmatched": ["show p99", "agent memory usage", "cost per user"],
  "avg_rule_latency_ms": 0.4,
  "avg_llm_latency_ms": 610
}
```

This endpoint makes the rule engine self-improving: unmatched queries surface
directly in the dashboard, making gaps visible without log diving.

---

## Implementation Order

| Phase | Effort | Impact | Do when |
|---|---|---|---|
| Phase 1 — Config-driven YAML + scoring | Medium | High — eliminates ordering bugs, hot-reload | Now |
| Phase 2 — Coverage gaps | Low | Medium — more queries work out of the box | Alongside Phase 1 |
| Phase 3 — LLM fallback | Medium | High — handles anything the rules miss | After Phase 1 |
| Phase 4 — Observability | Low | High — makes gaps visible and drives Phase 2 | After Phase 3 |

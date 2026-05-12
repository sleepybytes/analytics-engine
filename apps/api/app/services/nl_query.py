import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone


@dataclass
class NLResult:
    query_id:   str
    agent_name: str | None = None
    model:      str | None = None
    start_time: str | None = None
    end_time:   str | None = None
    extracted:  dict       = field(default_factory=dict)  # for debug/UI


# ── intent rules ──────────────────────────────────────────────────────────────
# Ordered — first match wins. Multi-word phrases checked before bare words.

_INTENT_RULES: list[tuple[list[str], str]] = [
    # Trace logs / history — "logs", "show traces", "recent runs"
    (["logs", "log for", "show traces", "recent traces", "trace history",
      "run history", "recent runs", "show runs", "list traces",
      "trace list", "what ran", "what did", "show me runs",
      "traces today", "traces last", "traces this", "traces for",
      "show me traces", "traces in"], "top_slow_traces"),

    # Slow / bottleneck traces — multi-word first
    (["slowest trace", "longest trace", "most time", "taking long",
      "slowest run", "top slow", "worst trace", "high latency trace",
      "traces timing out", "bottleneck", "performance issue",
      "which run is slow", "slowest agent"], "top_slow_traces"),

    # Tool errors — specific tool phrases before bare "failing"
    (["tool error", "tool fail", "tool failure", "tool failing",
      "failing tool", "tools failing", "tools are fail",
      "broken tool", "tool issue", "which tool",
      "tool problem", "tool health", "tool reliability",
      "flaky tool", "unreliable tool",
      "errors per tool", "errors by tool",
      "errors of", "errors for", "errors from",
      "what errors", "show errors", "list errors",
      "what is broken", "what's broken", "whats broken",
      "errors", "failing"], "tool_error_rate"),

    # Overall success / failure / reliability of traces
    (["error rate", "fail rate", "failure rate", "success rate",
      "pass rate", "how often fail", "reliability",
      "how many fail", "how many succeed", "pass fail",
      "success vs fail", "completion rate", "health check",
      "overall health", "what is my error"], "avg_steps_by_outcome"),

    # Cost / spend
    (["cost", "price", "spend", "expensive", "cheapest", "billing",
      "how much", "dollar", "usd", "money", "budget", "roi",
      "cost breakdown", "cost analysis", "cost per call",
      "where is my money", "what is costing", "cost efficiency",
      "most expensive", "cheapest model"], "cost_per_run_by_model"),

    # Tokens / context window
    (["token", "context window", "prompt size", "usage by agent",
      "consuming", "input token", "output token",
      "token breakdown", "token consumption", "who uses most token",
      "token cost", "prompt token", "completion token",
      "bandwidth", "context usage"], "token_usage_by_agent"),

    # Model performance / speed — must come before model distribution
    # so "how is gpt-4o performing" doesn't hit the distribution group first
    (["performing", "model performance", "performance by model",
      "how is model", "how is my model", "how fast is",
      "model speed", "model latency"], "avg_llm_latency_by_model"),

    # LLM call latency / speed — p-values, inference time
    (["latency", "response time", "p95", "p50", "p99",
      "how fast", "slow call", "duration by model",
      "speed", "lag", "time per call", "ms", "millisecond",
      "inference time", "which model is fastest", "which model is slowest",
      "fastest model", "slowest model",
      "time to respond", "response speed"], "avg_llm_latency_by_model"),

    # Model breakdown / distribution
    (["model usage", "which model", "model breakdown", "model share",
      "model distribution", "model comparison", "model mix",
      "model popularity", "most used model", "model split",
      "model stats", "what models am i", "gpt vs", "claude vs",
      "compare model"], "model_usage_distribution"),

    # Steps / trace outcomes
    (["step", "outcome", "result", "avg step", "how many step",
      "steps per trace", "completion", "trace result",
      "what happened", "step count", "how deep",
      "how many steps", "average steps"], "avg_steps_by_outcome"),

    # Volume / throughput / activity
    (["volume", "throughput", "traffic", "over time",
      "per hour", "per day", "how many trace", "count",
      "how many", "how busy", "runs per hour", "agent activity",
      "requests", "usage", "daily report", "weekly summary",
      "trace count", "activity over", "trend"], "trace_volume"),

    # Model names alone → model distribution
    (["gpt", "claude", "gemini", "llama", "mistral",
      "distribution"], "model_usage_distribution"),

    # Bare "slow" — must be last so multi-word phrases above match first
    (["slow"], "top_slow_traces"),
]

SUPPORTED_EXAMPLES = [
    "slowest traces",
    "tool error rate",
    "error rate by outcome",
    "cost by model",
    "token usage by agent",
    "LLM latency p95",
    "model distribution",
    "avg steps per outcome",
    "trace volume over time",
]

# ── time window extraction ────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)

def _fmt(dt: datetime) -> str:
    return dt.isoformat()

def _window(start: datetime, end: datetime | None = None) -> tuple[str, str]:
    return _fmt(start), _fmt(end or _now())

_TIME_RULES: list[tuple[re.Pattern, any]] = [
    # "last N hours / days / weeks"
    (re.compile(r'last\s+(\d+)\s+hour', re.I),
     lambda m: _window(_now() - timedelta(hours=int(m.group(1))))),
    (re.compile(r'last\s+(\d+)\s+day', re.I),
     lambda m: _window(_now() - timedelta(days=int(m.group(1))))),
    (re.compile(r'last\s+(\d+)\s+week', re.I),
     lambda m: _window(_now() - timedelta(weeks=int(m.group(1))))),
    # "past N hours / days"
    (re.compile(r'past\s+(\d+)\s+hour', re.I),
     lambda m: _window(_now() - timedelta(hours=int(m.group(1))))),
    (re.compile(r'past\s+(\d+)\s+day', re.I),
     lambda m: _window(_now() - timedelta(days=int(m.group(1))))),
    # shorthands: "24h", "48h", "1h", "7d", "30d"
    (re.compile(r'\b(\d+)\s*h\b', re.I),
     lambda m: _window(_now() - timedelta(hours=int(m.group(1))))),
    (re.compile(r'\b(\d+)\s*d\b', re.I),
     lambda m: _window(_now() - timedelta(days=int(m.group(1))))),
    # named windows
    (re.compile(r'\blast\s+hour\b', re.I),
     lambda _: _window(_now() - timedelta(hours=1))),
    (re.compile(r'\btoday\b', re.I),
     lambda _: _window(_now().replace(hour=0, minute=0, second=0, microsecond=0))),
    (re.compile(r'\byesterday\b', re.I),
     lambda _: _window(
         (_now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)),
         _now().replace(hour=0, minute=0, second=0, microsecond=0),
     )),
    (re.compile(r'\bthis\s+week\b', re.I),
     lambda _: _window(_now() - timedelta(days=7))),
    (re.compile(r'\blast\s+week\b', re.I),
     lambda _: _window(
         _now() - timedelta(days=14),
         _now() - timedelta(days=7),
     )),
    (re.compile(r'\bthis\s+month\b', re.I),
     lambda _: _window(_now() - timedelta(days=30))),
]

# ── model name extraction ─────────────────────────────────────────────────────
# Sorted longest-first so "gpt-4-turbo" matches before "gpt-4"

_KNOWN_MODELS: list[str] = sorted([
    "gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo", "gpt-3.5",
    "claude-3-5-sonnet", "claude-3-5-haiku",
    "claude-3-opus", "claude-3-sonnet", "claude-3-haiku",
    "claude-opus", "claude-sonnet", "claude-haiku",
    "gemini-1.5-pro", "gemini-1.5-flash", "gemini-pro", "gemini-flash",
    "llama-3.1", "llama-3", "llama-2",
    "mistral-large", "mistral-small", "mistral-7b",
    "o1-mini", "o1-preview", "o1",
], key=len, reverse=True)

# ── agent name extraction ─────────────────────────────────────────────────────
# Stop-words that look like agent names but aren't

_AGENT_STOP = {
    "the", "a", "an", "my", "our", "for", "by", "in", "on", "at", "from",
    "all", "any", "each", "per", "with", "show", "get", "give", "list",
    "trace", "traces", "query", "metric", "model", "tool", "agent",
    "last", "this", "that", "today", "yesterday", "hour", "day", "week",
    "make", "made", "did", "do", "have", "had", "has", "use", "used",
    "what", "which", "how", "when", "where", "who", "why",
}

_AGENT_PATTERNS: list[re.Pattern] = [
    # Explicit "-agent" or "_agent" suffix — highest confidence: "code-agent", "research_agent"
    re.compile(r'\b([a-z][a-z0-9]*(?:[-_]agent))\b', re.I),
    # "X agent" (name before the word agent) — before "agent X" to avoid grabbing the wrong word
    re.compile(r'\b([a-z][a-z0-9_\-]{1,})\s+agent\b', re.I),
    # "from the X agent"
    re.compile(r'\bfrom\s+(?:the\s+)?([a-z][a-z0-9_\-]{1,})\s+agent\b', re.I),
    # Preposition + optional "agent" keyword: "for code", "for agent research"
    re.compile(r'\bfor\s+(?:agent\s+)?([a-z][a-z0-9_\-]{1,})\b', re.I),
    # "agent: name" or "agent name" — last, only if nothing above matched
    re.compile(r'\bagent[:\s]+([a-z][a-z0-9_\-]{1,})\b', re.I),
    # "X logs", "X traces", "X runs" — bare name before a log/trace noun
    re.compile(r'\b([a-z][a-z0-9_\-]{1,})\s+(?:logs?|traces?|runs?|activity)\b', re.I),
]

# ── public API ────────────────────────────────────────────────────────────────

def resolve(query: str) -> NLResult | None:
    """
    Parse a natural-language query into a structured NLResult.
    Returns None if no intent could be matched.
    """
    lower = query.lower()
    extracted: dict = {}

    # 1. Intent
    query_id: str | None = None
    for keywords, qid in _INTENT_RULES:
        if any(re.search(re.escape(kw), lower) for kw in keywords):
            query_id = qid
            break
    if query_id is None:
        return None

    result = NLResult(query_id=query_id)

    # 2. Time window (first match)
    for pattern, extractor in _TIME_RULES:
        m = pattern.search(query)
        if m:
            result.start_time, result.end_time = extractor(m)
            extracted["time"] = query[m.start():m.end()]
            break

    # 3. Model (longest match first)
    for model in _KNOWN_MODELS:
        if model.lower() in lower:
            result.model = model
            extracted["model"] = model
            break

    # 4. Agent name
    for pattern in _AGENT_PATTERNS:
        m = pattern.search(query)
        if m:
            candidate = m.group(1).lower()
            if candidate not in _AGENT_STOP and candidate not in (result.model or "").lower():
                result.agent_name = m.group(1)
                extracted["agent"] = result.agent_name
                break

    result.extracted = extracted
    return result

import re

# Ordered rules: first match wins. Patterns are case-insensitive substrings.
_RULES: list[tuple[list[str], str]] = [
    (["slow", "slowest", "longest"],                  "top_slow_traces"),
    (["tool error", "tool fail", "tool failure"],      "tool_error_rate"),
    (["error rate", "fail rate", "errors by tool"],    "tool_error_rate"),
    (["cost", "price", "spend", "expensive"],          "cost_per_run_by_model"),
    (["token", "tokens", "usage by agent"],            "token_usage_by_agent"),
    (["latency", "p95", "p50", "speed", "fast", "slow call"], "avg_llm_latency_by_model"),
    (["model", "gpt", "claude", "gemini", "distribution"], "model_usage_distribution"),
    (["step", "outcome", "success rate", "result"],   "avg_steps_by_outcome"),
    (["volume", "count", "how many", "traces per"],   "trace_volume"),
]


def resolve(query: str) -> str:
    """Return the best-matching query_id for a natural-language query string."""
    lower = query.lower()
    for keywords, query_id in _RULES:
        if any(re.search(re.escape(kw), lower) for kw in keywords):
            return query_id
    return "trace_volume"  # safe default

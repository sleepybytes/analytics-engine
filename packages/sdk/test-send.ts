/**
 * Step 2 smoke test — sends events through the SDK to the running API.
 * Run: npx tsx packages/sdk/test-send.ts
 * Verify: docker exec ae-api-1 bash -c "cp /data/analytics.duckdb /tmp/v.duckdb && python3 -c \"import duckdb; c=duckdb.connect('/tmp/v.duckdb'); print(c.execute('SELECT event_type, count(*) n FROM events GROUP BY event_type').fetchdf())\""
 */

import { initAgentAnalytics } from './src/index';

async function main() {
const analytics = initAgentAnalytics({
  apiKey: 'dev_project_key',
  host: 'http://localhost:8080',
  flushAt: 50,
  flushIntervalMs: 5_000,
  debug: true,
});

// --- Trace 1: research agent (success path) ---
const t1 = analytics.startTrace({
  agentName: 'research-agent',
  userId: 'user-sdk-01',
  tags: ['sdk-test', 'step2'],
  input: 'What is the latest news on LLMs?',
});

t1.captureToolCall({ toolName: 'web_search', latencyMs: 340, status: 'success', inputSummary: 'LLM news 2026' });
t1.captureLLMCall({ model: 'gpt-4o', provider: 'openai', latencyMs: 1120, inputTokens: 800, outputTokens: 320, costUsd: 0.0052 });
t1.captureStep({ stepType: 'research', durationMs: 1500 });

t1.captureToolCall({ toolName: 'web_search', latencyMs: 290, status: 'success' });
t1.captureLLMCall({ model: 'gpt-4o', provider: 'openai', latencyMs: 980, inputTokens: 1200, outputTokens: 450, costUsd: 0.0078 });
t1.captureStep({ stepType: 'synthesis', durationMs: 1300 });

t1.end({ status: 'success', output: 'Research complete' });

// --- Trace 2: code agent with error + retry ---
const t2 = analytics.startTrace({
  agentName: 'code-agent',
  userId: 'user-sdk-02',
  tags: ['sdk-test'],
});

t2.captureLLMCall({ model: 'claude-sonnet-4-6', provider: 'anthropic', latencyMs: 670, inputTokens: 500, outputTokens: 200, costUsd: 0.0045 });
t2.captureToolCall({ toolName: 'code_exec', latencyMs: 120, status: 'error', errorType: 'syntax_error' });
t2.captureError({ errorType: 'tool_failure', message: 'SyntaxError in generated code', recoverable: true });
t2.captureRetry({ reason: 'tool_failure', attemptNumber: 1 });
t2.captureToolCall({ toolName: 'code_exec', latencyMs: 95, status: 'success' });
t2.captureStep({ stepType: 'execution', durationMs: 900 });

t2.captureLLMCall({ model: 'claude-sonnet-4-6', provider: 'anthropic', latencyMs: 540, inputTokens: 300, outputTokens: 180, costUsd: 0.0031 });
t2.captureStep({ stepType: 'review', durationMs: 600 });

t2.end({ status: 'success', output: 'Code reviewed and fixed' });

// --- Trace 3: QA agent ---
const t3 = analytics.startTrace({ agentName: 'qa-agent', userId: 'user-sdk-03' });
t3.captureToolCall({ toolName: 'retrieval', latencyMs: 180, status: 'success' });
t3.captureLLMCall({ model: 'gpt-4o-mini', provider: 'openai', latencyMs: 420, inputTokens: 600, outputTokens: 120, costUsd: 0.0004 });
t3.captureStep({ stepType: 'answer', durationMs: 620 });
t3.end({ status: 'success', output: 'Answer generated' });

  await analytics.shutdown();

  console.log('\n✓ All events sent.');
}

main().catch(console.error);

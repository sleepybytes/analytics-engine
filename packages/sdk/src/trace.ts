import { randomUUID } from 'crypto';
import type { AgentEvent } from './types';

export interface TraceStartOpts {
  agentName:  string;
  runId?:     string;
  userId?:    string;
  sessionId?: string;
  input?:     string;
  tags?:      string[];
  metadata?:  Record<string, unknown>;
}

export interface LLMCallOpts {
  model:        string;
  provider?:    string;
  latencyMs:    number;
  inputTokens:  number;
  outputTokens: number;
  costUsd?:     number;
  status?:      'success' | 'error' | 'timeout';
  errorType?:   string;
  temperature?: number;
  cached?:      boolean;
}

export interface ToolCallOpts {
  toolName:     string;
  latencyMs:    number;
  status:       'success' | 'failed' | 'error' | 'timeout';
  errorType?:   string;
  retryCount?:  number;
  query?:       string;
}

export interface ErrorOpts {
  errorType:   string;
  message:     string;
  recoverable?: boolean;
}

export interface RetryOpts {
  reason:        string;
  attemptNumber: number;
}

export interface StepOpts {
  stepType:   string;
  durationMs: number;
  status?:    'success' | 'failed' | 'error';
}

export interface TraceEndOpts {
  status:  'success' | 'failed' | 'error' | 'timeout' | 'cancelled';
  output?: string;
}

export class TraceHandle {
  readonly traceId: string;
  private readonly runId: string | undefined;

  private readonly startMs: number;
  private stepIndex        = 0;
  private totalSteps       = 0;
  private totalLLMCalls    = 0;
  private totalToolCalls   = 0;
  private totalInputTokens = 0;
  private totalOutputTokens= 0;
  private totalCostUsd     = 0;

  constructor(
    private readonly enqueue: (event: AgentEvent) => void,
    private readonly agentName: string,
    opts: TraceStartOpts,
  ) {
    this.traceId = randomUUID();
    this.runId   = opts.runId;
    this.startMs = Date.now();

    enqueue({
      eventId:   randomUUID(),
      traceId:   this.traceId,
      runId:     opts.runId,
      timestamp: new Date().toISOString(),
      eventType: 'trace_started',
      agentName,
      userId:    opts.userId,
      status:    'running',
      metadata: {
        input:   opts.input,
        tags:    opts.tags,
        ...opts.metadata,
      },
    });
  }

  captureLLMCall(opts: LLMCallOpts): void {
    this.totalLLMCalls++;
    this.totalInputTokens  += opts.inputTokens;
    this.totalOutputTokens += opts.outputTokens;
    if (opts.costUsd != null) this.totalCostUsd += opts.costUsd;

    this.enqueue({
      eventId:      randomUUID(),
      traceId:      this.traceId,
      runId:        this.runId,
      timestamp:    new Date().toISOString(),
      eventType:    'llm_call',
      agentName:    this.agentName,
      stepIndex:    this.stepIndex,
      model:        opts.model,
      latencyMs:    opts.latencyMs,
      inputTokens:  opts.inputTokens,
      outputTokens: opts.outputTokens,
      costUsd:      opts.costUsd,
      status:       opts.status ?? 'success',
      errorType:    opts.errorType,
      metadata: {
        provider:    opts.provider,
        temperature: opts.temperature,
        cached:      opts.cached,
      },
    });
  }

  captureToolCall(opts: ToolCallOpts): void {
    this.totalToolCalls++;

    this.enqueue({
      eventId:   randomUUID(),
      traceId:   this.traceId,
      runId:     this.runId,
      timestamp: new Date().toISOString(),
      eventType: 'tool_call',
      agentName: this.agentName,
      stepIndex: this.stepIndex,
      toolName:  opts.toolName,
      latencyMs: opts.latencyMs,
      status:    opts.status,
      errorType: opts.errorType,
      metadata: {
        query:      opts.query,
        retryCount: opts.retryCount,
      },
    });
  }

  captureError(opts: ErrorOpts): void {
    this.enqueue({
      eventId:   randomUUID(),
      traceId:   this.traceId,
      runId:     this.runId,
      timestamp: new Date().toISOString(),
      eventType: 'error',
      agentName: this.agentName,
      stepIndex: this.stepIndex,
      errorType: opts.errorType,
      status:    'failed',
      metadata: {
        message:     opts.message,
        recoverable: opts.recoverable ?? false,
      },
    });
  }

  captureRetry(opts: RetryOpts): void {
    this.enqueue({
      eventId:   randomUUID(),
      traceId:   this.traceId,
      runId:     this.runId,
      timestamp: new Date().toISOString(),
      eventType: 'retry',
      agentName: this.agentName,
      stepIndex: this.stepIndex,
      metadata: {
        reason:  opts.reason,
        attempt: opts.attemptNumber,
      },
    });
  }

  captureStep(opts: StepOpts): void {
    this.enqueue({
      eventId:   randomUUID(),
      traceId:   this.traceId,
      runId:     this.runId,
      timestamp: new Date().toISOString(),
      eventType: 'step_completed',
      agentName: this.agentName,
      stepIndex: this.stepIndex,
      latencyMs: opts.durationMs,
      status:    opts.status ?? 'success',
      metadata:  { step_type: opts.stepType },
    });
    this.stepIndex++;
    this.totalSteps++;
  }

  end(opts: TraceEndOpts): void {
    this.enqueue({
      eventId:   randomUUID(),
      traceId:   this.traceId,
      runId:     this.runId,
      timestamp: new Date().toISOString(),
      eventType: 'trace_completed',
      agentName: this.agentName,
      stepIndex: this.stepIndex,
      status:    opts.status,
      costUsd:   this.totalCostUsd || undefined,
      latencyMs: Date.now() - this.startMs,
      metadata: {
        output:               opts.output,
        total_steps:          this.totalSteps,
        total_llm_calls:      this.totalLLMCalls,
        total_tool_calls:     this.totalToolCalls,
        total_input_tokens:   this.totalInputTokens,
        total_output_tokens:  this.totalOutputTokens,
      },
    });
  }
}

import { randomUUID } from 'crypto'
import { ModelConfig, pickModel } from './models'

// Inline event types — mirrors the API's camelCase flat schema exactly
export interface AgentEvent {
  eventId:      string
  traceId:      string
  timestamp:    string
  eventType:    string
  runId?:       string
  agentName?:   string
  userId?:      string
  stepIndex?:   number
  status?:      string
  model?:       string
  latencyMs?:   number
  inputTokens?: number
  outputTokens?:number
  costUsd?:     number
  toolName?:    string
  errorType?:   string
  metadata?:    Record<string, unknown>
}

export interface TraceContext {
  traceId:      string
  agentName:    string
  userId:       string
  startTime:    Date
  currentTime:  Date
  stepIndex:    number
  llmCalls:     number
  toolCalls:    number
  inputTokens:  number
  outputTokens: number
  costUsd:      number
  events:       AgentEvent[]
  failed:       boolean
}

// ── random helpers ────────────────────────────────────────────────────────────

export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function randItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function chance(p: number): boolean {
  return Math.random() < p
}

// Random timestamp in last N days (seconds precision)
export function randomPastDate(withinDays = 30): Date {
  const nowMs     = Date.now()
  const windowMs  = withinDays * 24 * 3_600_000
  return new Date(nowMs - Math.random() * windowMs)
}

// ── trace builder ─────────────────────────────────────────────────────────────

export function startTrace(agentName: string, input: string): TraceContext {
  const startTime   = randomPastDate(30)
  const ctx: TraceContext = {
    traceId:      randomUUID(),
    agentName,
    userId:       `user_${randInt(1, 200)}`,
    startTime,
    currentTime:  new Date(startTime),
    stepIndex:    0,
    llmCalls:     0,
    toolCalls:    0,
    inputTokens:  0,
    outputTokens: 0,
    costUsd:      0,
    events:       [],
    failed:       false,
  }

  ctx.events.push({
    eventId:   randomUUID(),
    traceId:   ctx.traceId,
    timestamp: ctx.currentTime.toISOString(),
    eventType: 'trace_started',
    agentName,
    userId:    ctx.userId,
    status:    'running',
    metadata:  { input },
  })

  return ctx
}

export function addLLMCall(ctx: TraceContext, overrides: Partial<AgentEvent> = {}): ModelConfig {
  const model      = pickModel()
  const inputTok   = randInt(model.inputTokenRange[0],  model.inputTokenRange[1])
  const outputTok  = randInt(model.outputTokenRange[0], model.outputTokenRange[1])
  const latencyMs  = randInt(model.latencyRange[0],     model.latencyRange[1])
  const costUsd    = (inputTok * model.inputCostPer1M + outputTok * model.outputCostPer1M) / 1_000_000
  const hasError   = chance(0.03)  // 3% LLM error rate

  ctx.currentTime = new Date(ctx.currentTime.getTime() + latencyMs)
  ctx.llmCalls++
  ctx.inputTokens  += inputTok
  ctx.outputTokens += outputTok
  if (!hasError) ctx.costUsd += costUsd

  ctx.events.push({
    eventId:      randomUUID(),
    traceId:      ctx.traceId,
    timestamp:    ctx.currentTime.toISOString(),
    eventType:    'llm_call',
    agentName:    ctx.agentName,
    stepIndex:    ctx.stepIndex,
    model:        model.name,
    latencyMs,
    inputTokens:  inputTok,
    outputTokens: outputTok,
    costUsd:      hasError ? undefined : costUsd,
    status:       hasError ? 'error' : 'success',
    errorType:    hasError ? 'rate_limit' : undefined,
    metadata:     { provider: model.provider, temperature: 0.7 },
    ...overrides,
  })

  if (hasError) ctx.failed = true
  return model
}

export function addToolCall(
  ctx: TraceContext,
  toolName: string,
  query?: string,
): void {
  const latencyMs  = randInt(100, 2000)
  const hasError   = chance(0.08)  // 8% tool failure rate
  const needsRetry = hasError && chance(0.15)

  ctx.currentTime = new Date(ctx.currentTime.getTime() + latencyMs)
  ctx.toolCalls++

  ctx.events.push({
    eventId:   randomUUID(),
    traceId:   ctx.traceId,
    timestamp: ctx.currentTime.toISOString(),
    eventType: 'tool_call',
    agentName: ctx.agentName,
    stepIndex: ctx.stepIndex,
    toolName,
    latencyMs,
    status:    hasError ? 'error' : 'success',
    errorType: hasError ? 'tool_timeout' : undefined,
    metadata:  { query, retryCount: 0 },
  })

  if (hasError) {
    ctx.failed = true
    ctx.events.push({
      eventId:   randomUUID(),
      traceId:   ctx.traceId,
      timestamp: ctx.currentTime.toISOString(),
      eventType: 'error',
      agentName: ctx.agentName,
      stepIndex: ctx.stepIndex,
      errorType: 'tool_failure',
      status:    'failed',
      metadata:  { message: `${toolName} failed: connection timeout`, recoverable: true },
    })

    if (needsRetry) {
      ctx.currentTime = new Date(ctx.currentTime.getTime() + 1000)
      ctx.events.push({
        eventId:   randomUUID(),
        traceId:   ctx.traceId,
        timestamp: ctx.currentTime.toISOString(),
        eventType: 'retry',
        agentName: ctx.agentName,
        stepIndex: ctx.stepIndex,
        metadata:  { reason: `${toolName} error`, attempt: 2 },
      })
      // Retry succeeds
      ctx.currentTime = new Date(ctx.currentTime.getTime() + latencyMs)
      ctx.events.push({
        eventId:   randomUUID(),
        traceId:   ctx.traceId,
        timestamp: ctx.currentTime.toISOString(),
        eventType: 'tool_call',
        agentName: ctx.agentName,
        stepIndex: ctx.stepIndex,
        toolName,
        latencyMs,
        status:    'success',
        metadata:  { query, retryCount: 1 },
      })
      ctx.failed = false
    }
  }
}

export function endStep(ctx: TraceContext, stepType: string): void {
  const stepStart   = ctx.startTime
  const durationMs  = ctx.currentTime.getTime() - stepStart.getTime()

  ctx.events.push({
    eventId:   randomUUID(),
    traceId:   ctx.traceId,
    timestamp: ctx.currentTime.toISOString(),
    eventType: 'step_completed',
    agentName: ctx.agentName,
    stepIndex: ctx.stepIndex,
    latencyMs: Math.max(100, durationMs),
    status:    ctx.failed ? 'error' : 'success',
    metadata:  { step_type: stepType },
  })
  ctx.stepIndex++
}

export function endTrace(ctx: TraceContext, output?: string): AgentEvent[] {
  const durationMs = ctx.currentTime.getTime() - ctx.startTime.getTime()
  const status     = ctx.failed ? 'error' : 'success'

  ctx.events.push({
    eventId:   randomUUID(),
    traceId:   ctx.traceId,
    timestamp: ctx.currentTime.toISOString(),
    eventType: 'trace_completed',
    agentName: ctx.agentName,
    userId:    ctx.userId,
    status,
    latencyMs: durationMs,
    costUsd:   ctx.costUsd > 0 ? ctx.costUsd : undefined,
    metadata:  {
      output,
      total_steps:          ctx.stepIndex,
      total_llm_calls:      ctx.llmCalls,
      total_tool_calls:     ctx.toolCalls,
      total_input_tokens:   ctx.inputTokens,
      total_output_tokens:  ctx.outputTokens,
    },
  })

  return ctx.events
}

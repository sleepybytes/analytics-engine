// Flat camelCase event format — matches the API payload schema exactly.
// All non-base fields are optional (null for non-applicable events).

export type EventType =
  | 'trace_started'
  | 'trace_completed'
  | 'llm_call'
  | 'tool_call'
  | 'step_completed'
  | 'error'
  | 'retry';

export type EventStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'error'
  | 'timeout'
  | 'cancelled';

export interface AgentEvent {
  // required base
  eventId:   string;
  traceId:   string;
  timestamp: string;
  eventType: EventType;

  // identity / grouping
  runId?:     string;
  agentName?: string;
  userId?:    string;

  // shared
  stepIndex?: number;
  status?:    EventStatus | string;

  // LLM / tokens
  model?:        string;
  latencyMs?:    number;
  inputTokens?:  number;
  outputTokens?: number;
  costUsd?:      number;

  // tool / error
  toolName?:  string;
  errorType?: string;

  // generic bag — input, output, message, tags, attempt, etc. go here
  metadata?: Record<string, unknown>;
}

export interface CapturePayload {
  api_key: string;
  batch:   AgentEvent[];
  sent_at: string;
}

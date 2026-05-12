// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API_KEY: string = (import.meta as any).env?.VITE_API_KEY ?? 'dev_project_key'

export interface Filters {
  start_time?: string
  end_time?: string
  agent_name?: string
  model?: string
  status?: string
}

export interface KpiData {
  total_traces: number
  success_count: number
  error_count: number
  avg_duration_ms: number | null
  p95_duration_ms: number | null
  total_cost_usd: number | null
  total_input_tokens: number | null
  total_output_tokens: number | null
}

export interface QueryResult {
  query_id: string
  chart_type: 'line' | 'bar' | 'table'
  description: string
  start_time: string
  end_time: string
  row_count: number
  data: Record<string, unknown>[]
  nl_query?: string
}

export interface TraceItem {
  trace_id: string
  agent_name: string
  run_id: string | null
  status: string | null
  duration_ms: number | null
  total_steps: number
  total_llm_calls: number
  total_tool_calls: number
  cost_usd: number | null
  input_text: string | null
  output_text: string | null
  started_at: string
}

export interface TraceList {
  total: number
  limit: number
  offset: number
  traces: TraceItem[]
}

export interface TraceEvent {
  event_id: string
  event_type: string
  timestamp: string
  agent_name: string | null
  step_index: number | null
  status: string | null
  model: string | null
  latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  cost_usd: number | null
  tool_name: string | null
  error_type: string | null
  error_message: string | null
  step_status: string | null
  trace_status: string | null
  trace_duration_ms: number | null
  total_cost_usd: number | null
  total_steps: number | null
  total_llm_calls: number | null
  total_tool_calls: number | null
}

export interface TraceDetail {
  trace_id: string
  summary: TraceEvent | null
  events: TraceEvent[]
  event_count: number
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams({ api_key: API_KEY })
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') p.set(k, v)
  }
  return p.toString()
}

async function get<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const res = await fetch(`${path}?${qs(params)}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export function subHours(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString()
}

export function subDays(d: number): string {
  return subHours(d * 24)
}

export const api = {
  kpi: (f: Filters) =>
    get<KpiData>('/api/analytics/kpi', {
      start_time: f.start_time,
      end_time: f.end_time,
    }),

  query: (id: string, f: Filters) =>
    get<QueryResult>(`/api/analytics/${id}`, {
      start_time: f.start_time,
      end_time: f.end_time,
      agent_name: f.agent_name,
      model: f.model,
    }),

  nl: (q: string, f: Filters) =>
    get<QueryResult>('/api/analytics/nl', {
      q,
      start_time: f.start_time,
      end_time: f.end_time,
      agent_name: f.agent_name,
      model: f.model,
    }),

  traces: (f: Filters, limit = 50, offset = 0) =>
    get<TraceList>('/api/traces', {
      start_time: f.start_time,
      end_time: f.end_time,
      agent_name: f.agent_name,
      status: f.status,
      limit: String(limit),
      offset: String(offset),
    }),

  trace: (id: string) =>
    get<TraceDetail>(`/api/traces/${id}`),
}

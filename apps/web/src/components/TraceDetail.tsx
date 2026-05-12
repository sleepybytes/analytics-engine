import { TraceEvent } from '../lib/api'
import { useTrace } from '../hooks/useAnalytics'

const STATUS_CLASS: Record<string, string> = {
  success:   'bg-green-100 text-green-700',
  error:     'bg-red-100 text-red-700',
  failed:    'bg-red-100 text-red-700',
  timeout:   'bg-amber-100 text-amber-700',
  cancelled: 'bg-gray-100 text-gray-500',
  running:   'bg-blue-100 text-blue-700',
}

const STEP_TYPE_LABEL: Record<string, string> = {
  search:           'Search',
  analysis:         'Analysis',
  synthesis:        'Synthesis',
  planning:         'Planning',
  implementation:   'Implementation',
  testing:          'Testing',
  review:           'Review',
  refinement:       'Refinement',
  retrieval:        'Retrieval',
  answer_generation:'Answer Generation',
}

interface Props {
  traceId: string
  onClose: () => void
}

// ── group events by step_index ────────────────────────────────────────────────

interface StepGroup {
  stepIndex:    number
  stepType:     string | null
  durationMs:   number | null
  status:       string | null
  llmCalls:     TraceEvent[]
  toolCalls:    TraceEvent[]
  errors:       TraceEvent[]
  retries:      TraceEvent[]
  completed:    TraceEvent | null
}

function groupByStep(events: TraceEvent[]): StepGroup[] {
  const map = new Map<number, StepGroup>()

  for (const ev of events) {
    const idx = ev.step_index ?? -1
    if (!map.has(idx)) {
      map.set(idx, {
        stepIndex: idx, stepType: null, durationMs: null, status: null,
        llmCalls: [], toolCalls: [], errors: [], retries: [], completed: null,
      })
    }
    const g = map.get(idx)!
    if (ev.event_type === 'llm_call')       g.llmCalls.push(ev)
    else if (ev.event_type === 'tool_call') g.toolCalls.push(ev)
    else if (ev.event_type === 'error')     g.errors.push(ev)
    else if (ev.event_type === 'retry')     g.retries.push(ev)
    else if (ev.event_type === 'step_completed') {
      g.completed  = ev
      g.durationMs = ev.latency_ms
      g.status     = ev.step_status ?? ev.status ?? null
      const raw    = ev.metadata?.step_type != null ? String(ev.metadata.step_type) : null
      g.stepType   = raw
    }
  }

  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, g]) => g)
}

// ── component ─────────────────────────────────────────────────────────────────

export default function TraceDetail({ traceId, onClose }: Props) {
  const { data, isLoading } = useTrace(traceId)

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />

      <div className="w-[560px] bg-white h-full shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <p className="text-xs text-gray-400 font-mono">{traceId}</p>
            {data?.summary && (
              <p className="text-sm font-semibold text-gray-800 mt-0.5">
                {data.summary.agent_name ?? 'unknown'}
                <span className={`ml-2 px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_CLASS[data.summary.trace_status ?? ''] ?? 'bg-gray-100 text-gray-500'}`}>
                  {data.summary.trace_status ?? '—'}
                </span>
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {isLoading && (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
        )}

        {data && (
          <>
            {/* Trace summary bar */}
            {data.summary && (
              <div className="grid grid-cols-4 gap-2 px-5 py-3 bg-gray-50 border-b">
                <Stat label="Total duration" value={fmt.ms(data.summary.trace_duration_ms)} />
                <Stat label="Steps"          value={data.summary.total_steps ?? '—'} />
                <Stat label="LLM calls"      value={data.summary.total_llm_calls ?? '—'} />
                <Stat label="Total cost"     value={fmt.usd(data.summary.total_cost_usd)} />
              </div>
            )}

            {/* Step-grouped timeline */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {groupByStep(data.events).map(g => (
                <StepCard key={g.stepIndex} group={g} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── StepCard ─────────────────────────────────────────────────────────────────

function StepCard({ group: g }: { group: StepGroup }) {
  const isUnstep = g.stepIndex === -1
  const label    = isUnstep
    ? 'Setup events'
    : `Step ${g.stepIndex + 1}${g.stepType ? ' — ' + (STEP_TYPE_LABEL[g.stepType] ?? g.stepType) : ''}`

  const statusCls = g.status ? (STATUS_CLASS[g.status] ?? 'bg-gray-100 text-gray-500') : ''

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      {/* Step header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{label}</span>
        <div className="flex items-center gap-2">
          {g.durationMs != null && (
            <span className="text-xs text-gray-400">{fmt.ms(g.durationMs)}</span>
          )}
          {g.status && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${statusCls}`}>{g.status}</span>
          )}
        </div>
      </div>

      {/* Events inside this step */}
      <div className="divide-y divide-gray-50">
        {/* Tool calls */}
        {g.toolCalls.map(ev => <ToolRow key={ev.event_id} ev={ev} />)}

        {/* Errors & retries interleaved by timestamp */}
        {[...g.errors, ...g.retries]
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
          .map(ev => ev.event_type === 'error'
            ? <ErrorRow  key={ev.event_id} ev={ev} />
            : <RetryRow  key={ev.event_id} ev={ev} />)
        }

        {/* LLM calls */}
        {g.llmCalls.map(ev => <LLMRow key={ev.event_id} ev={ev} />)}
      </div>
    </div>
  )
}

// ── row types ─────────────────────────────────────────────────────────────────

function LLMRow({ ev }: { ev: TraceEvent }) {
  const status = ev.step_status ?? ev.status ?? 'success'
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 bg-purple-50/40">
      <span className="text-base mt-0.5 flex-shrink-0">🤖</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-purple-700">LLM call</span>
          {ev.model && <span className="text-xs font-mono text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">{ev.model}</span>}
          <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_CLASS[status] ?? 'bg-gray-100 text-gray-500'}`}>{status}</span>
        </div>
        <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-3">
          {ev.latency_ms  != null && <span>⏱ {ev.latency_ms.toLocaleString()} ms</span>}
          {ev.input_tokens  != null && <span>↓ {ev.input_tokens.toLocaleString()} tokens in</span>}
          {ev.output_tokens != null && <span>↑ {ev.output_tokens.toLocaleString()} tokens out</span>}
          {ev.cost_usd      != null && <span>💰 {fmt.usd(ev.cost_usd)}</span>}
        </div>
      </div>
      <span className="text-xs text-gray-300 flex-shrink-0 mt-0.5">{ev.timestamp.slice(11, 19)}</span>
    </div>
  )
}

function ToolRow({ ev }: { ev: TraceEvent }) {
  const status = ev.step_status ?? ev.status ?? 'success'
  const isErr  = status !== 'success'
  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 ${isErr ? 'bg-red-50/40' : 'bg-amber-50/30'}`}>
      <span className="text-base mt-0.5 flex-shrink-0">🔧</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-amber-700">Tool call</span>
          {ev.tool_name && <span className="text-xs font-mono text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">{ev.tool_name}</span>}
          <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_CLASS[status] ?? 'bg-gray-100 text-gray-500'}`}>{status}</span>
        </div>
        <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-3">
          {ev.latency_ms != null && <span>⏱ {ev.latency_ms.toLocaleString()} ms</span>}
          {ev.error_type && <span className="text-red-500">{ev.error_type}</span>}
        </div>
      </div>
      <span className="text-xs text-gray-300 flex-shrink-0 mt-0.5">{ev.timestamp.slice(11, 19)}</span>
    </div>
  )
}

function ErrorRow({ ev }: { ev: TraceEvent }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2 bg-red-50/50 border-l-2 border-red-300">
      <span className="text-sm mt-0.5 flex-shrink-0 text-red-500">✗</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-red-600">Error</span>
          {ev.error_type && <span className="text-xs text-red-500 font-mono">{ev.error_type}</span>}
        </div>
        {ev.error_message && <p className="text-xs text-red-400 mt-0.5">{ev.error_message}</p>}
      </div>
      <span className="text-xs text-gray-300 flex-shrink-0 mt-0.5">{ev.timestamp.slice(11, 19)}</span>
    </div>
  )
}

function RetryRow({ ev }: { ev: TraceEvent }) {
  const meta   = ev.metadata
  const reason  = meta?.reason  != null ? String(meta.reason)  : null
  const attempt = meta?.attempt != null ? String(meta.attempt) : null
  return (
    <div className="flex items-start gap-3 px-3 py-2 bg-amber-50/50 border-l-2 border-amber-300">
      <span className="text-sm mt-0.5 flex-shrink-0 text-amber-500">↺</span>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-semibold text-amber-600">Retry</span>
        {reason  && <span className="text-xs text-amber-500 ml-2">— {reason}</span>}
        {attempt && <span className="text-xs text-gray-400 ml-2">attempt {attempt}</span>}
      </div>
      <span className="text-xs text-gray-300 flex-shrink-0 mt-0.5">{ev.timestamp.slice(11, 19)}</span>
    </div>
  )
}

// ── helpers ───────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-sm font-semibold text-gray-700">{String(value ?? '—')}</div>
    </div>
  )
}

const fmt = {
  ms:  (v: number | null | undefined) => v != null ? `${(v / 1000).toFixed(2)}s` : '—',
  usd: (v: number | null | undefined) => v != null ? `$${v.toFixed(4)}` : '—',
}

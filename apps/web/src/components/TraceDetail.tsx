import { TraceEvent } from '../lib/api'
import { useTrace } from '../hooks/useAnalytics'

const EVENT_ICON: Record<string, string> = {
  trace_started:   '▶',
  trace_completed: '■',
  llm_call:        '🤖',
  tool_call:       '🔧',
  step_completed:  '✓',
  error:           '✗',
  retry:           '↺',
}

const STATUS_CLASS: Record<string, string> = {
  success:   'bg-green-100 text-green-700',
  error:     'bg-red-100 text-red-700',
  failed:    'bg-red-100 text-red-700',
  timeout:   'bg-amber-100 text-amber-700',
  cancelled: 'bg-gray-100 text-gray-500',
  running:   'bg-blue-100 text-blue-700',
}

interface Props {
  traceId: string
  onClose: () => void
}

export default function TraceDetail({ traceId, onClose }: Props) {
  const { data, isLoading } = useTrace(traceId)

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* panel */}
      <div className="w-[520px] bg-white h-full shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <p className="text-xs text-gray-500 font-mono">{traceId}</p>
            {data?.summary && (
              <p className="text-sm font-medium text-gray-700 mt-0.5">
                {data.summary.agent_name ?? 'unknown'} ·{' '}
                <span className={`px-1.5 py-0.5 rounded text-xs ${STATUS_CLASS[data.summary.trace_status ?? ''] ?? 'bg-gray-100 text-gray-500'}`}>
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
            {/* summary row */}
            {data.summary && (
              <div className="grid grid-cols-4 gap-2 px-5 py-3 bg-gray-50 border-b text-xs text-gray-500">
                <Stat label="Duration" value={fmt.ms(data.summary.trace_duration_ms)} />
                <Stat label="Steps"    value={data.summary.total_steps ?? '—'} />
                <Stat label="LLM calls" value={data.summary.total_llm_calls ?? '—'} />
                <Stat label="Cost"     value={fmt.usd(data.summary.total_cost_usd)} />
              </div>
            )}

            {/* event list */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
              {data.events.map(ev => (
                <EventRow key={ev.event_id} ev={ev} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="text-gray-400 text-xs">{label}</div>
      <div className="text-gray-700 font-medium text-sm">{String(value ?? '—')}</div>
    </div>
  )
}

function EventRow({ ev }: { ev: TraceEvent }) {
  const icon   = EVENT_ICON[ev.event_type] ?? '•'
  const status = ev.step_status ?? ev.status ?? ''
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-base w-5 flex-shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700">{ev.event_type}</span>
          {ev.model    && <span className="text-xs text-gray-400">{ev.model}</span>}
          {ev.tool_name && <span className="text-xs text-gray-400">{ev.tool_name}</span>}
          {status && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_CLASS[status] ?? 'bg-gray-100 text-gray-500'}`}>
              {status}
            </span>
          )}
        </div>
        <div className="text-xs text-gray-400 mt-0.5 flex gap-3">
          {ev.latency_ms  != null && <span>{ev.latency_ms} ms</span>}
          {ev.input_tokens  != null && <span>in {ev.input_tokens} tok</span>}
          {ev.output_tokens != null && <span>out {ev.output_tokens} tok</span>}
          {ev.error_type   && <span className="text-red-500">{ev.error_type}</span>}
          {ev.error_message && <span className="text-red-500">{ev.error_message}</span>}
        </div>
      </div>
      <span className="text-xs text-gray-300 flex-shrink-0">{ev.timestamp.slice(11, 19)}</span>
    </div>
  )
}

const fmt = {
  ms:  (v: number | null | undefined) => v != null ? `${(v / 1000).toFixed(2)}s` : '—',
  usd: (v: number | null | undefined) => v != null ? `$${v.toFixed(4)}` : '—',
}

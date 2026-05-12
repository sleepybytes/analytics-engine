import { useState, useMemo } from 'react'
import FilterBar, { Range, rangeToTimes } from '../components/FilterBar'
import TraceDetail from '../components/TraceDetail'
import { useTraces, useAgents } from '../hooks/useAnalytics'
import { TraceItem } from '../lib/api'

const STATUS_CLASS: Record<string, string> = {
  success:   'bg-green-100 text-green-700',
  error:     'bg-red-100 text-red-700',
  failed:    'bg-red-100 text-red-700',
  timeout:   'bg-amber-100 text-amber-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

const PAGE_SIZE = 20

export default function TraceExplorer() {
  const [range, setRange]         = useState<Range>('7d')
  const [agentName, setAgentName] = useState('')
  const [status, setStatus]       = useState('')
  const [offset, setOffset]       = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filters = useMemo(
    () => ({ ...rangeToTimes(range), agent_name: agentName || undefined, status: status || undefined }),
    [range, agentName, status],
  )

  const { data, isLoading } = useTraces(filters, PAGE_SIZE, offset)
  const { data: agents }   = useAgents()

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0
  const page = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <h2 className="text-xl font-semibold text-gray-900">Traces</h2>
        <div className="flex flex-wrap gap-3">
          <FilterBar range={range} agentName={agentName} onRange={r => { setRange(r); setOffset(0) }} onAgent={a => { setAgentName(a); setOffset(0) }} />

          {/* Agent dropdown */}
          <select
            value={agentName}
            onChange={e => { setAgentName(e.target.value); setOffset(0) }}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All agents</option>
            {(agents ?? []).map(a => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
          </select>

          {/* Status dropdown */}
          <select
            value={status}
            onChange={e => { setStatus(e.target.value); setOffset(0) }}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="timeout">Timeout</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-3 font-medium">Agent</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-right px-4 py-3 font-medium">Duration</th>
              <th className="text-right px-4 py-3 font-medium">Steps</th>
              <th className="text-right px-4 py-3 font-medium">LLM</th>
              <th className="text-right px-4 py-3 font-medium">Cost</th>
              <th className="text-right px-4 py-3 font-medium">Started</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-400">Loading…</td>
              </tr>
            )}
            {!isLoading && !data?.traces.length && (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-400">No traces found</td>
              </tr>
            )}
            {data?.traces.map(t => (
              <TraceRow key={t.trace_id} trace={t} onClick={() => setSelectedId(t.trace_id)} />
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 text-sm text-gray-600">
            <span>{data.total} total</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setOffset(offset - PAGE_SIZE)}
                className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-100"
              >
                ← Prev
              </button>
              <span>Page {page} of {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-100"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedId && (
        <TraceDetail traceId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}

function TraceRow({ trace, onClick }: { trace: TraceItem; onClick: () => void }) {
  const status = trace.status ?? ''
  return (
    <tr
      onClick={onClick}
      className="hover:bg-blue-50 cursor-pointer transition-colors"
    >
      <td className="px-4 py-3 font-medium text-gray-800">{trace.agent_name}</td>
      <td className="px-4 py-3">
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASS[status] ?? 'bg-gray-100 text-gray-500'}`}>
          {status || '—'}
        </span>
      </td>
      <td className="px-4 py-3 text-right text-gray-600">{fmtMs(trace.duration_ms)}</td>
      <td className="px-4 py-3 text-right text-gray-600">{trace.total_steps}</td>
      <td className="px-4 py-3 text-right text-gray-600">{trace.total_llm_calls}</td>
      <td className="px-4 py-3 text-right text-gray-600">{fmtUsd(trace.cost_usd)}</td>
      <td className="px-4 py-3 text-right text-gray-400 text-xs">{relTime(trace.started_at)}</td>
    </tr>
  )
}

function fmtMs(ms: number | null) {
  if (ms == null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`
}

function fmtUsd(v: number | null) {
  return v != null ? `$${v.toFixed(4)}` : '—'
}

function relTime(ts: string) {
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

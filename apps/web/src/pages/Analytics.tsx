import { useState } from 'react'
import { api, QueryResult } from '../lib/api'
import BarChart from '../components/charts/BarChart'
import VolumeChart from '../components/charts/VolumeChart'

const EXAMPLES = [
  'Show me the slowest traces',
  'Cost by model',
  'Tool error rates',
  'Token usage by agent',
  'LLM latency p95',
  'Model distribution',
]

export default function Analytics() {
  const [query, setQuery]     = useState('')
  const [result, setResult]   = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function run(q: string) {
    if (!q.trim()) return
    setQuery(q)
    setLoading(true)
    setError(null)
    try {
      const r = await api.nl(q, {
        start_time: new Date(Date.now() - 7 * 86400_000).toISOString(),
        end_time:   new Date().toISOString(),
      })
      setResult(r)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Natural Language Query</h2>
        <p className="text-sm text-gray-500 mt-1">Ask anything about your agent traces in plain English.</p>
      </div>

      {/* Input */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run(query)}
            placeholder="e.g. Show me slow traces, cost by model…"
            className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => run(query)}
            disabled={loading || !query.trim()}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {loading ? '…' : 'Run'}
          </button>
        </div>

        {/* Example chips */}
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map(ex => (
            <button
              key={ex}
              onClick={() => run(ex)}
              className="px-3 py-1 text-xs bg-gray-100 text-gray-600 rounded-full hover:bg-blue-100 hover:text-blue-700 transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800">
                Query: <span className="text-blue-600">{result.nl_query}</span>
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Matched → <code className="font-mono">{result.query_id}</code> · {result.row_count} rows
              </p>
            </div>
            <span className="text-xs px-2 py-1 bg-gray-100 text-gray-500 rounded">{result.chart_type}</span>
          </div>

          {/* Chart */}
          {result.chart_type === 'line' && result.data.length > 0 && (
            <VolumeChart data={result.data} />
          )}
          {result.chart_type === 'bar' && result.data.length > 0 && (
            <BarChart
              data={result.data}
              xKey={guessXKey(result)}
              yKey={guessYKey(result)}
            />
          )}

          {/* Table — always shown */}
          {result.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-gray-600">
                <thead>
                  <tr className="border-b text-gray-400 uppercase">
                    {Object.keys(result.data[0]).map(k => (
                      <th key={k} className="text-left py-2 pr-4 font-medium">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {result.data.map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((v, j) => (
                        <td key={j} className="py-2 pr-4">{String(v ?? '—')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.data.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">No data found</p>
          )}
        </div>
      )}
    </div>
  )
}

function guessXKey(r: QueryResult): string {
  const cols = Object.keys(r.data[0] ?? {})
  return cols.find(c => ['model', 'tool_name', 'agent_name', 'trace_status', 'hour'].includes(c)) ?? cols[0]
}

function guessYKey(r: QueryResult): string {
  const cols = Object.keys(r.data[0] ?? {})
  return cols.find(c => ['call_count', 'trace_count', 'total_calls', 'total_tokens', 'total_cost_usd', 'error_rate_pct', 'avg_steps'].includes(c)) ?? cols[1]
}

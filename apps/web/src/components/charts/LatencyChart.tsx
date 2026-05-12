import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

interface Props {
  data: Record<string, unknown>[]
}

export default function LatencyChart({ data }: Props) {
  if (!data.length) return <Empty />

  const models  = [...new Set(data.map(r => r.model as string))]
  const hours   = [...new Set(data.map(r => r.hour as string))].sort()

  if (models.length === 1) {
    // single model: show p50 + p95 lines
    const rows = hours.map(h => {
      const match = data.find(r => r.hour === h)
      return {
        hour: h.slice(11, 16),
        p50:  match?.p50_ms ?? null,
        p95:  match?.p95_ms ?? null,
      }
    })
    return (
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit="ms" />
          <Tooltip formatter={(v: unknown) => [`${v} ms`]} />
          <Legend />
          <Line type="monotone" dataKey="p50" name="P50" stroke="#3b82f6" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="p95" name="P95" stroke="#ef4444" dot={false} strokeWidth={2} strokeDasharray="4 2" />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  // multiple models: one avg_ms line per model
  const COLORS = ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444']
  const pivoted = hours.map(h => {
    const row: Record<string, unknown> = { hour: h.slice(11, 16) }
    for (const model of models) {
      const match = data.find(r => r.hour === h && r.model === model)
      row[model] = match?.avg_ms ?? null
    }
    return row
  })

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={pivoted} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} unit="ms" />
        <Tooltip formatter={(v: unknown) => [`${v} ms`]} />
        <Legend />
        {models.map((m, i) => (
          <Line key={m} type="monotone" dataKey={m} stroke={COLORS[i % COLORS.length]} dot={false} strokeWidth={2} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function Empty() {
  return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
      No data for this time range
    </div>
  )
}

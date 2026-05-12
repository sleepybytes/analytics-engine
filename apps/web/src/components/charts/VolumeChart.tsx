import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

const COLORS = ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4']

interface Props {
  data: Record<string, unknown>[]
}

export default function VolumeChart({ data }: Props) {
  if (!data.length) return <Empty />

  const agents = [...new Set(data.map(r => r.agent_name as string))]
  const hours  = [...new Set(data.map(r => r.hour as string))].sort()

  const pivoted = hours.map(h => {
    const row: Record<string, unknown> = { hour: h.slice(11, 16) }
    for (const agent of agents) {
      const match = data.find(r => r.hour === h && r.agent_name === agent)
      row[agent] = (match?.trace_count as number) ?? 0
    }
    return row
  })

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={pivoted} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        {agents.map((agent, i) => (
          <Line
            key={agent}
            type="monotone"
            dataKey={agent}
            stroke={COLORS[i % COLORS.length]}
            dot={false}
            strokeWidth={2}
          />
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

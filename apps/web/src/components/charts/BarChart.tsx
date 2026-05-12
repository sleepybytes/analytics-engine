import {
  BarChart as ReBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

const COLORS = ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#f43f5e']

interface Props {
  data: Record<string, unknown>[]
  xKey: string
  yKey: string
  yLabel?: string
  color?: string
}

export default function BarChart({ data, xKey, yKey, yLabel, color }: Props) {
  if (!data.length) return <Empty />

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ReBarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11 }}
          angle={-25}
          textAnchor="end"
          interval={0}
        />
        <YAxis tick={{ fontSize: 11 }} label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11 } : undefined} />
        <Tooltip />
        <Bar dataKey={yKey} radius={[3, 3, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={color ?? COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </ReBarChart>
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

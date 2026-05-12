interface Props {
  label: string
  value: string | number | null
  sub?: string
  color?: 'blue' | 'green' | 'red' | 'amber'
}

const colorMap = {
  blue:  'text-blue-600',
  green: 'text-green-600',
  red:   'text-red-600',
  amber: 'text-amber-600',
}

export default function KpiCard({ label, value, sub, color = 'blue' }: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      <span className={`text-3xl font-bold ${colorMap[color]}`}>
        {value ?? '—'}
      </span>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  )
}

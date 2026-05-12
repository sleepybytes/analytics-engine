import { subDays, subHours } from '../lib/api'

export type Range = '1h' | '24h' | '7d' | '30d'

interface Props {
  range: Range
  agentName: string
  onRange: (r: Range) => void
  onAgent: (a: string) => void
}

const RANGES: { label: string; value: Range }[] = [
  { label: '1h',  value: '1h' },
  { label: '24h', value: '24h' },
  { label: '7d',  value: '7d' },
  { label: '30d', value: '30d' },
]

export function rangeToTimes(r: Range): { start_time: string; end_time: string } {
  const now = new Date().toISOString()
  const starts: Record<Range, string> = {
    '1h':  subHours(1),
    '24h': subHours(24),
    '7d':  subDays(7),
    '30d': subDays(30),
  }
  return { start_time: starts[r], end_time: now }
}

export default function FilterBar({ range, agentName, onRange, onAgent }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex rounded-lg border border-gray-200 overflow-hidden">
        {RANGES.map(r => (
          <button
            key={r.value}
            onClick={() => onRange(r.value)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              range === r.value
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

    </div>
  )
}

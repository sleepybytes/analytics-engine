import { useState, useMemo } from 'react'
import FilterBar, { Range, rangeToTimes } from '../components/FilterBar'
import KpiCard from '../components/KpiCard'
import VolumeChart from '../components/charts/VolumeChart'
import LatencyChart from '../components/charts/LatencyChart'
import BarChart from '../components/charts/BarChart'
import { useKpi, useQuery } from '../hooks/useAnalytics'

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>
      {children}
    </div>
  )
}

export default function Dashboard() {
  const [range, setRange] = useState<Range>('7d')
  const [agentName, setAgentName] = useState('')

  // useMemo so end_time is stable — SWR key must not change every render
  const filters = useMemo(
    () => ({ ...rangeToTimes(range), agent_name: agentName || undefined }),
    [range, agentName],
  )

  const { data: kpi, isLoading: kpiLoading } = useKpi(filters)
  const { data: volume }   = useQuery('trace_volume', filters)
  const { data: latency }  = useQuery('avg_llm_latency_by_model', filters)
  const { data: models }   = useQuery('model_usage_distribution', filters)
  const { data: toolErrs } = useQuery('tool_error_rate', filters)

  const successRate = kpi
    ? kpi.total_traces > 0
      ? ((kpi.success_count / kpi.total_traces) * 100).toFixed(1) + '%'
      : '—'
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">Overview</h2>
        <FilterBar range={range} agentName={agentName} onRange={setRange} onAgent={setAgentName} />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Traces"
          value={kpiLoading ? '…' : (kpi?.total_traces ?? 0)}
          color="blue"
        />
        <KpiCard
          label="Success Rate"
          value={kpiLoading ? '…' : successRate}
          sub={kpi ? `${kpi.error_count} errors` : undefined}
          color="green"
        />
        <KpiCard
          label="Avg Duration"
          value={kpiLoading ? '…' : fmtMs(kpi?.avg_duration_ms)}
          sub={kpi?.p95_duration_ms ? `p95: ${fmtMs(kpi.p95_duration_ms)}` : undefined}
          color="amber"
        />
        <KpiCard
          label="Total Cost"
          value={kpiLoading ? '…' : fmtUsd(kpi?.total_cost_usd)}
          sub={kpi
            ? `${fmtNum(kpi.total_input_tokens)}in / ${fmtNum(kpi.total_output_tokens)}out tok`
            : undefined}
          color="blue"
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Trace Volume (per hour)">
          <VolumeChart data={volume?.data ?? []} />
        </ChartCard>
        <ChartCard title="Model Distribution">
          <BarChart
            data={models?.data ?? []}
            xKey="model"
            yKey="call_count"
            yLabel="calls"
          />
        </ChartCard>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="LLM Latency by Model">
          <LatencyChart data={latency?.data ?? []} />
        </ChartCard>
        <ChartCard title="Tool Error Rate (%)">
          <BarChart
            data={toolErrs?.data ?? []}
            xKey="tool_name"
            yKey="error_rate_pct"
            yLabel="%"
            color="#ef4444"
          />
        </ChartCard>
      </div>
    </div>
  )
}

function fmtMs(ms: number | null | undefined) {
  if (ms == null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`
}

function fmtUsd(v: number | null | undefined) {
  if (v == null) return '—'
  return `$${v.toFixed(4)}`
}

function fmtNum(v: number | null | undefined) {
  if (v == null) return '—'
  return v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v)
}

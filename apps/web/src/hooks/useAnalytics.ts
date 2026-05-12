import useSWR from 'swr'
import { api, Filters } from '../lib/api'

const FIVE_MIN = 5 * 60 * 1000

export function useKpi(filters: Filters) {
  return useSWR(['kpi', filters], () => api.kpi(filters), { refreshInterval: FIVE_MIN })
}

export function useQuery(queryId: string, filters: Filters) {
  return useSWR(
    queryId ? ['query', queryId, filters] : null,
    () => api.query(queryId, filters),
    { refreshInterval: FIVE_MIN },
  )
}

export function useTraces(filters: Filters, limit: number, offset: number) {
  return useSWR(
    ['traces', filters, limit, offset],
    () => api.traces(filters, limit, offset),
    { refreshInterval: FIVE_MIN },
  )
}

export function useTrace(traceId: string | null) {
  return useSWR(traceId ? ['trace', traceId] : null, () => api.trace(traceId!))
}

export function useAgents() {
  return useSWR('agents', () => api.agents(), { refreshInterval: FIVE_MIN })
}

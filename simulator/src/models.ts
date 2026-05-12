export interface ModelConfig {
  name:             string
  provider:         string
  inputCostPer1M:   number
  outputCostPer1M:  number
  latencyRange:     [number, number]  // ms
  inputTokenRange:  [number, number]
  outputTokenRange: [number, number]
}

export const MODELS: ModelConfig[] = [
  {
    name: 'gpt-4o', provider: 'openai',
    inputCostPer1M: 5.00, outputCostPer1M: 15.00,
    latencyRange: [800, 3000], inputTokenRange: [400, 2000], outputTokenRange: [150, 800],
  },
  {
    name: 'claude-sonnet-4-6', provider: 'anthropic',
    inputCostPer1M: 3.00, outputCostPer1M: 15.00,
    latencyRange: [600, 2500], inputTokenRange: [300, 1800], outputTokenRange: [120, 700],
  },
  {
    name: 'gpt-4o-mini', provider: 'openai',
    inputCostPer1M: 0.15, outputCostPer1M: 0.60,
    latencyRange: [300, 1200], inputTokenRange: [200, 1000], outputTokenRange: [80, 400],
  },
  {
    name: 'claude-haiku-4-5', provider: 'anthropic',
    inputCostPer1M: 0.25, outputCostPer1M: 1.25,
    latencyRange: [200, 800], inputTokenRange: [150, 800], outputTokenRange: [60, 300],
  },
  {
    name: 'gemini-1.5-pro', provider: 'google',
    inputCostPer1M: 1.25, outputCostPer1M: 5.00,
    latencyRange: [500, 2000], inputTokenRange: [300, 1600], outputTokenRange: [100, 600],
  },
]

// Cumulative weights: 30%, 25%, 20%, 15%, 10%
const WEIGHTS = [0.30, 0.55, 0.75, 0.90, 1.00]

export function pickModel(): ModelConfig {
  const r = Math.random()
  return MODELS[WEIGHTS.findIndex(w => r < w)]
}

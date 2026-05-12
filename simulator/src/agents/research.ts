import { startTrace, addLLMCall, addToolCall, endStep, endTrace, randInt, AgentEvent } from '../builder'

const TOPICS = [
  'climate change mitigation strategies',
  'large language model alignment techniques',
  'quantum computing applications in finance',
  'CRISPR gene editing recent developments',
  'autonomous vehicle safety regulations',
  'decentralized finance risk management',
  'microplastics in ocean ecosystems',
  'protein folding prediction methods',
]

export function generateResearchTrace(): AgentEvent[] {
  const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)]
  const ctx   = startTrace('research-agent', `Research: ${topic}`)
  const steps = randInt(2, 4)

  for (let s = 0; s < steps; s++) {
    // Plan / analyze step: LLM call first
    addLLMCall(ctx)

    // Web search tool call
    addToolCall(ctx, 'web_search', topic)

    if (s > 0) {
      // Content extraction on follow-up steps
      addToolCall(ctx, 'extract_content', `Extract key findings from search results`)
    }

    // Synthesis LLM call
    if (s === steps - 1) {
      addLLMCall(ctx)  // final summarization
    }

    endStep(ctx, s === 0 ? 'search' : s === steps - 1 ? 'synthesis' : 'analysis')
  }

  return endTrace(ctx, `Research complete: ${topic}. Found ${randInt(3, 8)} relevant sources.`)
}

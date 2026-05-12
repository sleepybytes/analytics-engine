import { startTrace, addLLMCall, addToolCall, endStep, endTrace, randInt, AgentEvent } from '../builder'

const QUESTIONS = [
  'What is the capital gains tax rate for long-term investments?',
  'How does transformer attention mechanism work?',
  'What are the best practices for Kubernetes pod security?',
  'How do I configure CORS in FastAPI?',
  'What are the side effects of metformin?',
  'How does RSA encryption ensure message integrity?',
  'What is the difference between OLAP and OLTP databases?',
  'How does the TCP three-way handshake work?',
]

export function generateQATrace(): AgentEvent[] {
  const question = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)]
  const ctx      = startTrace('qa-agent', question)
  const steps    = randInt(2, 3)

  for (let s = 0; s < steps; s++) {
    // Retrieval step
    addToolCall(ctx, 'vector_search', question)

    if (s === 0 && Math.random() < 0.4) {
      // Supplement with web search on first step
      addToolCall(ctx, 'web_search', question)
    }

    // Answer generation
    addLLMCall(ctx)

    endStep(ctx, s === steps - 1 ? 'answer_generation' : 'retrieval')
  }

  return endTrace(ctx, `Answer generated for: "${question.slice(0, 60)}…"`)
}

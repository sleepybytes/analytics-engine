import { startTrace, addLLMCall, addToolCall, endStep, endTrace, randInt, AgentEvent } from '../builder'

const TASKS = [
  'implement a rate limiter with token bucket algorithm',
  'refactor authentication middleware to use JWT',
  'write unit tests for the payment processing module',
  'optimize database query for user analytics dashboard',
  'add pagination to the REST API endpoints',
  'implement WebSocket support for real-time notifications',
  'migrate codebase from Python 3.9 to 3.12',
  'add OpenTelemetry tracing to microservices',
]

export function generateCodeTrace(): AgentEvent[] {
  const task = TASKS[Math.floor(Math.random() * TASKS.length)]
  const ctx  = startTrace('code-agent', `Task: ${task}`)
  const steps = randInt(3, 5)

  const stepTypes = ['planning', 'implementation', 'testing', 'review', 'refinement']

  for (let s = 0; s < steps; s++) {
    const stepType = stepTypes[s] ?? 'implementation'

    // Planning: just LLM
    if (stepType === 'planning') {
      addLLMCall(ctx)
      endStep(ctx, stepType)
      continue
    }

    // Implementation: LLM + file ops
    addLLMCall(ctx)
    addToolCall(ctx, 'read_file', `Read relevant source files`)
    addToolCall(ctx, 'write_file', `Write implementation`)

    // Testing step: also run code
    if (stepType === 'testing') {
      addToolCall(ctx, 'code_exec', `Run test suite`)
    }

    // Review: second LLM call
    if (stepType === 'review') {
      addLLMCall(ctx)
    }

    endStep(ctx, stepType)
  }

  const linesChanged = randInt(50, 400)
  return endTrace(ctx, `Completed: ${task}. Changed ${linesChanged} lines across ${randInt(2, 8)} files.`)
}

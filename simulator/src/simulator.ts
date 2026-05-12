import { AgentEvent } from './builder'
import { generateResearchTrace } from './agents/research'
import { generateCodeTrace }     from './agents/code'
import { generateQATrace }       from './agents/qa'

interface SimulatorConfig {
  apiUrl:    string
  apiKey:    string
  traces:    number
  batchSize: number
  concurrency: number
}

// Agent distribution: research 40%, code 35%, qa 25%
const AGENT_WEIGHTS = [0.40, 0.75, 1.00]

function pickTrace(): AgentEvent[] {
  const r = Math.random()
  if (r < AGENT_WEIGHTS[0]) return generateResearchTrace()
  if (r < AGENT_WEIGHTS[1]) return generateCodeTrace()
  return generateQATrace()
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function sendBatch(url: string, apiKey: string, batch: AgentEvent[]): Promise<void> {
  const payload = {
    api_key: apiKey,
    batch,
    sent_at: new Date().toISOString(),
  }
  const body = JSON.stringify(payload)

  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (res.ok) return
    if (res.status === 429) {
      await sleep(Math.min(500 * 2 ** attempt, 10_000))  // 500ms→1s→2s→…→10s
      continue
    }
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  throw new Error('Max retries exceeded (429)')
}

function fmtDuration(ms: number): string {
  if (ms < 1000)  return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

export async function runSimulator(cfg: SimulatorConfig): Promise<void> {
  const captureUrl = `${cfg.apiUrl}/capture`
  const start      = Date.now()

  console.log(`\nSimulator starting`)
  console.log(`  Target:    ${cfg.traces} traces → ~${cfg.traces * 9} events`)
  console.log(`  API:       ${captureUrl}`)
  console.log(`  Batch:     ${cfg.batchSize} events`)
  console.log(`  Concurrency: ${cfg.concurrency}\n`)

  // Generate all traces
  process.stdout.write('Generating traces…')
  const allEvents: AgentEvent[] = []
  let   researchCount = 0, codeCount = 0, qaCount = 0

  for (let i = 0; i < cfg.traces; i++) {
    const r = Math.random()
    let events: AgentEvent[]
    if (r < 0.40) { events = generateResearchTrace(); researchCount++ }
    else if (r < 0.75) { events = generateCodeTrace(); codeCount++ }
    else { events = generateQATrace(); qaCount++ }
    allEvents.push(...events)
  }
  console.log(` done — ${allEvents.length} events`)
  console.log(`  research=${researchCount} code=${codeCount} qa=${qaCount}`)

  // Send in batches with limited concurrency
  const batches: AgentEvent[][] = []
  for (let i = 0; i < allEvents.length; i += cfg.batchSize) {
    batches.push(allEvents.slice(i, i + cfg.batchSize))
  }

  console.log(`\nSending ${batches.length} batches…`)

  let sent = 0
  let errors = 0

  for (let i = 0; i < batches.length; i += cfg.concurrency) {
    const chunk = batches.slice(i, i + cfg.concurrency)
    await Promise.all(
      chunk.map(batch =>
        sendBatch(captureUrl, cfg.apiKey, batch)
          .then(() => { sent += batch.length })
          .catch(err => {
            errors++
            console.error(`\nBatch error: ${err.message}`)
          })
      )
    )

    const pct      = Math.round(((i + chunk.length) / batches.length) * 100)
    const elapsed  = Date.now() - start
    const rate     = Math.round(sent / (elapsed / 1000))
    process.stdout.write(`\r  ${pct}% · ${sent.toLocaleString()} events · ${rate}/s · ${fmtDuration(elapsed)}`)
  }

  const totalMs = Date.now() - start
  console.log(`\n\n✓ Done in ${fmtDuration(totalMs)}`)
  console.log(`  Sent:   ${sent.toLocaleString()} events`)
  if (errors) console.log(`  Errors: ${errors} batches`)
  console.log(`  Rate:   ${Math.round(sent / (totalMs / 1000))}/s`)
}

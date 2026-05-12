import { runSimulator } from './simulator'

const args = process.argv.slice(2)
const mode = args.find(a => a.startsWith('--mode='))?.split('=')[1]
       ?? (args[args.indexOf('--mode') + 1])
       ?? 'demo'

const API_URL = process.env.API_URL ?? 'http://localhost:8080'
const API_KEY = process.env.API_KEY ?? 'dev_project_key'

const CONFIGS = {
  demo: {
    traces:      1_000,
    batchSize:   100,
    concurrency: 2,
  },
  bench: {
    traces:      10_000,
    batchSize:   500,
    concurrency: 10,
  },
}

const cfg = CONFIGS[mode as keyof typeof CONFIGS]
if (!cfg) {
  console.error(`Unknown mode: ${mode}. Use --mode demo|bench`)
  process.exit(1)
}

runSimulator({ apiUrl: API_URL, apiKey: API_KEY, ...cfg }).catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})

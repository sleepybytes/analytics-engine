import type { AgentEvent } from './types';

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export class HttpClient {
  private readonly maxRetries: number;
  private readonly debug: boolean;

  constructor(
    private readonly host: string,
    private readonly apiKey: string,
    options: { maxRetries?: number; debug?: boolean } = {},
  ) {
    this.maxRetries = options.maxRetries ?? 3;
    this.debug = options.debug ?? false;
  }

  async sendBatch(batch: AgentEvent[], sentAt: string): Promise<void> {
    const body = JSON.stringify({ api_key: this.apiKey, batch, sent_at: sentAt });

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(`${this.host}/capture`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });

        if (res.ok) {
          if (this.debug) console.debug(`[SDK] Sent ${batch.length} events`);
          return;
        }

        if (res.status === 400 || res.status === 422) {
          if (this.debug) {
            const text = await res.text().catch(() => '');
            console.debug(`[SDK] Batch rejected (${res.status}), discarding:`, text);
          }
          return; // validation error — discard, do not retry
        }

        if (!RETRYABLE_STATUS.has(res.status) || attempt === this.maxRetries) {
          if (this.debug) console.debug(`[SDK] Request failed (${res.status}), giving up`);
          return;
        }

        if (this.debug) console.debug(`[SDK] Retryable ${res.status}, attempt ${attempt}/${this.maxRetries}`);
        await this._delay(attempt);

      } catch (err) {
        // Network / fetch error
        if (attempt === this.maxRetries) {
          if (this.debug) console.debug('[SDK] Network error after all retries:', err);
          return;
        }
        if (this.debug) console.debug(`[SDK] Network error, attempt ${attempt}/${this.maxRetries}:`, err);
        await this._delay(attempt);
      }
    }
  }

  // Exponential backoff: 1s, 2s, 4s with ±20% jitter
  private _delay(attempt: number): Promise<void> {
    const base = Math.pow(2, attempt - 1) * 1_000;
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return new Promise(resolve => setTimeout(resolve, Math.round(base + jitter)));
  }
}

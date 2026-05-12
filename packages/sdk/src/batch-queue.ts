import type { AgentEvent } from './types';

export class BatchQueue {
  private readonly queue: AgentEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly onFlush: (batch: AgentEvent[], sentAt: string) => Promise<void>,
    private readonly flushAt = 50,
    private readonly flushIntervalMs = 5_000,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      this.flush().catch(() => {/* errors surfaced in onFlush */});
    }, this.flushIntervalMs);
    // Allow process to exit even if the timer is active
    if (this.timer.unref) this.timer.unref();
  }

  enqueue(event: AgentEvent): void {
    this.queue.push(event);
    if (this.queue.length >= this.flushAt) {
      this.flush().catch(() => {});
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    // splice is synchronous — safe against concurrent flush() calls in JS
    const batch = this.queue.splice(0);
    await this.onFlush(batch, new Date().toISOString());
  }

  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}

import { BatchQueue } from './batch-queue';
import { HttpClient } from './http-client';
import { TraceHandle, type TraceStartOpts } from './trace';
import type { AgentEvent } from './types';

export interface AnalyticsConfig {
  apiKey: string;
  host: string;
  flushAt?: number;
  flushIntervalMs?: number;
  maxRetries?: number;
  debug?: boolean;
}

export class AgentAnalytics {
  private readonly queue: BatchQueue;
  private readonly http: HttpClient;

  constructor(config: AnalyticsConfig) {
    this.http = new HttpClient(config.host, config.apiKey, {
      maxRetries: config.maxRetries,
      debug: config.debug,
    });

    this.queue = new BatchQueue(
      (batch: AgentEvent[], sentAt: string) => this.http.sendBatch(batch, sentAt),
      config.flushAt ?? 50,
      config.flushIntervalMs ?? 5_000,
    );

    this.queue.start();
  }

  startTrace(opts: TraceStartOpts): TraceHandle {
    return new TraceHandle(
      (event: AgentEvent) => this.queue.enqueue(event),
      opts.agentName,
      opts,
    );
  }

  async flush(): Promise<void> {
    await this.queue.flush();
  }

  async shutdown(): Promise<void> {
    await this.queue.shutdown();
  }
}

export function initAgentAnalytics(config: AnalyticsConfig): AgentAnalytics {
  return new AgentAnalytics(config);
}

import { resolveTurn, type RunState, type TurnResult } from '../core';
import type {
  TurnPreviewWorkerRequest,
  TurnPreviewWorkerResponse,
} from './turn-preview.worker';

interface PreviewWorker {
  postMessage(message: TurnPreviewWorkerRequest): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<TurnPreviewWorkerResponse>) => void,
  ): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export interface CachedTurnResult {
  key: string;
  result: TurnResult;
  computeMs: number;
  source: 'worker' | 'fallback';
}

interface PreviewJob {
  key: string;
  requestId: number;
  state: RunState;
  targets: readonly string[];
  resolve: (value: CachedTurnResult) => void;
}

function requestKey(state: RunState, targets: readonly string[]): string {
  return JSON.stringify([state.runId, state.revision, targets]);
}

/**
 * Computes full turn results away from the interaction thread and keeps the
 * exact result available for a subsequent instant GO commit.
 */
export class TurnPreviewClient {
  private worker: PreviewWorker | null;
  private nextRequestId = 1;
  private readonly jobs = new Map<number, PreviewJob>();
  private readonly jobsByKey = new Map<string, Promise<CachedTurnResult>>();
  private readonly cache = new Map<string, CachedTurnResult>();

  constructor(
    workerFactory: () => PreviewWorker | null = () => {
      if (typeof Worker === 'undefined') return null;
      return new Worker(new URL('./turn-preview.worker.ts', import.meta.url), {
        type: 'module',
        name: 'chain-game-turn-preview',
      });
    },
  ) {
    try {
      this.worker = workerFactory();
      this.worker?.addEventListener('message', (event) => this.onMessage(event.data));
      this.worker?.addEventListener('error', () => this.fallbackFromWorkerFailure());
    } catch {
      this.worker = null;
    }
  }

  getCached(state: RunState, targets: readonly string[]): CachedTurnResult | undefined {
    return this.cache.get(requestKey(state, targets));
  }

  preview(state: RunState, targets: readonly string[]): Promise<CachedTurnResult> {
    const key = requestKey(state, targets);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.jobsByKey.get(key);
    if (pending) return pending;

    const requestId = this.nextRequestId++;
    let resolveJob!: (value: CachedTurnResult) => void;
    const promise = new Promise<CachedTurnResult>((resolve) => {
      resolveJob = resolve;
    });
    this.jobsByKey.set(key, promise);
    const job: PreviewJob = {
      key,
      requestId,
      state,
      targets: [...targets],
      resolve: resolveJob,
    };
    this.jobs.set(requestId, job);
    if (this.worker) {
      try {
        this.worker.postMessage({ requestId, state, targets: job.targets });
      } catch {
        this.fallbackJob(job);
      }
    } else {
      this.fallbackJob(job);
    }
    return promise;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.jobs.clear();
    this.jobsByKey.clear();
    this.cache.clear();
  }

  private onMessage(message: TurnPreviewWorkerResponse): void {
    const job = this.jobs.get(message.requestId);
    if (!job) return;
    this.complete(job, message.result, message.computeMs, 'worker');
  }

  private fallbackFromWorkerFailure(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.jobs.values()) this.fallbackJob(job);
  }

  private fallbackJob(job: PreviewJob): void {
    queueMicrotask(() => {
      if (!this.jobs.has(job.requestId)) return;
      const startedAt = performance.now();
      const result = resolveTurn(job.state, {
        runId: job.state.runId,
        revision: job.state.revision,
        targets: job.targets,
      });
      this.complete(job, result, performance.now() - startedAt, 'fallback');
    });
  }

  private complete(
    job: PreviewJob,
    result: TurnResult,
    computeMs: number,
    source: CachedTurnResult['source'],
  ): void {
    this.jobs.delete(job.requestId);
    this.jobsByKey.delete(job.key);
    const value: CachedTurnResult = { key: job.key, result, computeMs, source };
    this.cache.set(job.key, value);
    while (this.cache.size > 64) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    job.resolve(value);
  }
}

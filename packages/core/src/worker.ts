import { clipboardTextLimit } from './tsv.js';

export interface GridWorkerTransport {
  postMessage(value: unknown): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: () => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'error' | 'messageerror', listener: () => void): void;
}
export interface GridWorkerSignal {
  readonly aborted: boolean;
  addEventListener?(type: 'abort', listener: () => void, options?: { once: boolean }): void;
  removeEventListener?(type: 'abort', listener: () => void): void;
}

/** One disposable worker per decode; no worker or browser globals are created at import. */
export function createTsvWorker(createWorker: () => GridWorkerTransport) {
  let active = false,
    destroyed = false;
  let cancel: (() => void) | undefined;
  return {
    decodeTsv(text: string, signal?: GridWorkerSignal): Promise<unknown> {
      if (destroyed || active)
        return Promise.reject(new Error(destroyed ? 'TSV worker is destroyed.' : 'TSV worker is busy.'));
      if (signal?.aborted) return Promise.reject(new Error('Bulk operation canceled.'));
      if (typeof text !== 'string' || text.length > clipboardTextLimit)
        return Promise.reject(new RangeError('Clipboard text is too large.'));
      active = true;
      return new Promise((resolve, reject) => {
        let worker: GridWorkerTransport | undefined;
        let settled = false;
        const finish = (error?: Error, values?: unknown) => {
          if (settled) return;
          settled = true;
          active = false;
          cancel = undefined;
          for (const cleanup of [
            () => signal?.removeEventListener?.('abort', abort),
            () => worker?.removeEventListener('message', message),
            () => worker?.removeEventListener('error', failure),
            () => worker?.removeEventListener('messageerror', failure),
            () => worker?.terminate(),
          ])
            try {
              cleanup();
            } catch (cause) {
              error ??= cause instanceof Error ? cause : new Error('TSV worker cleanup failed.');
            }
          if (error) reject(error);
          else resolve(values);
        };
        const abort = () => finish(new Error('Bulk operation canceled.'));
        const failure = () => finish(new Error('TSV worker failed.'));
        const message = (event: { data: unknown }) => {
          const data = event.data as { values?: unknown; error?: unknown } | null;
          if (!data || typeof data !== 'object') return finish(new Error('Invalid TSV worker response.'));
          if (typeof data.error === 'string') return finish(new Error(data.error));
          finish(undefined, data.values);
        };
        cancel = abort;
        try {
          worker = createWorker();
          worker.addEventListener('message', message);
          worker.addEventListener('error', failure);
          worker.addEventListener('messageerror', failure);
          signal?.addEventListener?.('abort', abort, { once: true });
          if (signal?.aborted) abort();
          else worker.postMessage({ text });
        } catch {
          failure();
        }
      });
    },
    destroy(): void {
      destroyed = true;
      cancel?.();
    },
  };
}

export interface GridBulkProgress {
  readonly phase: 'parse' | 'prepare' | 'validate' | 'sort';
  readonly completed: number;
  readonly total: number;
}
export interface GridBulkOptions {
  /** Host scheduler, for example a browser task yield. Must eventually settle. */
  readonly yieldControl: () => Promise<void>;
  readonly signal?: { readonly aborted: boolean };
  readonly onProgress?: (progress: GridBulkProgress) => void;
  /** Must change on external data, schema or permission changes during the operation. */
  readonly getRevision?: () => string;
}
export type BulkSteps<T> = Generator<GridBulkProgress, T, void>;
export function drain<T>(steps: BulkSteps<T>): T {
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}
export async function runSteps<T>(steps: BulkSteps<T>, options: GridBulkOptions, assertAlive: () => void): Promise<T> {
  if (
    !options ||
    typeof options.yieldControl !== 'function' ||
    (options.onProgress !== undefined && typeof options.onProgress !== 'function') ||
    (options.getRevision !== undefined && typeof options.getRevision !== 'function')
  )
    throw new TypeError('Invalid bulk options.');
  const { yieldControl, onProgress, getRevision, signal } = options;
  const revision = getRevision?.();
  if (getRevision && (typeof revision !== 'string' || !revision)) throw new TypeError('Invalid bulk revision.');
  function check(): void {
    assertAlive();
    if (signal?.aborted) throw new Error('Bulk operation canceled.');
    if (getRevision && getRevision() !== revision) throw new Error('Bulk operation revision changed.');
  }
  try {
    check();
    await yieldControl();
    while (true) {
      check();
      const result = steps.next();
      if (result.done) return result.value;
      onProgress?.(Object.freeze({ ...result.value }));
      await yieldControl();
    }
  } finally {
    steps.return(undefined as T);
  }
}

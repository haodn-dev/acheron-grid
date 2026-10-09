import { decodeTsv } from './tsv.js';

const scope = globalThis as unknown as {
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(value: unknown): void;
};
scope.addEventListener('message', ({ data }) => {
  try {
    const text = (data as { text?: unknown } | null)?.text;
    if (typeof text !== 'string') throw new TypeError('Invalid TSV worker request.');
    scope.postMessage({ values: decodeTsv(text) });
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : 'TSV parsing failed.' });
  }
});

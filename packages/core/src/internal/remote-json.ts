import { clipboardTextLimit } from '../tsv.js';

export function jsonSnapshot<T>(value: T): T {
  const text = JSON.stringify(value, (_, item: unknown) => {
    if (
      item === undefined ||
      typeof item === 'function' ||
      typeof item === 'symbol' ||
      typeof item === 'bigint' ||
      (typeof item === 'number' && !Number.isFinite(item))
    )
      throw new TypeError('Remote values must be JSON-serializable and finite.');
    return item;
  });
  if (text.length > clipboardTextLimit) throw new RangeError('Remote payload is too large.');
  const copy: unknown = JSON.parse(text);
  function freeze(item: unknown, depth: number): void {
    if (depth > 64) throw new RangeError('Remote payload is too deeply nested.');
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child, depth + 1);
      Object.freeze(item);
    }
  }
  freeze(copy, 0);
  return copy as T;
}

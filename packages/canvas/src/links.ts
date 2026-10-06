/** A detected HTTP(S) URL and its offsets in the original text. */
export interface CellLink {
  readonly text: string;
  readonly href: string;
  readonly start: number;
  readonly end: number;
}

export function safeWebUrl(value: string): string | undefined {
  if (value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  try {
    const url = new URL(/^www\./i.test(value) ? 'https://' + value : value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** Recognize explicit web URLs without interpreting HTML or relative paths. */
export function detectLinks(value: unknown): CellLink[] {
  if (typeof value !== 'string') return [];
  const links: CellLink[] = [];
  for (const match of value.matchAll(/(?:https?:\/\/|www\.)[^\s<>"'`]+/gi)) {
    const start = match.index!;
    if (start && /[\w@:/]/.test(value[start - 1]!)) continue;
    let text = match[0];
    const pairs = new Map([
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ]);
    const excess = new Map([
      [')', 0],
      [']', 0],
      ['}', 0],
    ]);
    for (const character of text) {
      if (excess.has(character)) excess.set(character, excess.get(character)! + 1);
      const close = pairs.get(character);
      if (close) excess.set(close, excess.get(close)! - 1);
    }
    let end = text.length;
    while (end) {
      const character = text[end - 1]!;
      if (/[.,;:!?]/.test(character)) end--;
      else if ((excess.get(character) ?? 0) > 0) {
        excess.set(character, excess.get(character)! - 1);
        end--;
      } else break;
    }
    text = text.slice(0, end);
    const href = safeWebUrl(text);
    if (href) links.push(Object.freeze({ text, href, start, end: start + text.length }));
  }
  return links;
}

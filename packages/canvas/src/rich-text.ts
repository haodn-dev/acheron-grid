import { safeWebUrl } from './links.js';

export type RichTextFormat = 'markdown' | 'html';
export interface TextRun {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly code?: boolean;
  readonly href?: string;
}
export interface RichText {
  readonly text: string;
  readonly runs: readonly TextRun[];
  readonly unavailable?: boolean;
}

/** Build mounted markup only from text and explicitly supported marks. */
export function richTextHtml(rich: RichText, document: Document): string {
  const container = document.createElement('div');
  for (const run of rich.runs) {
    const span = document.createElement('span');
    run.text.split('\n').forEach((text, index) => {
      if (index) span.append(document.createElement('br'));
      span.append(document.createTextNode(text));
    });
    let node: HTMLElement = span;
    for (const tag of [
      run.code ? 'code' : '',
      run.bold ? 'strong' : '',
      run.italic ? 'em' : '',
      run.underline ? 'u' : '',
    ]) {
      if (tag) {
        const wrapper = document.createElement(tag);
        wrapper.append(node);
        node = wrapper;
      }
    }
    const href = run.href ? safeWebUrl(run.href) : undefined;
    if (href) {
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.append(node);
      node = anchor;
    }
    container.append(node);
  }
  return container.innerHTML;
}

export function richTextSource(rich: RichText, format: RichTextFormat, document: Document): string {
  if (format === 'html') return richTextHtml(rich, document);
  const runs: TextRun[] = [];
  for (const run of rich.runs) {
    const last = runs.at(-1);
    if (
      last &&
      !!last.bold === !!run.bold &&
      !!last.italic === !!run.italic &&
      !!last.code === !!run.code &&
      last.href === run.href
    )
      runs[runs.length - 1] = { ...last, text: last.text + run.text };
    else runs.push(run);
  }
  return runs
    .map((run) =>
      run.text
        .split('\n')
        .map((part) => {
          const leading = /^\s*/.exec(part)![0],
            trailing = /\s*$/.exec(part)![0];
          const core = part.slice(leading.length, part.length - trailing.length);
          if (!core) return part;
          let text = core.replace(/[\\`*_{}\[\]()#+.!<>~&-]/g, '\\$&');
          if (run.code) {
            const longest = Math.max(0, ...Array.from(core.matchAll(/`+/g), (match) => match[0].length));
            const ticks = '`'.repeat(longest + 1);
            text = ticks + ' ' + core + ' ' + ticks;
          }
          if (run.bold) text = '**' + text + '**';
          if (run.italic) text = '*' + text + '*';
          if (run.href && safeWebUrl(run.href))
            text = '[' + text + '](' + run.href.replace(/[()\\]/g, (character) => encodeURIComponent(character)) + ')';
          return leading + text + trailing;
        })
        .join('  \n'),
    )
    .join('');
}

/** Read only inert markup. No parsed element is mounted or used as an image. */
export function readHtml(source: string, document: Document, preserveWhitespace = false): RichText {
  if (source.length > 100_000) throw new RangeError('Rich text exceeds 100,000 characters.');
  const template = document.createElement('template');
  template.innerHTML = source;
  const runs: TextRun[] = [];
  const breakLine = () => {
    if (runs.length && !runs.at(-1)!.text.endsWith('\n')) runs.push({ text: '\n' });
  };
  const visit = (node: Node, style: Omit<TextRun, 'text'>, depth: number): void => {
    if (depth > 128) return;
    if (node.nodeType === 3) {
      const text = node.textContent ?? '';
      if (
        !preserveWhitespace &&
        !text.trim() &&
        ((node.parentNode?.nodeType === 11 && /[\r\n]/.test(text)) ||
          ['UL', 'OL'].includes(node.parentElement?.tagName ?? ''))
      )
        return;
      if (text) runs.push({ ...style, text: style.code || preserveWhitespace ? text : text.replace(/\s+/g, ' ') });
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript'].includes(tag)) return;
    if (tag === 'br') {
      runs.push({ text: '\n' });
      return;
    }
    if (tag === 'img') {
      if (element.getAttribute('alt')) runs.push({ ...style, text: element.getAttribute('alt')! });
      return;
    }
    const block = ['p', 'div', 'li', 'ul', 'ol', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag);
    if (block) breakLine();
    if (tag === 'li') {
      const parent = element.parentElement;
      const start = Number(parent?.getAttribute('start') ?? 1);
      const index = parent ? Array.from(parent.children).indexOf(element) : 0;
      runs.push({ text: parent?.tagName === 'OL' ? `${(Number.isFinite(start) ? start : 1) + index}. ` : '• ' });
    }
    const href = tag === 'a' ? safeWebUrl(element.getAttribute('href') ?? '') : undefined;
    const next = {
      ...style,
      ...(['strong', 'b'].includes(tag) ? { bold: true } : {}),
      ...(['em', 'i'].includes(tag) ? { italic: true } : {}),
      ...(tag === 'u' ? { underline: true } : {}),
      ...(['code', 'pre'].includes(tag) ? { code: true } : {}),
      ...(href ? { href } : {}),
    };
    if (preserveWhitespace) {
      const css = (element as HTMLElement).style;
      if (css?.fontWeight) next.bold = css.fontWeight === 'bold' || Number(css.fontWeight) >= 600;
      if (css?.fontStyle) next.italic = css.fontStyle === 'italic';
      if (css?.textDecorationLine) next.underline = css.textDecorationLine.includes('underline');
    }
    node.childNodes.forEach((child) => visit(child, next, depth + 1));
    if (block) breakLine();
  };
  template.content.childNodes.forEach((child) => visit(child, {}, 0));
  if (runs.at(-1)?.text === '\n') runs.pop();
  return { runs, text: runs.map((run) => run.text).join('') };
}

function runFont(font: string, run: TextRun): string {
  if (!run.bold && !run.italic && !run.code) return font;
  let base = font;
  if (run.italic) base = base.replace(/\b(?:italic|oblique)\s+/, '');
  if (run.bold) base = base.replace(/\b(?:normal|[1-9]00|bold|bolder|lighter)\s+/, '');
  return `${run.italic ? 'italic ' : ''}${run.bold ? '700 ' : ''}${run.code ? base.replace(/(?<=px).*/, ' monospace') : base}`;
}

export interface TextPiece {
  readonly run: TextRun;
  readonly font: string;
  readonly text: string;
  readonly x: number;
  readonly line: number;
  readonly width: number;
}
/** Shared geometry for painting, wrapping and measuring styled text. */
export function layoutRichText(
  context: CanvasRenderingContext2D,
  rich: RichText,
  font: string,
  width: number,
  wrap: boolean,
  maxLines = 1000,
): { pieces: TextPiece[]; lines: number; width: number; lineHeight: number } {
  context.font = font;
  font = context.font;
  const metrics = context.measureText('M');
  const lineHeight = Math.ceil(metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) || 18;
  const pieces: TextPiece[] = [];
  let line = 0;
  let x = 0;
  let widest = 0;
  for (const run of rich.runs) {
    const style = runFont(font, run);
    context.font = style;
    let text = '';
    let measured = 0;
    const flush = () => {
      if (text) {
        pieces.push({ run, font: style, text, x, line, width: measured });
        x += measured;
        widest = Math.max(widest, x);
      }
      text = '';
      measured = 0;
    };
    for (const character of run.text) {
      if (character === '\n') {
        flush();
        if (++line >= maxLines) return { pieces, lines: maxLines, width: widest, lineHeight };
        x = 0;
        continue;
      }
      let next = context.measureText(text + character).width;
      if (wrap && x + next > width && (x > 0 || text)) {
        flush();
        if (++line >= maxLines) return { pieces, lines: maxLines, width: widest, lineHeight };
        x = 0;
        next = context.measureText(character).width;
      }
      text += character;
      measured = next;
      if (text.length >= 256) flush();
    }
    flush();
  }
  return { pieces, lines: line + 1, width: widest, lineHeight };
}

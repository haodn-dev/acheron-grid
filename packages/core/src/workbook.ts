import { evaluateFormula } from './formula.js';

export type WorkbookCell = number | string;
export interface WorkbookEdit {
  readonly sheet: string;
  readonly address: string;
  readonly value: WorkbookCell | null;
}

/** In-memory workbook with atomic, revision-checked edits. Hosts own transport and persistence. */
export function createWorkbook(sheetNames: readonly string[]) {
  if (
    !sheetNames.length ||
    sheetNames.length > 64 ||
    new Set(sheetNames).size !== sheetNames.length ||
    sheetNames.some((name) => typeof name !== 'string' || !name.trim() || name.length > 64)
  )
    throw new RangeError('Invalid workbook sheet names.');
  const sheets = new Map(sheetNames.map((name) => [name, new Map<string, WorkbookCell>()]));
  let revision = 0;
  let cellCount = 0;
  const addressPattern = /^[A-Z]{1,4}[1-9]\d{0,6}$/;
  function sheet(name: string) {
    const cells = sheets.get(name);
    if (!cells) throw new RangeError('Unknown sheet.');
    return cells;
  }
  return Object.freeze({
    get revision() {
      return revision;
    },
    read(name: string, address: string) {
      const cells = sheet(name);
      const value = cells.get(address.toUpperCase());
      return typeof value === 'string' && value.startsWith('=')
        ? evaluateFormula(value, (reference) => cells.get(reference))
        : value;
    },
    snapshot() {
      return {
        revision,
        sheets: Array.from(sheets, ([name, cells]) => ({ name, cells: Object.fromEntries(cells) })),
      };
    },
    apply(expectedRevision: number, edits: readonly WorkbookEdit[]) {
      if (expectedRevision !== revision) return { status: 'conflict' as const, revision };
      if (!edits.length || edits.length > 1000) throw new RangeError('Invalid workbook batch size.');
      const staged = new Map<Map<string, WorkbookCell>, Map<string, WorkbookCell | null>>();
      let nextCount = cellCount;
      for (const edit of edits) {
        const cells = sheet(edit.sheet);
        const address = edit.address.toUpperCase();
        const value = edit.value;
        if (
          !addressPattern.test(address) ||
          (value !== null &&
            !(typeof value === 'number' && Number.isFinite(value)) &&
            !(typeof value === 'string' && value.length <= 4096))
        )
          throw new TypeError('Invalid workbook cell.');
        let changes = staged.get(cells);
        if (!changes) staged.set(cells, (changes = new Map()));
        if (changes.has(address)) throw new TypeError('Duplicate workbook edit.');
        nextCount += Number(value !== null) - Number(cells.has(address));
        changes.set(address, value);
      }
      if (nextCount > 100_000) throw new RangeError('Workbook cell limit exceeded.');
      for (const [cells, changes] of staged)
        for (const [address, value] of changes) {
          if (value === null) cells.delete(address);
          else cells.set(address, value);
        }
      cellCount = nextCount;
      return { status: 'accepted' as const, revision: ++revision };
    },
  });
}

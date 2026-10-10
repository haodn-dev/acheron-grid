import type { ClipboardBlock } from '../clipboard.js';
import { blocksToTsv, encodeBlocks } from '../clipboard.js';
import type { CellUpdate, RowId } from '../data-source.js';
import type { GridChangeSource } from '../events.js';
import type { CellPermission } from '../permissions.js';
import { clipboardCellLimit, clipboardTextLimit, decodeTsv, decodeTsvSteps, validateTsvSteps } from '../tsv.js';
import { drain } from './bulk.js';
import type { BulkSteps } from './bulk.js';
import type { CellFormat, PasteOptions, SelectionRange } from '../types.js';
import type { EngineContext, FormatChange } from './engine-context.js';
export function createClipboard(
  context: Pick<
    EngineContext,
    | 'dataSource'
    | 'columns'
    | 'pendingCut'
    | 'rowCount'
    | 'columnIndices'
    | 'formats'
    | 'formatOrder'
    | 'projection'
    | 'activeParts'
    | 'destroyed'
  >,
  dependencies: {
    assertAlive: () => void;
    displaySelectionRanges: () => SelectionRange[];
    sourceRow: (index: number) => number;
    requirePermission: (rowIndex: number, columnIndex: number, key: keyof CellPermission) => void;
    mergeAt: (row: number, col: number) => Readonly<SelectionRange> | undefined;
    getFormat: (rowIndex: number, columnIndex: number) => Readonly<CellFormat>;
    visibleRowCount: () => number;
    requireFormatPermission: (bounds: SelectionRange) => void;
    applyUpdates: (updates: readonly CellUpdate[], source?: GridChangeSource, formatChanges?: FormatChange[]) => void;
    applyUpdatesSteps: (
      updates: readonly CellUpdate[],
      source?: GridChangeSource,
      formatChanges?: FormatChange[],
      cooperative?: boolean,
      finalCheck?: () => BulkSteps<void>,
      guarded?: boolean,
    ) => BulkSteps<void>;
    selectRange: (range: SelectionRange, mode?: 'replace' | 'add' | 'extend') => boolean;
    selectDisplayRange: (range: SelectionRange, mode?: 'replace' | 'add' | 'extend') => boolean;
    getSelectionRange: () => SelectionRange | null;
    getCellPermission: (rowIndex: number, columnIndex: number) => CellPermission;
  },
) {
  function clipboardBlocks(): ClipboardBlock[] {
    dependencies.assertAlive();
    const ranges = dependencies
      .displaySelectionRanges()
      .sort((a, b) => a.startRow - b.startRow || a.startColumn - b.startColumn);
    if (!ranges.length) return [];
    if (ranges.length > 128) throw new RangeError('Clipboard supports at most 128 visible ranges.');
    const firstRow = Math.min(...ranges.map((range) => range.startRow)),
      firstColumn = Math.min(...ranges.map((range) => range.startColumn));
    let cells = 0,
      length = 0;
    return ranges.map((range) => {
      cells += (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1);
      if (cells > clipboardCellLimit) throw new RangeError('Selection has too many cells.');
      const values: string[][] = [],
        cellFormats: CellFormat[][] = [];
      for (let row = range.startRow; row <= range.endRow; row++) {
        const line: string[] = [],
          formatLine: CellFormat[] = [];
        for (let col = range.startColumn; col <= range.endColumn; col++) {
          const index = dependencies.sourceRow(row);
          dependencies.requirePermission(index, col, 'copyable');
          const span = dependencies.mergeAt(index, col),
            value =
              span && (index !== span.startRow || col !== span.startColumn)
                ? null
                : context.dataSource.getValue(index, context.columns[col]!.key),
            text = value == null ? '' : String(value);
          length += text.length;
          if (length > clipboardTextLimit) throw new RangeError('Selection text is too large.');
          line.push(text);
          formatLine.push(dependencies.getFormat(index, col));
        }
        values.push(line);
        cellFormats.push(formatLine);
      }
      return {
        row: range.startRow - firstRow,
        column: range.startColumn - firstColumn,
        values,
        ...(cellFormats.some((line) => line.some((format) => Object.keys(format).length))
          ? { formats: cellFormats }
          : {}),
      };
    });
  }
  function copySelection(): string {
    return blocksToTsv(clipboardBlocks());
  }
  function cutSelectionBlocks(): string {
    const blocks = clipboardBlocks();
    if (!blocks.length) throw new Error('Select cells before cutting.');
    const cells = new Map<string, CellUpdate & { rowId: RowId }>();
    for (const range of dependencies.displaySelectionRanges())
      for (let row = range.startRow; row <= range.endRow; row++)
        for (let col = range.startColumn; col <= range.endColumn; col++) {
          const rowIndex = dependencies.sourceRow(row),
            columnKey = context.columns[col]!.key;
          if (dependencies.mergeAt(rowIndex, col)) throw new Error('Unmerge cells before cutting.');
          dependencies.requirePermission(rowIndex, col, 'writable');
          cells.set(`${rowIndex}:${columnKey}`, {
            rowIndex,
            columnKey,
            rowId: context.dataSource.getRowId(rowIndex),
            value: context.dataSource.getValue(rowIndex, columnKey),
          });
        }
    const text = encodeBlocks(blocks);
    context.pendingCut = {
      cells: [...cells.values()],
      columnKeys: context.columns.map((column) => column.key),
      blockCount: blocks.length,
    };
    return text;
  }
  function* pasteBlocksSteps(
    blocks: readonly ClipboardBlock[],
    structured: boolean,
    move = false,
    options: PasteOptions = {},
    cooperative = false,
    guarded = false,
  ): BulkSteps<void> {
    dependencies.assertAlive();
    if (
      !options ||
      typeof options !== 'object' ||
      (options.mode !== undefined && !['all', 'values', 'formats'].includes(options.mode)) ||
      (options.transpose !== undefined && typeof options.transpose !== 'boolean') ||
      (options.skipEmpty !== undefined && typeof options.skipEmpty !== 'boolean')
    )
      throw new TypeError('Invalid paste options.');
    const mode = options.mode ?? 'all';
    if (move && (mode !== 'all' || options.transpose || options.skipEmpty))
      throw new Error('Cut cannot use paste special.');
    if (options.transpose)
      blocks = blocks.map((block) => ({
        ...block,
        row: block.column,
        column: block.row,
        values: block.values[0]!.map((_, col) => block.values.map((row) => row[col]!)),
        ...(block.formats
          ? { formats: block.formats[0]!.map((_, col) => block.formats!.map((row) => row[col]!)) }
          : {}),
      }));
    const ranges = dependencies
      .displaySelectionRanges()
      .sort((a, b) => a.startRow - b.startRow || a.startColumn - b.startColumn);
    if (!ranges.length) return;
    const cut = move ? context.pendingCut : undefined;
    if (move && !cut) throw new Error('No pending cut.');
    if (cut) {
      if (blocks.length !== cut.blockCount || (ranges.length > 1 && ranges.length !== blocks.length))
        throw new Error('Cut requires matching destination ranges.');
      if (
        cut.columnKeys.length !== context.columns.length ||
        cut.columnKeys.some((key, index) => key !== context.columns[index]!.key)
      )
        throw new Error('Columns changed after cut. Cut again.');
      for (const cell of cut.cells) {
        if (
          cell.rowIndex >= context.rowCount ||
          context.dataSource.getRowId(cell.rowIndex) !== cell.rowId ||
          !Object.is(context.dataSource.getValue(cell.rowIndex, cell.columnKey), cell.value)
        )
          throw new Error('Cut source changed. Cut again.');
        dependencies.requirePermission(cell.rowIndex, context.columnIndices.get(cell.columnKey)!, 'writable');
      }
    }
    const broadcast =
      !move && blocks.length === 1 && blocks[0]!.values.length === 1 && blocks[0]!.values[0]!.length === 1;
    if (structured && !broadcast && ranges.length > 1 && ranges.length !== blocks.length)
      throw new Error('Clipboard and target range counts must match.');
    const placements: (ClipboardBlock & { col: number; height?: number; width?: number })[] = broadcast
      ? ranges.map((range) => ({
          ...blocks[0]!,
          row: range.startRow,
          col: range.startColumn,
          height: range.endRow - range.startRow + 1,
          width: range.endColumn - range.startColumn + 1,
        }))
      : structured
        ? ranges.length === 1
          ? blocks.map((block) => ({
              ...block,
              row: ranges[0]!.startRow + block.row,
              col: ranges[0]!.startColumn + block.column,
            }))
          : blocks.map((block, i) => ({ ...block, row: ranges[i]!.startRow, col: ranges[i]!.startColumn }))
        : ranges.map((range) => ({ ...blocks[0]!, row: range.startRow, col: range.startColumn }));
    let cells = 0;
    const texts = new Map<
      string,
      { rowIndex: number; columnKey: string; columnIndex: number; text: string; format?: CellFormat }
    >();
    let completed = 0;
    for (const place of placements) {
      const height = place.height ?? place.values.length,
        width = place.width ?? place.values[0]!.length;
      cells += height * width;
      if (cells > clipboardCellLimit) throw new RangeError('Paste has too many cells.');
      if (place.row + height > dependencies.visibleRowCount() || place.col + width > context.columns.length)
        throw new RangeError('Paste extends beyond grid bounds.');
      for (let row = 0; row < height; row++)
        for (let col = 0; col < width; col++) {
          const rowIndex = dependencies.sourceRow(place.row + row),
            columnIndex = place.col + col,
            columnKey = context.columns[columnIndex]!.key,
            text = place.values[broadcast ? 0 : row]![broadcast ? 0 : col]!,
            key = `${rowIndex}:${columnKey}`,
            previous = texts.get(key);
          if (options.skipEmpty && text === '') continue;
          const span = dependencies.mergeAt(rowIndex, columnIndex);
          if (span && (rowIndex !== span.startRow || columnIndex !== span.startColumn)) {
            if (mode !== 'formats' && text !== '')
              throw new Error('Paste would overwrite a hidden merged value. Unmerge first.');
            continue;
          }
          if (previous && previous.text !== text)
            throw new Error('Overlapping paste targets contain conflicting values.');
          const format = mode === 'values' ? undefined : place.formats?.[broadcast ? 0 : row]?.[broadcast ? 0 : col];
          if (previous && JSON.stringify(previous.format) !== JSON.stringify(format))
            throw new Error('Overlapping paste targets contain conflicting formats.');
          texts.set(key, { rowIndex, columnKey, columnIndex, text, ...(format ? { format } : {}) });
          if (cooperative && ++completed % 256 === 0) yield { phase: 'prepare', completed, total: cells };
        }
    }
    completed = 0;
    for (const cell of texts.values()) {
      if (mode !== 'formats') dependencies.requirePermission(cell.rowIndex, cell.columnIndex, 'pasteable');
      if (cell.format && Object.keys(cell.format).length)
        dependencies.requireFormatPermission({
          startRow: cell.rowIndex,
          endRow: cell.rowIndex,
          startColumn: cell.columnIndex,
          endColumn: cell.columnIndex,
        });
      if (cooperative && ++completed % 256 === 0) yield { phase: 'validate', completed, total: texts.size };
    }
    const updates: CellUpdate[] = [];
    completed = 0;
    if (mode !== 'formats')
      for (const cell of texts.values()) {
        const column = context.columns[cell.columnIndex]!,
          current = context.dataSource.getValue(cell.rowIndex, column.key);
        if (!column.parse && current != null && typeof current !== 'string')
          throw new Error('Column requires a parser: ' + column.key);
        updates.push({
          rowIndex: cell.rowIndex,
          columnKey: column.key,
          value: column.parse ? column.parse(cell.text) : cell.text,
        });
        if (cooperative && ++completed % 256 === 0) yield { phase: 'prepare', completed, total: texts.size };
      }
    if (cut)
      for (const cell of cut.cells)
        if (!texts.has(`${cell.rowIndex}:${cell.columnKey}`))
          updates.push({ rowIndex: cell.rowIndex, columnKey: cell.columnKey, value: null });
    const formatChanges: FormatChange[] = [];
    for (const cell of texts.values())
      if (cell.format && Object.keys(cell.format).length) {
        const bounds = {
          startRow: cell.rowIndex,
          endRow: cell.rowIndex,
          startColumn: cell.columnIndex,
          endColumn: cell.columnIndex,
        };
        dependencies.requireFormatPermission(bounds);
        const target = { scope: 'cell' as const, rowIndex: cell.rowIndex, columnIndex: cell.columnIndex };
        const key = JSON.stringify(['cell', cell.rowIndex, cell.rowIndex, cell.columnIndex, cell.columnIndex]);
        const previous = context.formats.get(key),
          orders = { ...previous?.orders };
        for (const property of Object.keys(cell.format) as (keyof CellFormat)[])
          orders[property] = ++context.formatOrder;
        formatChanges.push({
          key,
          previous,
          value: {
            target,
            bounds: Object.freeze(bounds),
            patch: Object.freeze({ ...previous?.patch, ...cell.format }),
            orders: Object.freeze(orders),
            order: context.formatOrder,
          },
        });
      }
    const previousProjection = context.projection;
    if (cooperative) {
      yield* dependencies.applyUpdatesSteps(
        updates,
        'paste',
        formatChanges,
        true,
        function* () {
          // Paste authority can change while the host scheduler runs.
          let checked = 0;
          for (const cell of texts.values()) {
            if (mode !== 'formats') dependencies.requirePermission(cell.rowIndex, cell.columnIndex, 'pasteable');
            if (guarded && ++checked % 256 === 0) yield { phase: 'validate', completed: checked, total: texts.size };
          }
        },
        guarded,
      );
    } else dependencies.applyUpdates(updates, 'paste', formatChanges);
    if (move) context.pendingCut = undefined;
    // Existing source selection follows its records if pasted values reorder or filter the view.
    if (
      previousProjection?.length !== context.projection?.length ||
      previousProjection?.some((row, index) => row !== context.projection?.[index])
    )
      return;
    const targets = placements.map((place) => ({
      startRow: place.row,
      endRow: place.row + (place.height ?? place.values.length) - 1,
      startColumn: place.col,
      endColumn: place.col + (place.width ?? place.values[0]!.length) - 1,
    }));
    if (targets.length <= 128 && targets.every((range) => range.endRow < dependencies.visibleRowCount()))
      targets.forEach((range, index) =>
        !context.projection && context.activeParts === 1
          ? dependencies.selectRange(range, index === 0 ? 'replace' : 'add')
          : dependencies.selectDisplayRange(range, index === 0 ? 'replace' : 'add'),
      );
  }
  function pasteBlocks(
    blocks: readonly ClipboardBlock[],
    structured: boolean,
    move = false,
    options: PasteOptions = {},
  ): void {
    drain(pasteBlocksSteps(blocks, structured, move, options));
  }
  function* pasteSteps(
    text: string,
    options?: PasteOptions,
    guarded = false,
    decoded?: () => unknown,
  ): BulkSteps<void> {
    const values = decoded ? yield* validateTsvSteps(decoded()) : yield* decodeTsvSteps(text, true);
    yield* pasteBlocksSteps([{ row: 0, column: 0, values }], false, false, options, true, guarded);
  }
  function paste(text: string, options?: PasteOptions): void {
    pasteBlocks([{ row: 0, column: 0, values: decodeTsv(text) }], false, false, options);
  }
  function canPaste(): boolean {
    const range = dependencies.getSelectionRange();
    return (
      !context.destroyed &&
      !!range &&
      !!(context.dataSource.setValue || context.dataSource.setValues) &&
      dependencies.getCellPermission(range.startRow, range.startColumn).pasteable
    );
  }
  return { clipboardBlocks, copySelection, cutSelectionBlocks, pasteBlocks, paste, pasteSteps, canPaste };
}

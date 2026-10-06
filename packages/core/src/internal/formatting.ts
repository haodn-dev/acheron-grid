import type { GridInvalidation } from '../engine.js';
import type { GridEvent } from '../events.js';
import type { CellPermission } from '../permissions.js';
import { resolvePermissions } from '../permissions.js';
import type { CellFormat, CellFormatPatch, CellFormatTarget, CellLockTarget, SelectionRange } from '../types.js';
import type { EngineContext, FormatChange } from './engine-context.js';
export function createFormatting(
  context: Pick<
    EngineContext,
    | 'rowCount'
    | 'columns'
    | 'permissions'
    | 'resolver'
    | 'destroyed'
    | 'orderedFormats'
    | 'emptyFormat'
    | 'formats'
    | 'formatOrder'
    | 'past'
    | 'future'
  >,
  dependencies: {
    validateLockTarget: (target: CellLockTarget) => void;
    requirePermission: (rowIndex: number, columnIndex: number, key: keyof CellPermission) => void;
    assertAlive: () => void;
    notify: (change: GridInvalidation, event: GridEvent) => void;
  },
) {
  function formatBounds(target: CellFormatTarget): SelectionRange {
    if (target.scope !== 'range') {
      dependencies.validateLockTarget(target);
      return {
        startRow: target.scope === 'row' || target.scope === 'cell' ? target.rowIndex : 0,
        endRow: target.scope === 'row' || target.scope === 'cell' ? target.rowIndex : context.rowCount - 1,
        startColumn: target.scope === 'column' || target.scope === 'cell' ? target.columnIndex : 0,
        endColumn:
          target.scope === 'column' || target.scope === 'cell' ? target.columnIndex : context.columns.length - 1,
      };
    }
    const range = target.range;
    if (
      !range ||
      ![range.startRow, range.endRow, range.startColumn, range.endColumn].every(Number.isSafeInteger) ||
      range.startRow < 0 ||
      range.endRow < range.startRow ||
      range.endRow >= context.rowCount ||
      range.startColumn < 0 ||
      range.endColumn < range.startColumn ||
      range.endColumn >= context.columns.length
    )
      throw new RangeError('Invalid formatting range.');
    return {
      startRow: range.startRow,
      endRow: range.endRow,
      startColumn: range.startColumn,
      endColumn: range.endColumn,
    };
  }
  function requireFormatPermission(bounds: SelectionRange): void {
    if (context.permissions?.formatting === false) throw new Error('Cell does not permit formatting.');
    if (!context.resolver) {
      for (let col = bounds.startColumn; col <= bounds.endColumn; col++)
        if (
          !resolvePermissions(
            context.columns[col]!.editable ?? false,
            context.permissions,
            context.columns[col]!.permissions,
          ).formatting
        )
          throw new Error('Cell does not permit formatting.');
    } else
      for (let row = bounds.startRow; row <= bounds.endRow; row++)
        for (let col = bounds.startColumn; col <= bounds.endColumn; col++)
          dependencies.requirePermission(row, col, 'formatting');
  }
  function canFormat(targets: readonly CellFormatTarget[]): boolean {
    if (context.destroyed) return false;
    const bounds = targets.map(formatBounds);
    try {
      for (const range of bounds) requireFormatPermission(range);
      return bounds.length > 0;
    } catch {
      return false;
    }
  }
  function getFormat(rowIndex: number, columnIndex: number): Readonly<CellFormat> {
    dependencies.assertAlive();
    dependencies.validateLockTarget({ scope: 'cell', rowIndex, columnIndex });
    if (!context.orderedFormats.length) return context.emptyFormat;
    const result: Record<string, string> = {};
    const orders = { background: 0, textColor: 0, contentFormat: 0, fontWeight: 0, fontStyle: 0, numberFormat: 0 };
    // Scan sparse overlays; index regions if large formatting sets become costly.
    for (const entry of context.orderedFormats) {
      const range = entry.bounds;
      if (
        rowIndex < range.startRow ||
        rowIndex > range.endRow ||
        columnIndex < range.startColumn ||
        columnIndex > range.endColumn
      )
        continue;
      for (const key of [
        'background',
        'textColor',
        'contentFormat',
        'fontWeight',
        'fontStyle',
        'numberFormat',
      ] as const) {
        if ((entry.orders[key] ?? 0) <= orders[key]) continue;
        orders[key] = entry.orders[key]!;
        const value = entry.patch[key];
        if (value === null) delete result[key];
        else if (value !== undefined) result[key] = value;
      }
    }
    return Object.freeze(result);
  }
  function writeFormats(changes: readonly FormatChange[]): void {
    for (const change of changes) {
      if (change.value) context.formats.set(change.key, change.value);
      else context.formats.delete(change.key);
    }
    context.orderedFormats = [...context.formats.values()].sort((a, b) => a.order - b.order);
  }
  function notifyFormats(changes: readonly FormatChange[], source: 'api' | 'paste' | 'undo' | 'redo'): void {
    dependencies.notify(
      { type: 'layout' },
      Object.freeze({
        type: 'format:change',
        source,
        changes: Object.freeze(
          changes.map((change) =>
            Object.freeze({
              target: (change.value ?? change.previous)!.target,
              previous: change.previous?.patch ?? null,
              value: change.value?.patch ?? null,
            }),
          ),
        ),
      }),
    );
  }
  function format(targets: readonly CellFormatTarget[], patch: CellFormatPatch | null): void {
    dependencies.assertAlive();
    if (patch !== null) {
      if (!patch || typeof patch !== 'object') throw new TypeError('Invalid formatting patch.');
      patch = Object.freeze({ ...patch });
      for (const [key, value] of Object.entries(patch))
        if (
          !['contentFormat', 'background', 'textColor', 'fontWeight', 'fontStyle', 'numberFormat'].includes(key) ||
          (value !== null &&
            (key === 'numberFormat'
              ? !['decimal', 'integer', 'percent', 'currency'].includes(value)
              : key === 'fontWeight'
                ? !['normal', 'bold'].includes(value)
                : key === 'fontStyle'
                  ? !['normal', 'italic'].includes(value)
                  : key === 'contentFormat'
                    ? !['plain', 'html', 'markdown'].includes(value)
                    : typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)))
        )
          throw new TypeError('Invalid cell format.');
      if (!Object.keys(patch).length) return;
    }
    const unique = new Map<string, { target: CellFormatTarget; bounds: SelectionRange }>();
    for (const target of targets) {
      const bounds = formatBounds(target);
      if (bounds.endRow < bounds.startRow || bounds.endColumn < bounds.startColumn) continue;
      const snapshot = Object.freeze(
        target.scope === 'range' ? { scope: 'range' as const, range: Object.freeze({ ...bounds }) } : { ...target },
      );
      unique.set(JSON.stringify([target.scope, bounds.startRow, bounds.endRow, bounds.startColumn, bounds.endColumn]), {
        target: snapshot,
        bounds,
      });
    }
    for (const entry of unique.values()) requireFormatPermission(entry.bounds);
    const changes: FormatChange[] = [];
    for (const [key, entry] of unique) {
      const previous = context.formats.get(key);
      const nextPatch = patch === null ? undefined : Object.freeze({ ...previous?.patch, ...patch });
      if (
        (!previous && !nextPatch) ||
        (previous &&
          previous === context.orderedFormats.at(-1) &&
          JSON.stringify(previous.patch) === JSON.stringify(nextPatch))
      )
        continue;
      const orders = { ...previous?.orders };
      if (patch)
        for (const key of [
          'background',
          'textColor',
          'contentFormat',
          'fontWeight',
          'fontStyle',
          'numberFormat',
        ] as const)
          if (patch[key] !== undefined) orders[key] = ++context.formatOrder;
      changes.push({
        key,
        previous,
        value: nextPatch
          ? {
              ...entry,
              bounds: Object.freeze(entry.bounds),
              patch: nextPatch,
              orders: Object.freeze(orders),
              order: context.formatOrder,
            }
          : undefined,
      });
    }
    if (!changes.length) return;
    writeFormats(changes);
    context.past.push({ kind: 'format', changes });
    if (context.past.length > 100) context.past.shift();
    context.future.length = 0;
    notifyFormats(changes, 'api');
  }
  return { formatBounds, requireFormatPermission, canFormat, getFormat, writeFormats, notifyFormats, format };
}

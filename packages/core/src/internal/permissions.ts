import type { GridInvalidation } from '../engine.js';
import type { GridEvent } from '../events.js';
import type { CellPermission } from '../permissions.js';
import { resolvePermissions } from '../permissions.js';
import type { CellLockTarget, SelectionRange } from '../types.js';
import type { EngineContext } from './engine-context.js';
export function createPermissions(
  context: Pick<
    EngineContext,
    | 'rowCount'
    | 'columns'
    | 'dataSource'
    | 'permissions'
    | 'resolver'
    | 'tableLocked'
    | 'lockedRows'
    | 'lockedColumns'
    | 'lockedCells'
    | 'allowLockChanges'
  >,
  dependencies: {
    assertAlive: () => void;
    query: <T>(run: () => T) => T;
    mergeAt: (row: number, col: number) => Readonly<SelectionRange> | undefined;
    notify: (change: GridInvalidation, event: GridEvent) => void;
  },
) {
  function getCellPermission(rowIndex: number, columnIndex: number): CellPermission {
    dependencies.assertAlive();
    if (
      !Number.isSafeInteger(rowIndex) ||
      rowIndex < 0 ||
      rowIndex >= context.rowCount ||
      !Number.isSafeInteger(columnIndex) ||
      columnIndex < 0 ||
      columnIndex >= context.columns.length
    )
      throw new RangeError('Invalid cell position.');
    const column = context.columns[columnIndex]!;
    return dependencies.query(() => {
      const cell = Object.freeze({
        rowIndex,
        rowId: context.dataSource.getRowId(rowIndex),
        columnIndex,
        columnKey: column.key,
      });
      return resolvePermissions(
        column.editable ?? false,
        context.permissions,
        column.permissions,
        context.resolver?.(cell),
        context.tableLocked ||
          context.lockedRows.has(rowIndex) ||
          context.lockedColumns.has(columnIndex) ||
          context.lockedCells.has(`${rowIndex}:${columnIndex}`)
          ? { writable: false }
          : undefined,
      );
    });
  }
  function requirePermission(rowIndex: number, columnIndex: number, key: keyof CellPermission): void {
    if (!getCellPermission(rowIndex, columnIndex)[key])
      throw new Error(`Cell is read-only or permission denied: ${key}.`);
    const span = dependencies.mergeAt(rowIndex, columnIndex);
    if (
      span &&
      rowIndex === span.startRow &&
      columnIndex === span.startColumn &&
      (key === 'writable' || key === 'pasteable')
    ) {
      for (let row = span.startRow; row <= span.endRow; row++)
        for (let col = span.startColumn; col <= span.endColumn; col++)
          if (!getCellPermission(row, col).writable)
            throw new Error('Merged cell contains a locked or read-only cell.');
    }
  }
  function validateLockTarget(target: CellLockTarget): void {
    if (!target || !['table', 'row', 'column', 'cell'].includes(target.scope))
      throw new TypeError('Invalid lock scope.');
    if (
      (target.scope === 'row' || target.scope === 'cell') &&
      (!Number.isSafeInteger(target.rowIndex) || target.rowIndex < 0 || target.rowIndex >= context.rowCount)
    )
      throw new RangeError('Invalid lock row.');
    if (
      (target.scope === 'column' || target.scope === 'cell') &&
      (!Number.isSafeInteger(target.columnIndex) ||
        target.columnIndex < 0 ||
        target.columnIndex >= context.columns.length)
    )
      throw new RangeError('Invalid lock column.');
  }
  function isLocked(target: CellLockTarget): boolean {
    dependencies.assertAlive();
    validateLockTarget(target);
    if (target.scope === 'table') return context.tableLocked;
    if (target.scope === 'row') return context.lockedRows.has(target.rowIndex);
    if (target.scope === 'column') return context.lockedColumns.has(target.columnIndex);
    return context.lockedCells.has(`${target.rowIndex}:${target.columnIndex}`);
  }
  function setLocked(target: CellLockTarget, locked: boolean): void {
    dependencies.assertAlive();
    if (!context.allowLockChanges) throw new Error('Lock management is disabled.');
    if (typeof locked !== 'boolean') throw new TypeError('Lock state must be boolean.');
    if (isLocked(target) === locked) return;
    if (target.scope === 'table') context.tableLocked = locked;
    else if (target.scope === 'row') {
      if (locked) context.lockedRows.add(target.rowIndex);
      else context.lockedRows.delete(target.rowIndex);
    } else if (target.scope === 'column') {
      if (locked) context.lockedColumns.add(target.columnIndex);
      else context.lockedColumns.delete(target.columnIndex);
    } else {
      const key = `${target.rowIndex}:${target.columnIndex}`;
      if (locked) context.lockedCells.add(key);
      else context.lockedCells.delete(key);
    }
    dependencies.notify(
      { type: 'layout' },
      Object.freeze({ type: 'lock:change', target: Object.freeze({ ...target }), locked }),
    );
  }
  return { getCellPermission, requirePermission, validateLockTarget, isLocked, setLocked };
}

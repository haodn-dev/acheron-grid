import type { CellUpdate } from '../data-source.js';
import type { GridInvalidation } from '../engine.js';
import type { GridChangeSource, GridEvent } from '../events.js';
import type { CellPermission } from '../permissions.js';
import type { LayoutRequest, SelectionRange } from '../types.js';
import type { Change, EngineContext, FormatChange, HistoryCommand } from './engine-context.js';
import { drain } from './bulk.js';
import type { BulkSteps } from './bulk.js';
export function createHistory(
  context: Pick<
    EngineContext,
    | 'destroyed'
    | 'future'
    | 'past'
    | 'view'
    | 'frozenRows'
    | 'projection'
    | 'rowCount'
    | 'merges'
    | 'groups'
    | 'rowAxis'
    | 'columnAxis'
    | 'manualRows'
    | 'frozenColumns'
    | 'formats'
    | 'dataSource'
    | 'columnIndices'
  >,
  dependencies: {
    changeVisibility: (
      axis: 'row' | 'column',
      indices: readonly number[],
      hidden: boolean,
      history?: boolean,
      source?: 'api' | 'undo' | 'redo',
    ) => void;
    layoutAllowed: (request: LayoutRequest) => boolean;
    validateMergeFreeze: (spans: readonly Readonly<SelectionRange>[], rows?: number, cols?: number) => void;
    notifyOutline: (kind: 'merge' | 'group', old: readonly number[], source: 'api' | 'undo' | 'redo') => void;
    replayStructure: (entry: Extract<HistoryCommand, { kind: 'structure' }>, redo: boolean) => void;
    notifyStructure: (
      entry: Extract<HistoryCommand, { kind: 'structure' }>,
      redo: boolean,
      source: 'api' | 'undo' | 'redo',
    ) => void;
    notify: (change: GridInvalidation, event: GridEvent) => void;
    requireFormatPermission: (bounds: SelectionRange) => void;
    writeFormats: (changes: readonly FormatChange[]) => void;
    notifyFormats: (changes: readonly FormatChange[], source: 'api' | 'paste' | 'undo' | 'redo') => void;
    requirePermission: (rowIndex: number, columnIndex: number, key: keyof CellPermission) => void;
    write: (changes: readonly CellUpdate[]) => void;
    notifyCells: (changes: readonly Change[], source: GridChangeSource) => void;
  },
) {
  function* replaySteps(redo: boolean, cooperative = false): BulkSteps<boolean> {
    if (context.destroyed) return false;
    const from = redo ? context.future : context.past;
    const to = redo ? context.past : context.future;
    const entry = from.at(-1);
    if (!entry) return false;
    if (entry.kind === 'visibility') {
      dependencies.changeVisibility(
        entry.axis,
        entry.indices,
        redo ? entry.hidden : !entry.hidden,
        false,
        redo ? 'redo' : 'undo',
      );
      from.pop();
      to.push(entry);
      return true;
    }
    if (entry.kind === 'outline') {
      const requests = entry.requests.map((request) =>
        redo
          ? request
          : 'range' in request
            ? { ...request, kind: request.kind === 'merge' ? ('unmerge' as const) : ('merge' as const) }
            : {
                ...request,
                kind: ({ group: 'ungroup', ungroup: 'group', collapse: 'expand', expand: 'collapse' } as const)[
                  request.kind
                ],
              },
      );
      if (requests.some((request) => !dependencies.layoutAllowed(request)))
        throw new Error('Changing merged cells or row groups is disabled.');
      const nextMerges = redo ? entry.afterMerges : entry.beforeMerges,
        nextGroups = redo ? entry.afterGroups : entry.beforeGroups;
      if (
        (nextMerges.length || nextGroups.length) &&
        (context.view.sort || context.view.sorts?.length || context.view.filters?.length)
      )
        throw new Error('Clear sort and filters before restoring merged cells or row groups.');
      dependencies.validateMergeFreeze(nextMerges);
      if (
        nextGroups.some(
          (group) => group.collapsed && group.startRow < context.frozenRows && group.endRow >= context.frozenRows,
        )
      )
        throw new Error('A collapsed group cannot cross a frozen boundary.');
      const old = context.projection ?? Array.from({ length: context.rowCount }, (_, i) => i);
      context.merges = [...nextMerges];
      context.groups = [...nextGroups];
      from.pop();
      to.push(entry);
      dependencies.notifyOutline('range' in entry.requests[0]! ? 'merge' : 'group', old, redo ? 'redo' : 'undo');
      return true;
    }
    if (entry.kind === 'structure') {
      dependencies.replayStructure(entry, redo);
      from.pop();
      to.push(entry);
      dependencies.notifyStructure(entry, redo, redo ? 'redo' : 'undo');
      return true;
    }
    if (entry.kind === 'resize') {
      const axis = entry.axis === 'row' ? context.rowAxis : context.columnAxis;
      if (
        (entry.axis !== 'row' || context.manualRows.has(entry.index)) &&
        axis.storedSize(entry.index) !== (redo ? entry.previous : entry.size)
      )
        throw new Error('Layout history conflicts with external changes.');
      axis.setSize(entry.index, redo ? entry.size : entry.previous);
      if (entry.axis === 'row') {
        if (redo || entry.previousManual) context.manualRows.add(entry.index);
        else context.manualRows.delete(entry.index);
      }
      from.pop();
      to.push(entry);
      dependencies.notify(
        { type: 'layout' },
        Object.freeze({
          type: entry.axis === 'row' ? 'row:resize' : 'column:resize',
          index: entry.index,
          previous: redo ? entry.previous : entry.size,
          size: redo ? entry.size : entry.previous,
        }),
      );
      return true;
    }
    if (entry.kind === 'freeze') {
      if (
        context.frozenRows !== (redo ? entry.previousRows : entry.rows) ||
        context.frozenColumns !== (redo ? entry.previousColumns : entry.columns)
      )
        throw new Error('Frozen history conflicts with external changes.');
      const previousRows = context.frozenRows,
        previousColumns = context.frozenColumns;
      dependencies.validateMergeFreeze(
        context.merges,
        redo ? entry.rows : entry.previousRows,
        redo ? entry.columns : entry.previousColumns,
      );
      if (
        context.groups.some(
          (group) =>
            group.collapsed &&
            group.startRow < (redo ? entry.rows : entry.previousRows) &&
            group.endRow >= (redo ? entry.rows : entry.previousRows),
        )
      )
        throw new Error('A collapsed group cannot cross a frozen boundary.');
      context.frozenRows = redo ? entry.rows : entry.previousRows;
      context.frozenColumns = redo ? entry.columns : entry.previousColumns;
      from.pop();
      to.push(entry);
      dependencies.notify(
        { type: 'layout' },
        Object.freeze({
          type: 'freeze:change',
          previousRows,
          previousColumns,
          rows: context.frozenRows,
          columns: context.frozenColumns,
        }),
      );
      return true;
    }
    if (entry.kind === 'format') {
      for (const change of entry.changes) {
        if (context.formats.get(change.key) !== (redo ? change.previous : change.value))
          throw new Error('Formatting history conflicts with external changes.');
        dependencies.requireFormatPermission((change.value ?? change.previous)!.bounds);
      }
      const changes = entry.changes.map((change) => ({
        ...change,
        previous: redo ? change.previous : change.value,
        value: redo ? change.value : change.previous,
      }));
      dependencies.writeFormats(changes);
      from.pop();
      to.push(entry);
      dependencies.notifyFormats(changes, redo ? 'redo' : 'undo');
      return true;
    }
    const changes = entry.changes;
    for (const change of entry.formats ?? []) {
      if (context.formats.get(change.key) !== (redo ? change.previous : change.value))
        throw new Error('Formatting history conflicts with external changes.');
      dependencies.requireFormatPermission((change.value ?? change.previous)!.bounds);
    }
    let completed = 0;
    for (const change of changes) {
      if (
        context.dataSource.getRowId(change.rowIndex) !== change.rowId ||
        !Object.is(
          context.dataSource.getValue(change.rowIndex, change.columnKey),
          redo ? change.previous : change.value,
        )
      ) {
        throw new Error('History conflicts with external data changes.');
      }
      if (cooperative && ++completed % 256 === 0) yield { phase: 'validate', completed, total: changes.length };
    }
    for (const change of changes)
      dependencies.requirePermission(change.rowIndex, context.columnIndices.get(change.columnKey)!, 'writable');
    const updates: Change[] = [];
    completed = 0;
    for (const change of changes) {
      updates.push({
        ...change,
        previous: redo ? change.previous : change.value,
        value: redo ? change.value : change.previous,
      });
      if (cooperative && ++completed % 256 === 0) yield { phase: 'prepare', completed, total: changes.length };
    }
    if (cooperative)
      for (const change of changes) {
        if (
          context.dataSource.getRowId(change.rowIndex) !== change.rowId ||
          !Object.is(
            context.dataSource.getValue(change.rowIndex, change.columnKey),
            redo ? change.previous : change.value,
          )
        )
          throw new Error('History conflicts with external data changes.');
        dependencies.requirePermission(change.rowIndex, context.columnIndices.get(change.columnKey)!, 'writable');
      }
    if (updates.length) dependencies.write(updates);
    const formatChanges = (entry.formats ?? []).map((change) => ({
      ...change,
      previous: redo ? change.previous : change.value,
      value: redo ? change.value : change.previous,
    }));
    dependencies.writeFormats(formatChanges);
    from.pop();
    to.push(entry);
    if (updates.length) dependencies.notifyCells(updates, redo ? 'redo' : 'undo');
    if (formatChanges.length) dependencies.notifyFormats(formatChanges, redo ? 'redo' : 'undo');
    return true;
  }
  function replay(redo: boolean): boolean {
    return drain(replaySteps(redo));
  }
  return { replay, replaySteps };
}

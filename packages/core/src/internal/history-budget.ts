import type { HistoryCommand } from './engine-context.js';
export interface GridHistoryLimits {
  readonly maxCommands?: number;
  /** Retained value/format change records, not an estimate of JavaScript heap bytes. */
  readonly maxValueCells?: number;
}
type Context = { past: HistoryCommand[]; readonly historyLimits?: GridHistoryLimits };
function cells(entry: HistoryCommand): number {
  return entry.kind === 'values'
    ? entry.changes.length + (entry.formats?.length ?? 0)
    : entry.kind === 'format'
      ? entry.changes.length
      : 0;
}
export function assertHistoryCapacity(context: Context, entry: HistoryCommand): void {
  if (cells(entry) > (context.historyLimits?.maxValueCells ?? Infinity))
    throw new RangeError('Command exceeds the history value-cell budget.');
}
export function recordHistory(context: Context, entry: HistoryCommand): void {
  context.past.push(entry);
  const maxCommands = context.historyLimits?.maxCommands ?? 100;
  const maxCells = context.historyLimits?.maxValueCells ?? Infinity;
  let retained = maxCells === Infinity ? 0 : context.past.reduce((sum, item) => sum + cells(item), 0);
  while (context.past.length > maxCommands || retained > maxCells) retained -= cells(context.past.shift()!);
}

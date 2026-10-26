import type { DataSource, RowId } from '../data-source.js';
import type { BulkSteps } from './bulk.js';
import { snapshotLocalView } from '../data-source.js';
import type { LocalViewOptions } from '../data-source.js';
import { localViewSteps } from './local-view-steps.js';

export interface LocalTreeOptions {
  readonly parentColumnKey: string;
}
export interface TreeState {
  readonly version: 1;
  readonly tree: Readonly<LocalTreeOptions> | null;
  readonly collapsedIds: readonly RowId[];
}

export interface LocalTreeRow {
  readonly sourceIndex: number;
  readonly rowId: RowId;
  readonly parentId: RowId | null;
  readonly level: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
}

const validId = (value: unknown): value is RowId =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

/** Validates a complete local forest before returning its visible, source-ordered preorder. */
export function* localTreeRowsSteps(
  source: DataSource,
  columnKeys: readonly string[],
  parentColumnKey: string,
  collapsedIds: readonly RowId[] = [],
  view: LocalViewOptions = {},
  cooperative = false,
): BulkSteps<readonly LocalTreeRow[]> {
  const criteria = snapshotLocalView(view);
  const count = source.getRowCount();
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid tree source count.');
  if (
    !Array.isArray(columnKeys) ||
    Array.from(columnKeys).some((key) => typeof key !== 'string' || !key) ||
    new Set(columnKeys).size !== columnKeys.length ||
    typeof parentColumnKey !== 'string' ||
    !columnKeys.includes(parentColumnKey) ||
    !Array.isArray(collapsedIds)
  )
    throw new TypeError('Invalid tree criteria.');
  const collapsed = new Set(collapsedIds);
  if (Array.from(collapsedIds).some((id) => !validId(id)) || collapsed.size !== collapsedIds.length)
    throw new TypeError('Invalid or duplicate collapsed tree ID.');

  const ids: RowId[] = [],
    parents: (RowId | null)[] = [],
    positions = new Map<RowId, number>(),
    children: number[][] = Array.from({ length: count }, () => []),
    roots: number[] = [];
  for (let index = 0; index < count; index++) {
    const id = source.getRowId(index),
      parent = source.getValue(index, parentColumnKey);
    if (!validId(id) || positions.has(id)) throw new TypeError('Invalid or duplicate tree row ID.');
    if (parent != null && !validId(parent)) throw new TypeError('Invalid tree parent ID.');
    positions.set(id, index);
    ids.push(id);
    parents.push(parent == null ? null : parent);
    if ((index + 1) % 256 === 0) yield { phase: 'prepare', completed: index + 1, total: count };
  }
  for (const id of collapsed) if (!positions.has(id)) throw new TypeError('Unknown collapsed tree ID.');
  for (let index = 0; index < count; index++) {
    const parent = parents[index]!;
    if (parent === null) roots.push(index);
    else {
      const parentIndex = positions.get(parent);
      if (parentIndex === undefined) throw new TypeError('Unknown tree parent ID.');
      if (parentIndex === index) throw new TypeError('A tree row cannot parent itself.');
      children[parentIndex]!.push(index);
    }
    if ((index + 1) % 256 === 0) yield { phase: 'validate', completed: index + 1, total: count };
  }

  const retained = criteria.filters?.length
    ? new Set(yield* localViewSteps(source, { filters: criteria.filters }, cooperative))
    : null;
  if (retained)
    for (const index of retained) {
      let parent = parents[index]!;
      while (parent !== null) {
        const ancestor = positions.get(parent)!;
        if (retained.has(ancestor)) break;
        retained.add(ancestor);
        parent = parents[ancestor]!;
      }
    }
  if (criteria.sort || criteria.sorts?.length)
    for (const siblings of [roots, ...children]) {
      if (siblings.length < 2) continue;
      const order = yield* localViewSteps(
        {
          getRowCount: () => siblings.length,
          getRowId: (i) => ids[siblings[i]!]!,
          getValue: (i, key) => source.getValue(siblings[i]!, key),
        },
        { ...(criteria.sort ? { sort: criteria.sort } : {}), ...(criteria.sorts ? { sorts: criteria.sorts } : {}) },
        cooperative,
      );
      const sorted = order.map((i) => siblings[i]!);
      for (let i = 0; i < sorted.length; i++) siblings[i] = sorted[i]!;
    }
  const rows: LocalTreeRow[] = [];
  const stack = [{ siblings: roots, next: 0, level: 1, visible: true }];
  let visited = 0;
  while (stack.length) {
    const frame = stack[stack.length - 1]!;
    if (frame.next === frame.siblings.length) {
      stack.pop();
      continue;
    }
    const index = frame.siblings[frame.next++]!,
      rowId = ids[index]!,
      descendants = children[index]!,
      hasChildren = descendants.some((child) => !retained || retained.has(child)),
      expanded = hasChildren && !collapsed.has(rowId);
    // Bound pathological ancestry independently of expansion; traversal never uses the JS call stack.
    if (frame.level > 4096) throw new RangeError('Tree depth exceeds 4096 levels.');
    if (frame.visible && (!retained || retained.has(index)))
      rows.push(
        Object.freeze({
          sourceIndex: index,
          rowId,
          parentId: parents[index]!,
          level: frame.level,
          hasChildren,
          expanded,
        }),
      );
    visited++;
    if (descendants.length)
      stack.push({ siblings: descendants, next: 0, level: frame.level + 1, visible: frame.visible && expanded });
    if (visited % 256 === 0) yield { phase: 'validate', completed: visited, total: count };
  }
  // Each record has at most one parent: anything unreachable from roots belongs to a cyclic component.
  if (visited !== count) throw new TypeError('Tree parent relationships contain a cycle.');
  yield { phase: 'validate', completed: count, total: count };
  return Object.freeze(rows);
}

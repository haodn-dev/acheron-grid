import type { Column } from '@acheron-grid/core';

export interface HeaderGroup {
  readonly title: string;
  readonly children: readonly (string | HeaderGroup)[];
}
export interface HeaderCell {
  readonly title: string;
  readonly start: number;
  readonly end: number;
  readonly level: number;
  readonly rowSpan: number;
  readonly leaf: boolean;
}
export function headerLayout(
  columns: readonly Column[],
  groups: readonly HeaderGroup[] = [],
): { levels: number; cells: HeaderCell[] } {
  const indices = new Map(columns.map((column, index) => [column.key, index]));
  const used = new Set<number>();
  const cells: HeaderCell[] = [];
  let levels = 1;
  function visit(item: string | HeaderGroup, level: number): { start: number; end: number } {
    if (level >= 16) throw new RangeError('Header groups support at most 16 levels.');
    if (typeof item === 'string') {
      const index = indices.get(item);
      if (index === undefined || used.has(index))
        throw new TypeError('Header leaves must reference unique column keys.');
      used.add(index);
      levels = Math.max(levels, level + 1);
      cells.push({ title: columns[index]!.title, start: index, end: index + 1, level, rowSpan: 1, leaf: true });
      return { start: index, end: index + 1 };
    }
    if (
      !item ||
      typeof item.title !== 'string' ||
      !item.title ||
      !Array.isArray(item.children) ||
      !item.children.length
    )
      throw new TypeError('Header groups require a title and children.');
    const spans = Array.from(item.children, (child) => visit(child, level + 1));
    for (let i = 1; i < spans.length; i++)
      if (spans[i]!.start !== spans[i - 1]!.end)
        throw new TypeError('Header group columns must be contiguous and ordered.');
    const start = spans[0]!.start;
    const end = spans[spans.length - 1]!.end;
    cells.push({ title: item.title, start, end, level, rowSpan: 1, leaf: false });
    return { start, end };
  }
  for (const group of groups) visit(group, 0);
  columns.forEach((column, index) => {
    if (!used.has(index))
      cells.push({ title: column.title, start: index, end: index + 1, level: 0, rowSpan: levels, leaf: true });
  });
  return { levels, cells: cells.map((cell) => (cell.leaf ? { ...cell, rowSpan: levels - cell.level } : cell)) };
}

export function reorderedHeaderGroups(columns: readonly Column[], groups: readonly HeaderGroup[] = []): HeaderGroup[] {
  const keys = columns.map((column) => column.key);
  const first = (item: string | HeaderGroup): number =>
    typeof item === 'string' ? keys.indexOf(item) : Math.min(...item.children.map(first));
  const sort = (group: HeaderGroup): HeaderGroup => ({
    title: group.title,
    children: group.children
      .map((item) => (typeof item === 'string' ? item : sort(item)))
      .sort((a, b) => first(a) - first(b)),
  });
  const prune = (group: HeaderGroup): HeaderGroup | null => {
    const children = group.children.flatMap<string | HeaderGroup>((item) => {
      if (typeof item === 'string') return keys.includes(item) ? [item] : [];
      const nested = prune(item);
      return nested ? [nested] : [];
    });
    return children.length ? { title: group.title, children } : null;
  };
  const result = groups
    .flatMap((group) => {
      const kept = prune(group);
      return kept ? [sort(kept)] : [];
    })
    .sort((a, b) => first(a) - first(b));
  headerLayout(columns, result);
  return result;
}

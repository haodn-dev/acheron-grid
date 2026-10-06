import type {
  CellFormat,
  Column,
  GridEngine,
  LocalViewOptions,
  NumberFormat,
  SelectionRange,
} from '@acheron-grid/core';
import type { GridOptions } from '../grid.js';
import { headerLayout } from '../headers.js';
import type { CellLink } from '../links.js';
import type { CanvasTranslator } from '../locale.js';
import { mediaItems } from '../media.js';
import { createInteraction } from './interaction.js';

interface AccessibilityContext {
  readonly activeCell: HTMLDivElement;
  readonly activeRow: HTMLDivElement;
  readonly avatarColumns: ReadonlySet<string>;
  readonly columns: readonly Column[];
  readonly currentView: LocalViewOptions | undefined;
  readonly displayedText: (
    value: unknown,
    key: string,
    contentFormat?: CellFormat['contentFormat'],
    numberFormat?: NumberFormat,
  ) => string;
  readonly doc: Document;
  readonly engine: GridEngine;
  readonly getSelectionRanges: () => SelectionRange[];
  readonly headers: ReturnType<typeof headerLayout>;
  readonly indicatorPolicy: Readonly<{
    editable?: boolean;
    selectable?: boolean;
    copyable?: boolean;
    pasteable?: boolean;
    writable?: boolean;
    formatting?: boolean;
  }>;
  readonly instanceId: number;
  readonly interaction: ReturnType<typeof createInteraction>;
  readonly linksForValue: (value: unknown, key: string, contentFormat?: CellFormat['contentFormat']) => CellLink[];
  readonly mediaColumn: (key: string) => boolean;
  readonly numberText: (value: unknown, format?: NumberFormat) => string;
  readonly options: GridOptions;
  readonly rowValueLocked: (row: number) => boolean;
  readonly scroller: HTMLDivElement;
  readonly selectionStatus: HTMLDivElement;
  readonly t: CanvasTranslator;
  readonly validationMessage: (value: unknown, columnIndex: number) => string | undefined;
  readonly viewportAccessibility: boolean;
  readonly viewportLabel: string;
}

export function createAccessibility(context: AccessibilityContext) {
  const accessibleCells = new Map<string, HTMLElement>();
  function announceSelection(): void {
    const selection = context.engine.getSelection();
    context.selectionStatus.textContent = `${selection ? context.t('Row {0}, {1}. {2} selected range(s).', selection.rowIndex + 1, context.columns[selection.columnIndex]!.title, context.getSelectionRanges().length) : context.t('Selection cleared.')}${context.interaction.addNextSelection ? context.t(' Next click or navigation adds a range.') : ''}`;
  }

  function stateLabels(row: number | null, col: number): string[] {
    const labels: string[] = [];
    if (context.engine.isLocked({ scope: 'table' })) labels.push('Table locked');
    if (context.engine.isLocked({ scope: 'column', columnIndex: col })) labels.push('Column locked');
    if (col < context.engine.frozenColumns) labels.push('Column frozen');
    if (row === null) {
      const sort =
        context.currentView?.sorts?.find((item) => item.columnKey === context.columns[col]!.key) ??
        context.currentView?.sort;
      if (sort?.columnKey === context.columns[col]!.key)
        labels.push(context.t('Sorted {0}', context.t(sort.direction === 'asc' ? 'ascending' : 'descending')));
      const filter = context.currentView?.filters?.find((filter) => filter.columnKey === context.columns[col]!.key);
      if (filter)
        labels.push(
          context
            .t(
              'Filtered: {0} {1}',
              context.t(
                { contains: 'Contains text', equals: 'Equals text', 'not-empty': 'Has a value', empty: 'Is empty' }[
                  filter.operator ?? 'contains'
                ],
              ),
              filter.query,
            )
            .trim(),
        );
      const policy = context.columns[col]!.permissions;
      if (
        [context.indicatorPolicy, policy].some(
          (scope) => scope?.writable === false || scope?.selectable === false || scope?.editable === false,
        )
      )
        labels.push('Column disabled by permissions');
    } else {
      if (context.rowValueLocked(row)) labels.push('Row locked');
      if (context.engine.isLocked({ scope: 'cell', rowIndex: row, columnIndex: col })) labels.push('Cell locked');
      if (row < context.engine.frozenRows) labels.push('Row frozen');
      const permission = context.engine.getCellPermission(row, col);
      if (
        !permission.selectable ||
        (!permission.writable && !labels.some((label) => label.endsWith('locked'))) ||
        (context.columns[col]!.editable && !permission.editable && permission.writable)
      )
        labels.push('Cell disabled by permissions');
    }
    return labels;
  }

  function accessibleText(row: number, col: number, value: unknown): string {
    const column = context.columns[col]!;
    const label = context.options.getCellLabel?.(row, column.key, value);
    if (label !== undefined) return label;
    if (context.mediaColumn(column.key)) {
      const items = mediaItems(value);
      return context.t(
        '{0}: {1} {2}{3}. Alt+Enter opens details.',
        column.title,
        items.length,
        context.avatarColumns.has(column.key) ? context.t('people') : context.t('images'),
        items.length
          ? '; ' +
              items
                .map(
                  (item, i) =>
                    item.name ??
                    item.alt ??
                    (context.avatarColumns.has(column.key) ? context.t('Person ') : context.t('Image ')) + (i + 1),
                )
                .join(', ')
          : '',
      );
    }
    return `${column.title}: ${typeof value === 'number' ? context.numberText(value, context.engine.getFormat(row, col).numberFormat) : context.displayedText(value, column.key, context.engine.getFormat(row, col).contentFormat)}`;
  }

  function accessibleCell(row: number, col: number, value: unknown): HTMLElement {
    const key = `${row}:${col}`;
    let node = accessibleCells.get(key);
    if (!node) {
      node = context.doc.createElement('div');
      node.id = `acheron-visible-${context.instanceId}-${row}-${col}`;
      node.setAttribute('role', 'gridcell');
      accessibleCells.set(key, node);
    }
    node.setAttribute('aria-colindex', String(col + 1));
    const span = context.engine.getMerge(row, col);
    node.setAttribute('aria-rowspan', String(span ? span.endRow - span.startRow + 1 : 1));
    node.setAttribute('aria-colspan', String(span ? span.endColumn - span.startColumn + 1 : 1));
    const invalid = context.validationMessage(value, col);
    node.setAttribute('aria-invalid', String(!!invalid));
    node.setAttribute('aria-readonly', String(!context.engine.canEdit(row, col)));
    node.setAttribute(
      'aria-selected',
      String(
        context
          .getSelectionRanges()
          .some(
            (range) =>
              row >= range.startRow && row <= range.endRow && col >= range.startColumn && col <= range.endColumn,
          ),
      ),
    );
    node.setAttribute(
      'aria-description',
      [
        ...stateLabels(row, col).map((label) => context.t(label)),
        ...(invalid ? [invalid] : []),
        ...(context.linksForValue(value, context.columns[col]!.key, context.engine.getFormat(row, col).contentFormat)
          .length
          ? [context.t('Contains links. Alt+Enter opens links.')]
          : []),
      ].join('; '),
    );
    node.textContent = accessibleText(row, col, value);
    return node;
  }

  function syncAccessibleCell(): void {
    const selection = context.engine.getSelection();
    context.activeRow.hidden = !selection;
    if (!selection) {
      context.activeCell.textContent = '';
      context.activeRow.removeAttribute('aria-rowindex');
      context.activeCell.removeAttribute('aria-colindex');
      context.activeCell.removeAttribute('aria-readonly');
      context.scroller.removeAttribute('aria-activedescendant');
      context.scroller.setAttribute('aria-label', context.viewportLabel);
      return;
    }
    const value = context.engine.getValue(selection.rowIndex, selection.columnKey);
    context.activeRow.setAttribute(
      'aria-rowindex',
      String(selection.rowIndex + (context.viewportAccessibility ? context.headers.levels + 1 : 1)),
    );
    context.activeCell.setAttribute('aria-colindex', String(selection.columnIndex + 1));
    const span = context.engine.getMerge(selection.rowIndex, selection.columnIndex);
    context.activeCell.setAttribute('aria-rowspan', String(span ? span.endRow - span.startRow + 1 : 1));
    context.activeCell.setAttribute('aria-colspan', String(span ? span.endColumn - span.startColumn + 1 : 1));
    context.activeCell.setAttribute(
      'aria-readonly',
      String(!context.engine.canEdit(selection.rowIndex, selection.columnIndex)),
    );
    const content = accessibleText(selection.rowIndex, selection.columnIndex, value);
    context.activeCell.setAttribute(
      'aria-description',
      [
        ...stateLabels(selection.rowIndex, selection.columnIndex).map((label) => context.t(label)),
        ...(context.linksForValue(
          value,
          selection.columnKey,
          context.engine.getFormat(selection.rowIndex, selection.columnIndex).contentFormat,
        ).length
          ? [context.t('Contains links. Alt+Enter opens links.')]
          : []),
      ].join('; '),
    );
    if (context.activeCell.textContent !== content) context.activeCell.textContent = content;
    context.scroller.setAttribute('aria-activedescendant', context.activeCell.id);
    context.scroller.setAttribute(
      'aria-label',
      context.t('{0}: row {1}, {2}', context.viewportLabel, selection.rowIndex + 1, content),
    );
    if (context.viewportAccessibility && accessibleCells.has(`${selection.rowIndex}:${selection.columnIndex}`)) {
      const node = accessibleCell(selection.rowIndex, selection.columnIndex, value);
      context.activeRow.hidden = true;
      context.scroller.setAttribute('aria-activedescendant', node.id);
    }
  }
  return {
    announceSelection,
    stateLabels,
    accessibleCell,
    syncAccessibleCell,
    get accessibleCells() {
      return accessibleCells;
    },
  };
}

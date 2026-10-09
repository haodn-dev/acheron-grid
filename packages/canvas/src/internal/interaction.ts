import type {
  CellFormat,
  CellFormatPatch,
  CellFormatTarget,
  CellSelection,
  GridEngine,
  NumberFormat,
  SelectionRange,
} from '@acheron-grid/core';
import type { ColumnEditor } from '../grid.js';
import type { CellLink } from '../links.js';
import type { RichText } from '../rich-text.js';
import { layoutRichText } from '../rich-text.js';
import { createEditors } from './editors.js';
import type { GridContext } from './grid-context.js';
import { createOverlay } from './overlay.js';
import { axisCellRect, reorderInsertionIndex } from './reorder-geometry.js';

interface InteractionContext
  extends
    Readonly<Pick<GridContext['layout'], 'columns' | 'headerHeight' | 'indexWidth' | 'leafHeaders' | 'rowCount'>>,
    Readonly<Pick<GridContext['runtime'], 'destroyed'>>,
    Pick<GridContext, 'engine' | 'options'>,
    Pick<GridContext['env'], 't' | 'win'>,
    Readonly<Pick<GridContext['appearance'], 'theme'>> {
  readonly structureAction: <T>(run: () => T, axis?: 'row' | 'column') => T;
  readonly actionError: HTMLDivElement;
  readonly announceSelection: () => void;
  readonly beginEdit: () => void;
  readonly cancelCut: () => void;
  readonly cancelLinkPreviewHover: () => void;
  readonly cellLinks: (row: number, col: number) => CellLink[];
  readonly clearChoiceHover: () => void;
  readonly closeMenu: (focus?: boolean) => void;
  readonly columnAxis: GridEngine['columnsLayout'];
  readonly columnEditors: Map<string, ColumnEditor>;
  readonly context: CanvasRenderingContext2D | null;
  readonly editors: ReturnType<typeof createEditors>;
  readonly finishEdit: (commit: boolean) => boolean;
  readonly format: (targets: readonly CellFormatTarget[], patch: CellFormatPatch | null) => void;
  readonly getSelection: () => CellSelection | null;
  readonly getSelectionRange: () => SelectionRange | null;
  readonly getSelectionRanges: () => SelectionRange[];
  readonly headerRowHeight: number;
  readonly headerSurface: HTMLDivElement;
  readonly indexGutter: HTMLDivElement;
  readonly invalidate: (changes: readonly { rowIndex: number; columnKey: string }[]) => void;
  readonly measuredRows: Set<number>;
  readonly mediaColumn: (key: string) => boolean;
  readonly mediaSize: number;
  readonly numberText: (value: unknown, format?: NumberFormat) => string;
  readonly openLinks: (row: number, col: number, x: number, y: number, focus?: boolean) => void;
  readonly openMedia: (row: number, col: number) => boolean;
  readonly openMenu: (row: number, col: number, x: number, y: number, header?: boolean) => void;
  readonly overlay: ReturnType<typeof createOverlay>;
  readonly reorderBadge: HTMLDivElement;
  readonly reorderGuide: HTMLDivElement;
  readonly replay: (redo: boolean) => boolean;
  readonly resizeGuide: HTMLDivElement;
  readonly richText: (value: unknown, key: string, contentFormat?: CellFormat['contentFormat']) => RichText | undefined;
  readonly root: HTMLDivElement;
  readonly rowAxis: GridEngine['rows'];
  readonly rowValueLocked: (row: number) => boolean;
  readonly scroller: HTMLDivElement;
  readonly stateLabels: (row: number | null, col: number) => string[];
  readonly validationMessage: (value: unknown, columnIndex: number) => string | undefined;
  readonly viewport: () => ReturnType<GridEngine['getViewport']>;
  readonly viewportLabel: string;
}

export function createInteraction(context: InteractionContext) {
  let dragPointer: number | null = null;
  let axisAnchor: { axis: 'row' | 'column'; index: number } | null = null;
  let axisDrag: { axis: 'row' | 'column'; index: number } | null = null;
  let dragPosition: { clientX: number; clientY: number } | null = null;
  let dragFrame: number | undefined;
  let handleAnchor: { row: number; col: number } | null = null;
  let touchSelection = false;
  let dragGhost: HTMLCanvasElement | null = null;
  let addNextSelection = false;
  let pendingAddDrag: { row: number; col: number } | null = null;
  let resizing: {
    pointerId: number;
    axis: 'column' | 'row';
    index: number;
    start: number;
    size: number;
    proposed: number;
    edge: number;
  } | null = null;
  let reorderDrag: { axis: 'row' | 'column'; indices: number[] } | null = null;
  let touchReorder: { pointerId: number; startX: number; startY: number; moved: boolean; beforeIndex: number } | null =
    null;
  function resizeAxis(axis: typeof context.rowAxis, index: number, size: number): void {
    if (context.destroyed) throw new Error('Grid is destroyed.');
    if (context.editors.editor) throw new Error('Finish editing before resizing cells.');
    if (axis === context.rowAxis) {
      context.structureAction(() => context.engine.setRowHeight(index, size), 'row');
    } else {
      context.structureAction(() => context.engine.setColumnWidth(index, size), 'column');
      context.measuredRows.clear();
    }
  }

  function visibleIndices(axis: 'row' | 'column'): Set<number> {
    const indices = new Set<number>();
    for (const region of context.viewport().regions) {
      const range = axis === 'row' ? region.rows : region.columns;
      for (let index = range.start; index < range.end; index++) indices.add(index);
    }
    return indices;
  }

  function autoFitColumn(index: number): void {
    if (context.destroyed) throw new Error('Grid is destroyed.');
    if (context.editors.editor) throw new Error('Finish editing before resizing cells.');
    context.columnAxis.size(index);
    const column = context.columns[index]!;
    const ctx = context.context!;
    ctx.save();
    let width: number;
    try {
      ctx.font = context.theme.headerFont;
      width = ctx.measureText(column.title).width + 56;
      ctx.font = context.theme.font;
      for (const row of visibleIndices('row')) {
        const value = context.engine.getValue(row, column.key);
        if (context.mediaColumn(column.key)) {
          width = Math.max(width, context.mediaSize * 2 + 16);
          continue;
        } else if (context.columnEditors.get(column.key)?.type === 'checkbox') width = Math.max(width, 36);
        else {
          const rich = context.richText(value, column.key, context.engine.getFormat(row, index).contentFormat);
          if (rich) width = Math.max(width, layoutRichText(ctx, rich, context.theme.font, Infinity, false).width + 20);
          else
            for (const line of context.numberText(value, context.engine.getFormat(row, index).numberFormat).split('\n'))
              width = Math.max(width, ctx.measureText(line).width + 20);
          ctx.font = context.theme.font;
        }
      }
    } finally {
      ctx.restore();
    }
    resizeAxis(context.columnAxis, index, Math.max(24, Math.min(1000, Math.ceil(width))));
  }

  function autoFitRow(index: number): void {
    if (context.destroyed) throw new Error('Grid is destroyed.');
    if (context.editors.editor) throw new Error('Finish editing before resizing cells.');
    context.rowAxis.size(index);
    resizeAxis(context.rowAxis, index, measureRowHeight(index));
  }

  function measureRowHeight(index: number, allColumns = false): number {
    const ctx = context.context!;
    ctx.save();
    let height = context.options.rowHeight ?? 24;
    try {
      ctx.font = context.theme.font;
      const metrics = ctx.measureText('M');
      const lineHeight = Math.ceil(metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) || 18;
      for (const col of allColumns ? context.columns.keys() : visibleIndices('column')) {
        if (context.columnAxis.size(col) <= 0) continue;
        const key = context.columns[col]!.key;
        const value = context.engine.getValue(index, key);
        const custom = context.options.measureCellHeight?.(value, key, context.columnAxis.size(col));
        if (custom !== undefined) {
          if (!Number.isFinite(custom) || custom <= 0)
            throw new RangeError('Measured cell height must be positive and finite.');
          height = Math.max(height, custom);
          continue;
        }
        if (context.mediaColumn(key)) {
          height = Math.max(height, context.mediaSize + 8);
          continue;
        }
        const rich = context.richText(value, key, context.engine.getFormat(index, col).contentFormat);
        if (rich) {
          const layout = layoutRichText(
            ctx,
            rich,
            context.theme.font,
            Math.max(0, context.columnAxis.size(col) - 20),
            !!context.options.wrapText,
            Math.ceil(1000 / lineHeight),
          );
          height = Math.max(height, Math.min(1000, layout.lines * layout.lineHeight + 12));
          ctx.font = context.theme.font;
          continue;
        }
        let lines = 1;
        let line = '';
        if (context.options.wrapText)
          for (const character of context.numberText(value, context.engine.getFormat(index, col).numberFormat)) {
            if (
              character === '\n' ||
              (line && ctx.measureText(line + character).width > Math.max(0, context.columnAxis.size(col) - 20))
            ) {
              lines++;
              line = '';
              if (lines * lineHeight >= 1000) break;
            }
            if (character !== '\n') line += character;
          }
        height = Math.max(height, lines * lineHeight + 12);
      }
    } finally {
      ctx.restore();
    }
    return Math.min(1000, height);
  }

  function onAxisDoubleClick(event: MouseEvent): void {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      !(event.target instanceof context.win.Node) ||
      (event.target !== context.root &&
        !context.scroller.contains(event.target) &&
        !context.indexGutter.contains(event.target) &&
        !context.headerSurface.contains(event.target))
    )
      return;
    const column = columnEdge(event);
    const row = column === null ? rowEdge(event) : null;
    if (column === null && row === null) return;
    event.preventDefault();
    event.stopPropagation();
    endResize();
    onPointerEnd();
    if (!context.finishEdit(true)) return;
    try {
      if (column !== null) autoFitColumn(column);
      else autoFitRow(row!);
    } catch (error) {
      context.actionError.textContent =
        error instanceof Error ? context.t(error.message) : context.t('Unable to fit size.');
      context.actionError.style.display = 'block';
    }
  }

  function selectedAxisIndices(axis: 'row' | 'column', index: number): number[] {
    const ranges = context
      .getSelectionRanges()
      .filter((range) =>
        axis === 'row'
          ? range.startColumn === 0 && range.endColumn === context.columns.length - 1
          : range.startRow === 0 && range.endRow === context.rowCount - 1,
      );
    if (
      !ranges.some((range) =>
        axis === 'row'
          ? index >= range.startRow && index <= range.endRow
          : index >= range.startColumn && index <= range.endColumn,
      )
    )
      return [index];
    const indices = new Set<number>();
    for (const range of ranges)
      for (
        let i = axis === 'row' ? range.startRow : range.startColumn;
        i <= (axis === 'row' ? range.endRow : range.endColumn);
        i++
      )
        indices.add(i);
    return [...indices].sort((a, b) => a - b);
  }

  function headerColumn(event: MouseEvent): number | null {
    const bounds = context.root.getBoundingClientRect();
    const x = event.clientX - bounds.left - context.indexWidth;
    const y = event.clientY - bounds.top;
    if (x < 0 || x >= context.scroller.clientWidth || y < 0 || y >= context.headerHeight || !context.columns.length)
      return null;
    const col = context.columnAxis.indexAt(x + (x < context.viewport().frozenWidth ? 0 : context.scroller.scrollLeft));
    return col < context.columns.length && y >= context.leafHeaders[col]!.level * context.headerRowHeight ? col : null;
  }

  function columnEdge(event: MouseEvent): number | null {
    const bounds = context.root.getBoundingClientRect();
    const x = event.clientX - bounds.left - context.indexWidth;
    const y = event.clientY - bounds.top;
    if (x < 0 || x >= context.scroller.clientWidth || y < 0 || y >= context.headerHeight || !context.columns.length)
      return null;
    const view = context.viewport();
    if (
      context.engine.frozenColumns > 0 &&
      Math.abs(context.columnAxis.position(context.engine.frozenColumns) - x) <= 8 &&
      x <= view.width
    )
      return context.engine.frozenColumns - 1;
    const offset = x + (x < view.frozenWidth ? 0 : view.scrollLeft);
    const col = context.columnAxis.indexAt(offset);
    if (col < context.columns.length && y < context.leafHeaders[col]!.level * context.headerRowHeight) return null;
    const first = x < view.frozenWidth ? 0 : context.engine.frozenColumns;
    const limit = x < view.frozenWidth ? context.engine.frozenColumns : context.columns.length;
    if (col < limit && col >= first && Math.abs(context.columnAxis.position(col + 1) - offset) <= 8) return col;
    if (col > first && Math.abs(context.columnAxis.position(col) - offset) <= 8) return col - 1;
    return null;
  }

  function rowEdge(event: MouseEvent): number | null {
    const bounds = context.scroller.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (
      x < -context.indexWidth ||
      x > (context.engine.frozenColumns ? Math.min(context.columnAxis.size(0), context.scroller.clientWidth) : 10) ||
      y < 0 ||
      y >= context.scroller.clientHeight ||
      !context.rowCount ||
      !context.columns.length
    )
      return null;
    const tolerance = x <= 10 ? 8 : 3;
    const view = context.viewport();
    if (context.engine.frozenRows > 0 && Math.abs(context.rowAxis.position(context.engine.frozenRows) - y) <= tolerance)
      return context.engine.frozenRows - 1;
    const offset = y + (y < view.frozenHeight ? 0 : view.scrollTop);
    const row = context.rowAxis.indexAt(offset);
    const first = y < view.frozenHeight ? 0 : context.engine.frozenRows;
    const limit = y < view.frozenHeight ? context.engine.frozenRows : context.rowCount;
    if (row < limit && row >= first && Math.abs(context.rowAxis.position(row + 1) - offset) <= tolerance) return row;
    if (row > first && Math.abs(context.rowAxis.position(row) - offset) <= tolerance) return row - 1;
    return null;
  }

  function showResizeGuide(): void {
    if (!resizing) return;
    const view = context.viewport();
    const position = resizing.edge + resizing.proposed - resizing.size;
    context.resizeGuide.dataset.axis = resizing.axis;
    context.resizeGuide.style.display = 'block';
    context.resizeGuide.style.left =
      resizing.axis === 'column' ? `${context.indexWidth + Math.max(0, Math.min(view.width - 2, position))}px` : '0px';
    context.resizeGuide.style.top =
      resizing.axis === 'row'
        ? `${Math.max(context.headerHeight, Math.min(context.headerHeight + view.height - 2, position))}px`
        : '0px';
    context.resizeGuide.style.width = resizing.axis === 'column' ? '2px' : `${context.indexWidth + view.width}px`;
    context.resizeGuide.style.height = resizing.axis === 'row' ? '2px' : `${context.headerHeight + view.height}px`;
  }

  function selectHeaderGroup(first: number, last: number, event: PointerEvent | KeyboardEvent): void {
    if (!context.rowCount || !context.finishEdit(true)) return;
    const anchor = event.shiftKey
      ? axisAnchor?.axis === 'column'
        ? axisAnchor.index
        : (context.engine.getSelection()?.columnIndex ?? first)
      : first;
    if (
      !selectScope(
        axisRange('column', anchor, anchor > last ? first : last),
        event.shiftKey ? 'extend' : event.ctrlKey || event.metaKey ? 'add' : 'replace',
      )
    )
      return;
    axisAnchor = { axis: 'column', index: anchor };
    context.scroller.focus({ preventScroll: true });
  }

  function onHeaderPointerDown(event: PointerEvent): void {
    if (
      event.target instanceof context.win.Element &&
      event.target.closest('[data-grid-row-group], [data-grid-header-state]')
    )
      return;
    const moveTarget =
      event.target instanceof context.win.Element ? event.target.closest<HTMLElement>('[data-grid-reorder]') : null;
    if (
      moveTarget?.draggable &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      columnEdge(event) === null &&
      rowEdge(event) === null
    ) {
      if (event.button === 0) startTouchReorder(event, moveTarget);
      return;
    }
    if (resizing) {
      event.preventDefault();
      return;
    }
    if (
      event.button !== 0 ||
      event.altKey ||
      (event.target !== context.root &&
        !(
          event.target instanceof context.win.Node &&
          (context.scroller.contains(event.target) ||
            context.indexGutter.contains(event.target) ||
            context.headerSurface.contains(event.target))
        ))
    )
      return;
    const bounds = context.root.getBoundingClientRect();
    if (
      context.indexWidth &&
      event.clientX < bounds.left + context.indexWidth &&
      event.clientY < bounds.top + context.headerHeight
    ) {
      event.preventDefault();
      selectAll();
      context.scroller.focus({ preventScroll: true });
      return;
    }
    const column = columnEdge(event);
    const row = column === null ? rowEdge(event) : null;
    if (column === null && row === null) {
      const group =
        event.target instanceof context.win.Element
          ? event.target.closest<HTMLElement>('[data-grid-header-group]')
          : null;
      if (group) {
        event.preventDefault();
        selectHeaderGroup(Number(group.dataset.groupStart), Number(group.dataset.groupEnd), event);
        return;
      }
      const row = indexRow(event);
      if (row !== null && context.finishEdit(true)) {
        event.preventDefault();
        startAxisSelection('row', row, event);
        return;
      }
      const col = headerColumn(event);
      if (col !== null && context.rowCount && context.finishEdit(true)) {
        event.preventDefault();
        startAxisSelection('column', col, event);
      }
      return;
    }
    event.preventDefault();
    if (!context.finishEdit(true)) return;
    context.closeMenu();
    const axis = column === null ? 'row' : 'column';
    const index = column ?? row!;
    const size = axis === 'column' ? context.columnAxis.size(index) : context.rowAxis.size(index);
    const view = context.viewport();
    const edge =
      axis === 'column'
        ? context.columnAxis.position(index + 1) - (index < context.engine.frozenColumns ? 0 : view.scrollLeft)
        : context.headerHeight +
          context.rowAxis.position(index + 1) -
          (index < context.engine.frozenRows ? 0 : view.scrollTop);
    resizing = {
      pointerId: event.pointerId,
      axis,
      index,
      size,
      proposed: size,
      start: axis === 'column' ? event.clientX : event.clientY,
      edge,
    };
    context.scroller.focus({ preventScroll: true });
    context.root.setPointerCapture(event.pointerId);
    context.root.style.cursor = axis === 'column' ? 'col-resize' : 'row-resize';
    showResizeGuide();
  }

  function onHeaderPointerMove(event: PointerEvent): void {
    if (touchReorder) return;
    context.root.style.cursor = resizing
      ? resizing.axis === 'column'
        ? 'col-resize'
        : 'row-resize'
      : columnEdge(event) !== null
        ? 'col-resize'
        : rowEdge(event) !== null
          ? 'row-resize'
          : '';
    const column = columnEdge(event);
    const cell = pointerCell(event);
    const key =
      cell &&
      !event.buttons &&
      !resizing &&
      !context.editors.editor &&
      !context.overlay.menu &&
      context.options.allowOpenLinks !== false &&
      context.cellLinks(cell.row, cell.col).length
        ? `${cell.row}:${cell.col}`
        : '';
    if (key !== context.overlay.linkHoverKey) {
      context.cancelLinkPreviewHover();
      context.overlay.linkHoverKey = key;
      if (key && cell) {
        const row = cell.row,
          col = cell.col,
          x = event.clientX,
          y = event.clientY + 12;
        context.overlay.linkHoverTimer = context.win.setTimeout(() => {
          if (!context.destroyed && !context.editors.editor && !context.overlay.menu)
            context.openLinks(row, col, x, y, false);
        }, 450);
      }
    }
    const config = cell ? context.columnEditors.get(context.columns[cell.col]!.key) : undefined;
    const next =
      cell &&
      config &&
      config.type !== 'checkbox' &&
      !resizing &&
      !context.editors.editor &&
      context.engine.canEdit(cell.row, cell.col)
        ? cell
        : null;
    if (next?.row !== context.editors.hoveredChoice?.row || next?.col !== context.editors.hoveredChoice?.col) {
      context.clearChoiceHover();
      context.editors.hoveredChoice = next;
      if (next) context.invalidate([{ rowIndex: next.row, columnKey: context.columns[next.col]!.key }]);
    }
    const bounds = context.root.getBoundingClientRect();
    const headerColumn = context.columnAxis.indexAt(
      event.clientX -
        bounds.left -
        context.indexWidth +
        (event.clientX - bounds.left - context.indexWidth < context.viewport().frozenWidth
          ? 0
          : context.scroller.scrollLeft),
    );
    context.root.title =
      context.root.style.cursor === 'row-resize'
        ? context.t('Drag the row boundary to resize height')
        : column !== null
          ? context.t('Drag the column boundary to resize width')
          : event.clientY - bounds.top < context.headerHeight &&
              event.clientX >= bounds.left + context.indexWidth &&
              headerColumn >= 0 &&
              headerColumn < context.columns.length
            ? context
                .stateLabels(null, headerColumn)
                .map((label) => context.t(label))
                .join('; ')
            : indexRow(event) !== null
              ? [context.t('Select row {0}', indexRow(event)! + 1), ...rowLabels(indexRow(event)!)].join('; ')
              : cell
                ? context
                    .stateLabels(cell.row, cell.col)
                    .map((label) => context.t(label))
                    .join('; ')
                : '';
    if (cell && !resizing) {
      const message = context.validationMessage(
        context.engine.getValue(cell.row, context.columns[cell.col]!.key),
        cell.col,
      );
      if (message) context.root.title = message;
    }
    if (
      !resizing &&
      cell &&
      event.altKey &&
      context.options.allowOpenLinks !== false &&
      context.cellLinks(cell.row, cell.col).length
    ) {
      context.root.style.cursor = 'pointer';
      context.root.title = context.t('Alt+click to open links');
    }
    if (context.editors.hoveredChoice && cell) {
      const rect = context.viewport().cellRect(cell.row, cell.col);
      if (event.clientX - context.scroller.getBoundingClientRect().left >= rect.x + rect.width - 24)
        context.root.style.cursor = 'pointer';
    }
    if (resizing?.pointerId === event.pointerId) {
      resizing.proposed = Math.max(
        24,
        Math.min(1000, resizing.size + (resizing.axis === 'column' ? event.clientX : event.clientY) - resizing.start),
      );
      showResizeGuide();
    }
  }

  function endResize(): void {
    const pointerId = resizing?.pointerId;
    resizing = null;
    context.resizeGuide.style.display = 'none';
    context.root.style.cursor = '';
    context.root.title = '';
    if (pointerId !== undefined && context.root.hasPointerCapture(pointerId))
      context.root.releasePointerCapture(pointerId);
  }

  function commitResize(event: PointerEvent): void {
    if (resizing?.pointerId !== event.pointerId) return;
    const draft = resizing;
    endResize();
    try {
      resizeAxis(draft.axis === 'column' ? context.columnAxis : context.rowAxis, draft.index, draft.proposed);
    } catch (error) {
      context.actionError.textContent =
        error instanceof Error ? context.t(error.message) : context.t('Unable to resize.');
      context.actionError.style.display = 'block';
    }
  }

  function cancelResizeKey(event: KeyboardEvent): void {
    if (touchReorder && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      clearReorder();
      return;
    }
    if (resizing && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      endResize();
    }
  }

  function select(rowIndex: number, columnIndex: number, extend = false, reveal = true, add = false): void {
    if (context.destroyed || context.rowCount === 0 || context.columns.length === 0) return;
    axisAnchor = null;
    const previous = context.engine.getSelection();
    const changed = previous?.rowIndex !== rowIndex || previous?.columnIndex !== columnIndex;
    const previousRange = JSON.stringify(context.getSelectionRange());
    const previousRanges = JSON.stringify(context.getSelectionRanges());
    if (
      !(add
        ? context.engine.toggleSelection(rowIndex, columnIndex)
        : context.engine.select(rowIndex, columnIndex, extend))
    )
      return;
    if (add) addNextSelection = false;
    context.announceSelection();
    const rangeChanged = previousRange !== JSON.stringify(context.getSelectionRange());
    if (reveal) {
      const view = context.viewport();
      const left = context.columnAxis.position(columnIndex);
      const top = context.rowAxis.position(rowIndex);
      if (columnIndex >= context.engine.frozenColumns && view.width > view.frozenWidth) {
        if (
          left < view.scrollLeft + view.frozenWidth ||
          context.columnAxis.size(columnIndex) > view.width - view.frozenWidth
        )
          context.scroller.scrollLeft = left - view.frozenWidth;
        else if (left + context.columnAxis.size(columnIndex) > view.scrollLeft + view.width)
          context.scroller.scrollLeft = left + context.columnAxis.size(columnIndex) - view.width;
      }
      if (rowIndex >= context.engine.frozenRows && view.height > view.frozenHeight) {
        if (
          top < view.scrollTop + view.frozenHeight ||
          context.rowAxis.size(rowIndex) > view.height - view.frozenHeight
        )
          context.scroller.scrollTop = top - view.frozenHeight;
        else if (top + context.rowAxis.size(rowIndex) > view.scrollTop + view.height)
          context.scroller.scrollTop = top + context.rowAxis.size(rowIndex) - view.height;
      }
    }
    if (changed) context.options.onSelectionChange?.(context.getSelection());
    if (rangeChanged) context.options.onSelectionRangeChange?.(context.getSelectionRange());
    if (previousRanges !== JSON.stringify(context.getSelectionRanges()))
      context.options.onSelectionRangesChange?.(context.getSelectionRanges());
  }

  function selectScope(range: SelectionRange, mode: 'replace' | 'add' | 'extend' = 'replace'): boolean {
    if (context.destroyed) throw new Error('Grid is destroyed.');
    if (!context.finishEdit(true)) return false;
    const previous = context.engine.getSelection();
    if (!context.engine.selectRange(range, mode)) {
      const current = context.getSelectionRange();
      return (
        !!current &&
        current.startRow === range.startRow &&
        current.endRow === range.endRow &&
        current.startColumn === range.startColumn &&
        current.endColumn === range.endColumn &&
        context.engine.getCellPermission(range.startRow, range.startColumn).selectable &&
        context.engine.getCellPermission(range.endRow, range.endColumn).selectable
      );
    }
    addNextSelection = false;
    context.announceSelection();
    const selection = context.engine.getSelection();
    if (previous?.rowIndex !== selection?.rowIndex || previous?.columnIndex !== selection?.columnIndex)
      context.options.onSelectionChange?.(selection);
    context.options.onSelectionRangeChange?.(context.getSelectionRange());
    context.options.onSelectionRangesChange?.(context.getSelectionRanges());
    return true;
  }

  function selectColumn(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= context.columns.length)
      throw new RangeError('Invalid column index.');
    if (
      !context.rowCount ||
      selectScope({ startRow: 0, endRow: context.rowCount - 1, startColumn: index, endColumn: index })
    )
      axisAnchor = { axis: 'column', index };
  }

  function selectRow(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= context.rowCount)
      throw new RangeError('Invalid row index.');
    if (
      !context.columns.length ||
      selectScope({ startRow: index, endRow: index, startColumn: 0, endColumn: context.columns.length - 1 })
    )
      axisAnchor = { axis: 'row', index };
  }

  function selectAll(): void {
    if (context.destroyed) throw new Error('Grid is destroyed.');
    if (
      !context.rowCount ||
      !context.columns.length ||
      selectScope({ startRow: 0, endRow: context.rowCount - 1, startColumn: 0, endColumn: context.columns.length - 1 })
    )
      axisAnchor = null;
  }

  function axisRange(axis: 'row' | 'column', anchor: number, end: number): SelectionRange {
    return axis === 'row'
      ? {
          startRow: Math.min(anchor, end),
          endRow: Math.max(anchor, end),
          startColumn: 0,
          endColumn: context.columns.length - 1,
        }
      : {
          startRow: 0,
          endRow: context.rowCount - 1,
          startColumn: Math.min(anchor, end),
          endColumn: Math.max(anchor, end),
        };
  }

  function startAxisSelection(axis: 'row' | 'column', index: number, event: PointerEvent | KeyboardEvent): void {
    if (!context.rowCount || !context.columns.length) return;
    const active = context.engine.getSelection();
    const anchor = event.shiftKey
      ? axisAnchor?.axis === axis
        ? axisAnchor.index
        : axis === 'row'
          ? (active?.rowIndex ?? index)
          : (active?.columnIndex ?? index)
      : index;
    const range = axisRange(axis, anchor, index);
    if (
      !context.engine.getCellPermission(range.startRow, range.startColumn).selectable ||
      !context.engine.getCellPermission(range.endRow, range.endColumn).selectable
    )
      return;
    try {
      if (
        !selectScope(
          range,
          event.shiftKey ? 'extend' : event.ctrlKey || event.metaKey || addNextSelection ? 'add' : 'replace',
        )
      )
        return;
    } catch (error) {
      context.actionError.textContent =
        error instanceof Error ? context.t(error.message) : context.t('Unable to add selection.');
      context.actionError.style.display = 'block';
      return;
    }
    axisAnchor = { axis, index: anchor };
    context.scroller.focus({ preventScroll: true });
    if (event instanceof context.win.PointerEvent) {
      axisDrag = axisAnchor;
      dragPointer = event.pointerId;
      dragPosition = event;
      context.root.setPointerCapture(event.pointerId);
    }
  }

  function pointerCell(
    event: Pick<MouseEvent, 'clientX' | 'clientY'>,
    clamp = false,
  ): { row: number; col: number } | null {
    if (!context.rowCount || !context.columns.length) return null;
    const bounds = context.scroller.getBoundingClientRect();
    let x = event.clientX - bounds.left;
    let y = event.clientY - bounds.top;
    if (clamp) {
      x = Math.max(0, Math.min(context.scroller.clientWidth - 1, x));
      y = Math.max(0, Math.min(context.scroller.clientHeight - 1, y));
    }
    if (x < 0 || y < 0 || x >= context.scroller.clientWidth || y >= context.scroller.clientHeight) return null;
    const hit = context.viewport().hitTest(x, y);
    if (hit || !clamp) return hit;
    const view = context.viewport();
    const row = Math.min(
      context.rowCount - 1,
      context.rowAxis.indexAt(y + (y < view.frozenHeight ? 0 : view.scrollTop)),
    );
    const col = Math.min(
      context.columns.length - 1,
      context.columnAxis.indexAt(x + (x < view.frozenWidth ? 0 : view.scrollLeft)),
    );
    return { row, col };
  }

  function onLinkClick(event: MouseEvent): void {
    if (!event.altKey || event.target === context.editors.editor) return;
    const cell = pointerCell(event);
    if (cell && context.cellLinks(cell.row, cell.col).length && context.finishEdit(true)) {
      event.preventDefault();
      select(cell.row, cell.col, false, false);
      context.openLinks(cell.row, cell.col, event.clientX, event.clientY);
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.defaultPrevented || event.target === context.editors.editor || event.button !== 0) return;
    if (event.altKey) return;
    touchSelection = event.pointerType === 'touch';
    const cell = pointerCell(event);
    if (!cell) return;
    event.preventDefault();
    if (!context.finishEdit(true)) return;
    if (!context.engine.getCellPermission(cell.row, cell.col).selectable) return;
    context.scroller.focus({ preventScroll: true });
    if (event.clientX - context.scroller.getBoundingClientRect().left < 10) {
      selectRow(cell.row);
      return;
    }
    const add = !event.shiftKey && (event.ctrlKey || event.metaKey || addNextSelection);
    try {
      select(cell.row, cell.col, event.shiftKey, true, add);
    } catch (error) {
      context.actionError.textContent =
        error instanceof Error ? context.t(error.message) : context.t('Unable to add selection.');
      context.actionError.style.display = 'block';
      return;
    }
    const choice = context.columnEditors.get(context.columns[cell.col]!.key);
    if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      choice &&
      choice.type !== 'checkbox' &&
      context.engine.canEdit(cell.row, cell.col)
    ) {
      const rect = context.viewport().cellRect(cell.row, cell.col);
      if (event.clientX - context.scroller.getBoundingClientRect().left >= rect.x + rect.width - 24) {
        context.clearChoiceHover();
        context.beginEdit();
        return;
      }
    }
    if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      context.columnEditors.get(context.columns[cell.col]!.key)?.type === 'checkbox'
    ) {
      const rect = context.viewport().cellRect(cell.row, cell.col);
      const bounds = context.scroller.getBoundingClientRect();
      const x = event.clientX - bounds.left - rect.x;
      const y = event.clientY - bounds.top - rect.y;
      if (x >= 8 && x <= 28 && Math.abs(y - rect.height / 2) <= 10 && context.engine.canEdit(cell.row, cell.col)) {
        context.beginEdit();
        if (
          context.editors.editor instanceof context.win.HTMLInputElement &&
          context.editors.editor.type === 'checkbox'
        ) {
          context.editors.editor.checked = !context.editors.editor.checked;
          if (context.finishEdit(true)) context.scroller.focus({ preventScroll: true });
        }
        return;
      }
    }
    if (event.pointerType !== 'touch') {
      pendingAddDrag = add ? { row: cell.row, col: cell.col } : null;
      dragPointer = event.pointerId;
      context.scroller.setPointerCapture(event.pointerId);
    }
  }

  function extendDrag(): void {
    if (!dragPosition) return;
    if (touchReorder) {
      updateTouchReorder(dragPosition);
      return;
    }
    const cell = pointerCell(dragPosition, true);
    if (!cell) return;
    if (pendingAddDrag) {
      const start = pendingAddDrag;
      const span = context.engine.getMerge(start.row, start.col);
      if (
        span
          ? cell.row >= span.startRow &&
            cell.row <= span.endRow &&
            cell.col >= span.startColumn &&
            cell.col <= span.endColumn
          : cell.row === start.row && cell.col === start.col
      )
        return;
      // A modifier tap toggles; crossing into another cell starts an additive drag at the pressed cell.
      pendingAddDrag = null;
      try {
        context.engine.addSelection(start.row, start.col);
      } catch (error) {
        context.actionError.textContent =
          error instanceof Error ? context.t(error.message) : context.t('Unable to add selection.');
        context.actionError.style.display = 'block';
        onPointerEnd();
        return;
      }
    }
    if (handleAnchor)
      selectScope(
        {
          startRow: Math.min(handleAnchor.row, cell.row),
          endRow: Math.max(handleAnchor.row, cell.row),
          startColumn: Math.min(handleAnchor.col, cell.col),
          endColumn: Math.max(handleAnchor.col, cell.col),
        },
        'extend',
      );
    else if (axisDrag)
      selectScope(axisRange(axisDrag.axis, axisDrag.index, axisDrag.axis === 'row' ? cell.row : cell.col), 'extend');
    else select(cell.row, cell.col, true, false);
  }

  function dragScroll(): void {
    dragFrame = undefined;
    if (dragPointer === null || !dragPosition || context.destroyed) return;
    const bounds = context.scroller.getBoundingClientRect();
    const view = context.viewport();
    const step = (position: number, start: number, size: number) =>
      position < start + 24 ? -16 : position > start + size - 24 ? 16 : 0;
    const activeAxis = touchReorder ? reorderDrag?.axis : axisDrag?.axis;
    const dx =
      activeAxis === 'row' || view.width <= view.frozenWidth
        ? 0
        : step(dragPosition.clientX, bounds.left + view.frozenWidth, view.width - view.frozenWidth);
    const dy =
      activeAxis === 'column' || view.height <= view.frozenHeight
        ? 0
        : step(dragPosition.clientY, bounds.top + view.frozenHeight, view.height - view.frozenHeight);
    const previousLeft = context.scroller.scrollLeft;
    const previousTop = context.scroller.scrollTop;
    context.scroller.scrollLeft += dx;
    context.scroller.scrollTop += dy;
    if (context.scroller.scrollLeft !== previousLeft || context.scroller.scrollTop !== previousTop) {
      extendDrag();
      dragFrame = context.win.requestAnimationFrame(dragScroll);
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== dragPointer) return;
    dragPosition = event;
    extendDrag();
    if (dragFrame === undefined) dragFrame = context.win.requestAnimationFrame(dragScroll);
  }

  function onPointerEnd(): void {
    pendingAddDrag = null;
    if (touchReorder) clearReorder();
    const pointer = dragPointer;
    dragPointer = null;
    axisDrag = null;
    handleAnchor = null;
    dragPosition = null;
    if (dragFrame !== undefined) context.win.cancelAnimationFrame(dragFrame);
    dragFrame = undefined;
    if (pointer !== null)
      for (const target of [context.root, context.scroller])
        if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer);
  }

  function onKeyDown(event: KeyboardEvent): void {
    const selection = context.engine.getSelection();
    if (
      (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) &&
      !selection &&
      context.rowCount &&
      context.columns.length &&
      (context.engine.getHiddenRows().length || context.engine.getHiddenColumns().length)
    ) {
      event.preventDefault();
      const bounds = context.scroller.getBoundingClientRect();
      context.openMenu(0, 0, bounds.left + 8, bounds.top + 8);
      return;
    }
    if ((event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) && selection) {
      event.preventDefault();
      const bounds = context.scroller.getBoundingClientRect();
      const rect = context.viewport().cellRect(selection.rowIndex, selection.columnIndex);
      context.openMenu(
        selection.rowIndex,
        selection.columnIndex,
        bounds.left + Math.max(rect.clip.x, rect.x),
        bounds.top + Math.min(rect.clip.y + rect.clip.height, rect.y + rect.height),
      );
      return;
    }
    if (event.altKey && event.key === 'Enter' && selection) {
      event.preventDefault();
      if (context.openMedia(selection.rowIndex, selection.columnIndex)) return;
      const rect = context.viewport().cellRect(selection.rowIndex, selection.columnIndex);
      const bounds = context.scroller.getBoundingClientRect();
      context.openLinks(
        selection.rowIndex,
        selection.columnIndex,
        bounds.left + rect.x,
        bounds.top + rect.y + rect.height,
      );
      return;
    }
    if (event.isComposing || event.altKey) return;
    const control = event.ctrlKey || event.metaKey;
    if (control && selection && ['b', 'i'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      const key = event.key.toLowerCase() === 'b' ? 'fontWeight' : 'fontStyle';
      const current = context.engine.getFormat(selection.rowIndex, selection.columnIndex);
      const value = current[key] && current[key] !== 'normal' ? 'normal' : key === 'fontWeight' ? 'bold' : 'italic';
      try {
        context.format(
          context.getSelectionRanges().map((range) => ({ scope: 'range', range })),
          { [key]: value },
        );
      } catch (error) {
        context.actionError.textContent =
          error instanceof Error ? context.t(error.message) : context.t('Unable to format selection.');
        context.actionError.style.display = 'block';
      }
      return;
    }
    if (control && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      onPointerEnd();
      selectAll();
      return;
    }
    if (event.key === ' ' && selection && (control || event.shiftKey)) {
      event.preventDefault();
      control ? selectColumn(selection.columnIndex) : selectRow(selection.rowIndex);
      return;
    }
    if (event.key === 'F8' && event.shiftKey && !control) {
      event.preventDefault();
      addNextSelection = !addNextSelection;
      context.announceSelection();
      return;
    }
    if (control && (event.key.toLowerCase() === 'z' || (event.key.toLowerCase() === 'y' && !event.shiftKey))) {
      event.preventDefault();
      try {
        context.replay(event.shiftKey || event.key.toLowerCase() === 'y');
      } catch (error) {
        context.win.alert(error instanceof Error ? context.t(error.message) : context.t('Unable to replay history.'));
      }
      return;
    }
    if (event.shiftKey && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
      return;
    if (control && event.key !== 'Home' && event.key !== 'End') return;
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      context.beginEdit();
      if (
        event.key === 'Enter' &&
        context.editors.editor instanceof context.win.HTMLInputElement &&
        context.editors.editor.type === 'checkbox'
      ) {
        context.editors.editor.checked = !context.editors.editor.checked;
        if (context.finishEdit(true)) context.scroller.focus({ preventScroll: true });
      }
      return;
    }
    if (event.key === 'Escape') {
      context.cancelCut();
      onPointerEnd();
      axisAnchor = null;
      addNextSelection = false;
      if (selection) {
        event.preventDefault();
        context.engine.clearSelection();
        context.scroller.setAttribute('aria-label', context.viewportLabel);
        context.options.onSelectionChange?.(null);
        context.options.onSelectionRangeChange?.(null);
        context.options.onSelectionRangesChange?.([]);
      }
      context.announceSelection();
      return;
    }
    if (
      !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) ||
      !context.rowCount ||
      !context.columns.length
    )
      return;
    event.preventDefault();
    let row = selection?.rowIndex ?? 0;
    let col = selection?.columnIndex ?? 0;
    if (selection) {
      if (event.key === 'ArrowUp') row--;
      if (event.key === 'ArrowDown') row = (context.engine.getMerge(row, col)?.endRow ?? row) + 1;
      if (event.key === 'ArrowLeft') col--;
      if (event.key === 'ArrowRight') col = (context.engine.getMerge(row, col)?.endColumn ?? col) + 1;
      if (event.key === 'Home') {
        col = 0;
        if (control) row = 0;
      }
      if (event.key === 'End') {
        col = context.columns.length - 1;
        if (control) row = context.rowCount - 1;
      }
    }
    if (!selection && event.key === 'End') {
      col = context.columns.length - 1;
      if (control) row = context.rowCount - 1;
    }
    row = Math.max(0, Math.min(context.rowCount - 1, row));
    col = Math.max(0, Math.min(context.columns.length - 1, col));
    if (context.rowAxis.size(row) === 0)
      row = context.rowAxis.indexAt(
        context.rowAxis.position(row) + (event.key === 'ArrowUp' || event.key === 'End' ? -0.001 : 0),
      );
    if (context.columnAxis.size(col) === 0)
      col = context.columnAxis.indexAt(
        context.columnAxis.position(col) + (event.key === 'ArrowLeft' || event.key === 'End' ? -0.001 : 0),
      );
    if (
      row >= context.rowCount ||
      col >= context.columns.length ||
      context.rowAxis.size(row) === 0 ||
      context.columnAxis.size(col) === 0
    )
      return;
    try {
      select(
        Math.max(0, Math.min(context.rowCount - 1, row)),
        Math.max(0, Math.min(context.columns.length - 1, col)),
        event.shiftKey,
        true,
        addNextSelection && !event.shiftKey,
      );
    } catch (error) {
      context.actionError.textContent =
        error instanceof Error ? context.t(error.message) : context.t('Unable to add selection.');
      context.actionError.style.display = 'block';
    }
  }

  function indexRow(event: MouseEvent): number | null {
    if (!context.indexWidth || !context.columns.length) return null;
    const bounds = context.root.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top - context.headerHeight;
    const view = context.viewport();
    if (x < 0 || x >= context.indexWidth || y < 0 || y >= view.height) return null;
    const row = context.rowAxis.indexAt(y + (y < view.frozenHeight ? 0 : view.scrollTop));
    return row < context.rowCount ? row : null;
  }

  function rowLabels(row: number): string[] {
    const labels: string[] = [];
    if (context.engine.isLocked({ scope: 'table' })) labels.push(context.t('Table locked'));
    if (context.rowValueLocked(row)) labels.push(context.t('Row locked'));
    if (row < context.engine.frozenRows) labels.push(context.t('Row frozen'));
    return labels;
  }

  function clearReorder(): void {
    const pointer = touchReorder?.pointerId;
    touchReorder = null;
    if (pointer !== undefined) {
      dragPointer = null;
      dragPosition = null;
      if (dragFrame !== undefined) context.win.cancelAnimationFrame(dragFrame);
      dragFrame = undefined;
      if (context.root.hasPointerCapture(pointer)) context.root.releasePointerCapture(pointer);
    }
    dragGhost?.remove();
    dragGhost = null;
    context.reorderBadge.style.transform = '';
    reorderDrag = null;
    context.reorderGuide.style.display = context.reorderBadge.style.display = 'none';
    context.root.style.cursor = '';
  }

  function reorderTarget(
    event: DragEvent,
    node: HTMLElement,
    axis: 'row' | 'column',
    first: number,
    last: number,
  ): number {
    const bounds = node.getBoundingClientRect();
    return reorderInsertionIndex(event, bounds, axis, first, last);
  }

  function previewReorder(
    event: Pick<MouseEvent, 'clientX' | 'clientY'>,
    axis: 'row' | 'column',
    first: number,
    last: number,
    bounds: DOMRect,
  ): { beforeIndex: number; allowed: boolean } {
    const beforeIndex = reorderInsertionIndex(event, bounds, axis, first, last);
    context.reorderBadge.style.display = 'block';
    const request = Object.freeze({ axis, indices: Object.freeze([...reorderDrag!.indices]), beforeIndex });
    let allowed = false;
    try {
      allowed = context.options.canReorder?.(request) !== false;
    } catch {
      allowed = false;
    }
    const origin = context.root.getBoundingClientRect();
    const after = beforeIndex === last + 1;
    const edge =
      axis === 'row'
        ? (after ? bounds.bottom : bounds.top) - origin.top
        : (after ? bounds.right : bounds.left) - origin.left;
    context.reorderGuide.style.display = allowed ? 'block' : 'none';
    context.reorderGuide.style.left =
      axis === 'row' ? '0px' : `${Math.max(0, Math.min(context.root.clientWidth - 2, edge - 1))}px`;
    context.reorderGuide.style.top =
      axis === 'column' ? '0px' : `${Math.max(0, Math.min(context.root.clientHeight - 2, edge - 1))}px`;
    context.reorderGuide.style.width = axis === 'row' ? `${context.root.clientWidth}px` : '2px';
    context.reorderGuide.style.height = axis === 'column' ? `${context.root.clientHeight}px` : '2px';
    context.reorderBadge.textContent = allowed
      ? context.t(
          'Move {0} {1}{2} · {3} {4}',
          reorderDrag!.indices.length,
          context.t(axis),
          reorderDrag!.indices.length > 1 ? 's' : '',
          after ? context.t('after') : context.t('before'),
          last === first ? first + 1 : `${first + 1}–${last + 1}`,
        )
      : context.t('Moving here is disabled');
    context.reorderBadge.style.left = '0px';
    context.reorderBadge.style.top = '0px';
    context.reorderBadge.style.transform = `translate(${Math.max(4, Math.min(context.root.clientWidth - context.reorderBadge.offsetWidth - 4, event.clientX - origin.left + 14))}px, ${Math.max(4, Math.min(context.root.clientHeight - context.reorderBadge.offsetHeight - 4, event.clientY - origin.top + 14))}px)`;
    context.reorderBadge.style.display = 'block';
    return { beforeIndex, allowed };
  }

  function startTouchReorder(event: PointerEvent, node: HTMLElement): void {
    if (!context.finishEdit(true)) return;
    event.preventDefault();
    event.stopPropagation();
    onPointerEnd();
    context.closeMenu();
    context.clearChoiceHover();
    const axis = node.dataset.gridReorder as 'row' | 'column',
      first = Number(node.dataset.reorderFirst),
      last = Number(node.dataset.reorderLast);
    const indices =
      first === last ? selectedAxisIndices(axis, first) : Array.from({ length: last - first + 1 }, (_, i) => first + i);
    reorderDrag = { axis, indices };
    touchReorder = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      beforeIndex: first,
    };
    dragPointer = event.pointerId;
    dragPosition = event;
    context.root.setPointerCapture(event.pointerId);
    context.scroller.focus({ preventScroll: true });
    context.root.style.cursor = 'grabbing';
  }

  function updateTouchReorder(position: Pick<MouseEvent, 'clientX' | 'clientY'>): void {
    if (!touchReorder || !reorderDrag) return;
    if (
      !touchReorder.moved &&
      Math.hypot(position.clientX - touchReorder.startX, position.clientY - touchReorder.startY) < 6
    )
      return;
    touchReorder.moved = true;
    if (!dragGhost && context.context) {
      const canvas = context.context.canvas,
        view = context.viewport();
      const first = reorderDrag.indices[0]!;
      const rect = axisCellRect(
        context.engine,
        view,
        reorderDrag.axis === 'row' ? first : 0,
        reorderDrag.axis === 'column' ? first : 0,
      );
      const fixed = first < (reorderDrag.axis === 'row' ? context.engine.frozenRows : context.engine.frozenColumns);
      const x = reorderDrag.axis === 'row' ? 0 : Math.max(fixed ? 0 : view.frozenWidth, rect.x);
      const y =
        reorderDrag.axis === 'row'
          ? Math.max(context.headerHeight + (fixed ? 0 : view.frozenHeight), context.headerHeight + rect.y)
          : 0;
      const width =
        reorderDrag.axis === 'row'
          ? canvas.clientWidth
          : Math.max(0, Math.min(fixed ? view.frozenWidth : canvas.clientWidth, rect.x + rect.width) - x);
      const height =
        reorderDrag.axis === 'row'
          ? Math.max(
              0,
              Math.min(
                fixed ? context.headerHeight + view.frozenHeight : canvas.clientHeight,
                context.headerHeight + rect.y + rect.height,
              ) - y,
            )
          : canvas.clientHeight;
      if (width > 0 && height > 0) {
        dragGhost = context.root.ownerDocument.createElement('canvas');
        dragGhost.dataset.gridDragGhost = reorderDrag.axis;
        dragGhost.setAttribute('aria-hidden', 'true');
        const ratio = canvas.width / canvas.clientWidth;
        dragGhost.width = Math.ceil(width * ratio);
        dragGhost.height = Math.ceil(height * ratio);
        dragGhost
          .getContext('2d')!
          .drawImage(
            canvas,
            x * ratio,
            y * ratio,
            width * ratio,
            height * ratio,
            0,
            0,
            dragGhost.width,
            dragGhost.height,
          );
        dragGhost.style.cssText = `position:absolute;pointer-events:none;z-index:8;opacity:.92;left:${context.indexWidth + x}px;top:${y}px;width:${width}px;height:${height}px;box-shadow:0 4px 16px #0003;outline:1px solid var(--acheron-selection-color)`;
        context.root.append(dragGhost);
      }
    }
    if (dragGhost)
      dragGhost.style.transform =
        reorderDrag.axis === 'row'
          ? `translateY(${position.clientY - touchReorder.startY}px)`
          : `translateX(${position.clientX - touchReorder.startX}px)`;
    const bounds = context.scroller.getBoundingClientRect(),
      view = context.viewport();
    const isRow = reorderDrag.axis === 'row';
    const offset = Math.max(
      0,
      Math.min(
        isRow ? view.height - 0.1 : view.width - 0.1,
        isRow ? position.clientY - bounds.top : position.clientX - bounds.left,
      ),
    );
    const scroll =
      offset < (isRow ? view.frozenHeight : view.frozenWidth) ? 0 : isRow ? view.scrollTop : view.scrollLeft;
    const index = (isRow ? context.rowAxis : context.columnAxis).indexAt(offset + scroll);
    if (index >= (isRow ? context.rowCount : context.columns.length)) return;
    const rect = axisCellRect(context.engine, view, isRow ? index : 0, isRow ? 0 : index);
    touchReorder.beforeIndex = previewReorder(
      position,
      reorderDrag.axis,
      index,
      index,
      new context.win.DOMRect(bounds.left + rect.x, bounds.top + rect.y, rect.width, rect.height),
    ).beforeIndex;
  }

  function commitTouchReorder(event: PointerEvent): void {
    if (event.pointerId !== touchReorder?.pointerId || !reorderDrag) return;
    event.preventDefault();
    event.stopPropagation();
    updateTouchReorder(event);
    const request = Object.freeze({
        axis: reorderDrag.axis,
        indices: Object.freeze([...reorderDrag.indices]),
        beforeIndex: touchReorder.beforeIndex,
      }),
      moved = touchReorder.moved;
    clearReorder();
    if (!moved) return;
    try {
      if (context.options.canReorder?.(request) !== false) context.options.onReorder?.(request);
    } catch (error) {
      context.actionError.textContent =
        error instanceof Error ? context.t(error.message) : context.t('Unable to move items.');
      context.actionError.style.display = 'block';
    }
  }

  function reorderHandle(node: HTMLElement, axis: 'row' | 'column', first: number, last = first): void {
    if (!context.options.onReorder) return;
    const handle = node;
    handle.dataset.gridReorder = axis;
    handle.dataset.reorderFirst = String(first);
    handle.dataset.reorderLast = String(last);
    const selectedAxis = context
      .getSelectionRanges()
      .some((range) =>
        axis === 'row'
          ? range.startColumn === 0 &&
            range.endColumn === context.columns.length - 1 &&
            first >= range.startRow &&
            last <= range.endRow
          : range.startRow === 0 &&
            range.endRow === context.rowCount - 1 &&
            first >= range.startColumn &&
            last <= range.endColumn,
      );
    handle.draggable = selectedAxis;
    if (selectedAxis) {
      handle.style.cursor = 'grab';
      handle.title = context.t('Drag selected items to move; Alt+arrow moves one position');
    }
    handle.addEventListener('dragstart', (event) => {
      if (!selectedAxis || !context.finishEdit(true)) {
        event.preventDefault();
        return;
      }
      const indices =
        first === last
          ? selectedAxisIndices(axis, first)
          : Array.from({ length: last - first + 1 }, (_, i) => first + i);
      reorderDrag = { axis, indices };
      context.reorderBadge.textContent = context.t(
        'Move {0} {1}{2}',
        indices.length,
        context.t(axis),
        indices.length > 1 ? 's' : '',
      );
      context.reorderBadge.style.display = 'block';
      context.reorderBadge.style.left = '8px';
      context.reorderBadge.style.top = '8px';
      context.root.style.cursor = 'grabbing';
      if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', context.t('Move {0}', context.t(axis)));
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setDragImage(context.reorderBadge, 16, 14);
      }
    });
    handle.addEventListener('keydown', (event) => {
      const backward = axis === 'row' ? 'ArrowUp' : 'ArrowLeft';
      const forward = axis === 'row' ? 'ArrowDown' : 'ArrowRight';
      if (!selectedAxis || !event.altKey || (event.key !== backward && event.key !== forward)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!context.finishEdit(true)) return;
      const beforeIndex =
        event.key === backward
          ? Math.max(0, first - 1)
          : Math.min(axis === 'row' ? context.rowCount : context.columns.length, last + 2);
      const request = Object.freeze({
        axis,
        indices: Object.freeze(Array.from({ length: last - first + 1 }, (_, i) => first + i)),
        beforeIndex,
      });
      try {
        if (context.options.canReorder?.(request) !== false) context.options.onReorder?.(request);
      } catch (error) {
        context.actionError.textContent =
          error instanceof Error ? context.t(error.message) : context.t('Unable to move items.');
        context.actionError.style.display = 'block';
      }
    });
    handle.addEventListener('dragend', clearReorder);
    node.addEventListener('dragover', (event) => {
      if (reorderDrag?.axis !== axis) return;
      event.preventDefault();
      const preview = previewReorder(event, axis, first, last, node.getBoundingClientRect());
      if (event.dataTransfer) event.dataTransfer.dropEffect = preview.allowed ? 'move' : 'none';
    });
    node.addEventListener('dragleave', (event) => {
      if (!(event.relatedTarget instanceof context.win.Node) || !node.contains(event.relatedTarget))
        context.reorderGuide.style.display = 'none';
    });
    node.addEventListener('drop', (event) => {
      if (reorderDrag?.axis !== axis) return;
      event.preventDefault();
      event.stopPropagation();
      const request = Object.freeze({
        axis,
        indices: Object.freeze([...reorderDrag.indices]),
        beforeIndex: reorderTarget(event, node, axis, first, last),
      });
      clearReorder();
      try {
        if (context.options.canReorder?.(request) === false) return;
        context.options.onReorder?.(request);
      } catch (error) {
        context.actionError.textContent =
          error instanceof Error ? context.t(error.message) : context.t('Unable to move items.');
        context.actionError.style.display = 'block';
      }
    });
  }

  function onDoubleClick(event: MouseEvent): void {
    const cell = pointerCell(event);
    if (cell && context.openMedia(cell.row, cell.col)) return;
    const selection = context.engine.getSelection();
    if (cell && context.columnEditors.get(context.columns[cell.col]!.key)?.type === 'checkbox') return;
    if (
      event.target !== context.editors.editor &&
      cell &&
      selection?.rowIndex === cell.row &&
      selection.columnIndex === cell.col &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    )
      context.beginEdit();
  }
  return {
    resizeAxis,
    visibleIndices,
    autoFitColumn,
    autoFitRow,
    measureRowHeight,
    onAxisDoubleClick,
    selectedAxisIndices,
    headerColumn,
    selectHeaderGroup,
    onHeaderPointerDown,
    onHeaderPointerMove,
    endResize,
    commitResize,
    cancelResizeKey,
    select,
    selectColumn,
    selectRow,
    selectAll,
    startAxisSelection,
    pointerCell,
    onLinkClick,
    onPointerDown,
    onPointerMove,
    onPointerEnd,
    onKeyDown,
    indexRow,
    rowLabels,
    clearReorder,
    commitTouchReorder,
    reorderHandle,
    onDoubleClick,
    get dragPointer() {
      return dragPointer;
    },
    set dragPointer(value: number | null) {
      dragPointer = value;
    },
    get axisAnchor() {
      return axisAnchor;
    },
    set axisAnchor(value: { axis: 'row' | 'column'; index: number } | null) {
      axisAnchor = value;
    },
    get axisDrag() {
      return axisDrag;
    },
    set axisDrag(value: { axis: 'row' | 'column'; index: number } | null) {
      axisDrag = value;
    },
    get dragPosition() {
      return dragPosition;
    },
    set dragPosition(value: { clientX: number; clientY: number } | null) {
      dragPosition = value;
    },
    get handleAnchor() {
      return handleAnchor;
    },
    set handleAnchor(value: { row: number; col: number } | null) {
      handleAnchor = value;
    },
    get touchSelection() {
      return touchSelection;
    },
    set touchSelection(value: boolean) {
      touchSelection = value;
    },
    get addNextSelection() {
      return addNextSelection;
    },
    set addNextSelection(value: boolean) {
      addNextSelection = value;
    },
    get resizing() {
      return resizing;
    },
    set resizing(
      value: {
        pointerId: number;
        axis: 'column' | 'row';
        index: number;
        start: number;
        size: number;
        proposed: number;
        edge: number;
      } | null,
    ) {
      resizing = value;
    },
  };
}

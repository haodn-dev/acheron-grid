import type { GridContext } from './internal/grid-context.js';
import { createRendering } from './internal/rendering.js';
import { createMenus } from './internal/menus.js';
import { createAccessibility } from './internal/accessibility.js';
import { createInteraction } from './internal/interaction.js';
import { createEditors } from './internal/editors.js';
import { createMediaController } from './internal/media-controller.js';
import { createClipboard } from './internal/clipboard.js';
import { createSearch } from './internal/search.js';
import { createOverlay } from './internal/overlay.js';
import { createMotion, resolveMotion } from './internal/motion.js';
import { createNumberDisplay, createRichDisplay } from './internal/display.js';
import { reorderInsertionIndex } from './internal/reorder-geometry.js';
import { validateColumnEditor } from './internal/editor-config.js';
import { createCanvasTranslator } from './locale.js';
import { installTooltips } from './tooltips.js';
import { icons } from './icons.js';
import { choicePanel, choiceValue, positionChoicePanel, disposeChoicePanel } from './choices.js';
import type { ChoiceEditorOptions, ChoiceOption } from './choices.js';
import { mediaItems, parseMediaValue, validateMediaValue } from './media.js';
import { createMediaEditor } from './media-editor.js';
import type { MediaItem } from './media.js';
import { reorderedIndices } from './reorder.js';
import type { ReorderRequest, RowChangeRequest } from './reorder.js';
import { headerLayout, reorderedHeaderGroups } from './headers.js';
import type { HeaderGroup } from './headers.js';
import { safeWebUrl, detectLinks } from './links.js';
import { readHtml, layoutRichText, richTextHtml, richTextSource } from './rich-text.js';
import type { RichText, RichTextFormat } from './rich-text.js';
import {
  createGridEngine,
  restoreGridConfiguration,
  gridClipboardType,
  decodeBlocks,
  encodeBlocks,
  blocksToTsv,
} from '@acheron-grid/core';
import type {
  GridConfiguration,
  GridState,
  GridEngine,
  ClipboardBlock,
  RowId,
  PasteOptions,
  NumberFormat,
} from '@acheron-grid/core';
import type {
  CellUpdate,
  DataRow,
  DataSource,
  Column,
  CellSelection,
  SelectionRange,
  CellPermission,
  CellLockTarget,
  CellFormatTarget,
  CellFormat,
  CellFormatPatch,
  LocalViewOptions,
  GridEngineOptions,
  ViewportRegion,
  RowGroup,
} from '@acheron-grid/core';

let editorId = 0;
let gridId = 0;

export type {
  Column,
  CellSelection,
  SelectionRange,
  CellLockTarget,
  CellFormatTarget,
  CellFormat,
  CellFormatPatch,
} from '@acheron-grid/core';
export interface CellRenderInfo {
  readonly value: unknown;
  readonly previousValue?: unknown;
  readonly animationProgress?: number;
  readonly format: Readonly<CellFormat>;
  readonly rowIndex: number;
  readonly rowId: string | number;
  readonly columnIndex: number;
  readonly columnKey: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export type CellRenderer = (context: CanvasRenderingContext2D, cell: CellRenderInfo) => boolean;
export type CellEditor = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
export interface CellEditorInfo extends CellSelection {
  readonly value: unknown;
}
export type CellEditorFactory = (cell: Readonly<CellEditorInfo>, document: Document) => CellEditor | null;
export interface GridTheme {
  background: string;
  textColor: string;
  headerBackground: string;
  headerTextColor: string;
  iconColor: string;
  searchHighlightColor: string;
  gridLineColor: string;
  selectionColor: string;
  freezeColor: string;
  scrollbarColor: string;
  font: string;
  headerFont: string;
  linkColor: string;
  increaseColor: string;
  decreaseColor: string;
}
export type { ChoiceOption } from './choices.js';
export type ColumnEditor =
  | {
      readonly type: 'select' | 'multiselect';
      readonly values: readonly (string | ChoiceOption)[];
      readonly choiceEditor?: ChoiceEditorOptions | false;
    }
  | { readonly type: 'checkbox' };
export interface ColumnType {
  readonly key: string;
  readonly label: string;
  readonly create: (input: Readonly<{ key: string; title: string; defaultText: string }>) => {
    column: Column;
    editor?: ColumnEditor;
  };
}
export interface MotionOptions {
  readonly duration?: number;
  readonly easing?: string;
  readonly selectionDuration?: number;
  readonly surfaceDuration?: number;
  readonly layout?: boolean;
  readonly selection?: boolean;
  readonly surfaces?: boolean;
  readonly liveSort?: boolean;
  readonly valueIndicators?: boolean;
  readonly chartUpdates?: boolean;
}

export interface GridOptions extends Pick<
  GridEngineOptions,
  | 'permissions'
  | 'resolveCellPermission'
  | 'onEvent'
  | 'allowLockChanges'
  | 'frozenRows'
  | 'frozenColumns'
  | 'canChangeStructure'
  | 'columnWidths'
  | 'canChangeVisibility'
  | 'historyLimits'
> {
  allowMerging?: boolean;
  allowRowGrouping?: boolean;
  canChangeLayout?: GridEngineOptions['canChangeLayout'];
  locale?: string;
  messages?: Readonly<Record<string, string>>;
  currency?: string;
  view?: LocalViewOptions;
  viewMode?: 'core' | 'host';
  onViewChange?: (view: LocalViewOptions) => void;
  theme?: Partial<GridTheme>;
  imageColumns?: readonly string[];
  avatarColumns?: readonly string[];
  mediaOptions?: {
    readonly size?: number;
    readonly maxVisible?: number;
    readonly maxConcurrentUploads?: number;
    readonly upload?: (
      file: File,
      context: Readonly<{
        columnKey: string;
        signal: AbortSignal;
        onProgress: (loaded: number, total?: number) => void;
      }>,
    ) => Promise<MediaItem>;
  };
  columnEditors?: Readonly<Record<string, ColumnEditor>>;
  richTextColumns?: Readonly<Record<string, RichTextFormat>>;
  markdownToHtml?: (source: string) => string;
  multilineEditor?: boolean;
  editorOptions?: {
    readonly pinned?: boolean;
    readonly showLabel?: boolean | 'scroll' | 'always';
    readonly guardNavigation?: boolean;
  };
  wrapText?: boolean;
  detectLinks?: boolean;
  allowOpenLinks?: boolean;
  contextMenuSuggestions?: boolean;
  linkPreview?:
    | boolean
    | {
        readonly enabled?: boolean;
        readonly allowMetadata?: boolean;
        readonly load: (
          href: string,
          signal: AbortSignal,
        ) => Promise<{ readonly title?: string; readonly description?: string; readonly image?: string }>;
      };
  accessibility?: 'active' | 'viewport';
  getCellLabel?: (rowIndex: number, columnKey: string, value: unknown) => string | undefined;
  renderCell?: CellRenderer;
  createEditor?: CellEditorFactory;
  onEditorMount?: (cell: Readonly<CellEditorInfo>, editor: CellEditor) => void | (() => void);
  onObserverError?: GridEngineOptions['onObserverError'];
  choiceEditor?: ChoiceEditorOptions | false;
  motion?: boolean | MotionOptions;
  tableLockNotice?: false | { readonly title?: string; readonly description?: string };
  selectionStyle?: {
    readonly activeCellBorderInRange?: boolean;
    readonly activeBorderWidth?: number;
    readonly headerTintOpacity?: number;
    readonly rangeBorderWidth?: number;
    readonly rangeTintOpacity?: number;
  };
  allowColumnChanges?: boolean;
  columnTypes?: readonly ColumnType[];
  onRowChange?: (request: Readonly<RowChangeRequest>) => void;
  canRowChange?: (request: Readonly<RowChangeRequest>) => boolean;
  onReorder?: (request: Readonly<ReorderRequest>) => void;
  canReorder?: (request: Readonly<ReorderRequest>) => boolean;
  onSelectionChange?: (selection: CellSelection | null) => void;
  onSelectionRangesChange?: (ranges: readonly SelectionRange[]) => void;
  onSelectionRangeChange?: (range: SelectionRange | null) => void;
  container: HTMLElement;
  columns: readonly Column[];
  dataSource: DataSource;
  rowHeight?: number;
  columnWidth?: number;
  headerHeight?: number;
  headerGroups?: readonly HeaderGroup[];
  autoRowHeight?: boolean;
  measureCellHeight?: (value: unknown, columnKey: string, width: number) => number | undefined;
  indexColumn?: boolean;
}
export interface Grid {
  getMotion: () => Readonly<Required<MotionOptions>>;
  setMotion: (value: boolean | MotionOptions) => void;
  updateCellsAsync: GridEngine['updateCellsAsync'];
  pasteAsync: GridEngine['pasteAsync'];
  undoAsync: GridEngine['undoAsync'];
  redoAsync: GridEngine['redoAsync'];
  setViewAsync: GridEngine['setViewAsync'];
  getValue(rowIndex: number, columnKey: string): unknown;
  replaceText(
    search: string,
    replacement: string,
    options?: Parameters<GridEngine['replaceText']>[2],
  ): ReturnType<GridEngine['replaceText']>;
  subscribe: GridEngine['subscribe'];
  takeObserverErrors: GridEngine['takeObserverErrors'];
  captureRowIdentity(): readonly RowId[];
  refreshData(previousRowIds?: readonly RowId[] | 'values'): void;
  exportState(): GridState;
  restoreState(state: unknown): void;
  setColumnEditor(key: string, editor: ColumnEditor | null): void;
  exportConfiguration(): GridConfiguration;
  getMerge(row: number, col: number): Readonly<SelectionRange> | null;
  getMergedCells(): readonly Readonly<SelectionRange>[];
  canMerge(range: SelectionRange): boolean;
  mergeCells(range: SelectionRange): void;
  unmergeCells(range: SelectionRange): void;
  getRowGroups(): readonly Readonly<RowGroup>[];
  groupRows(start: number, end: number): string;
  ungroupRows(id: string): void;
  setGroupCollapsed(id: string, collapsed: boolean): void;
  setView(view: LocalViewOptions): void;
  readonly view: Readonly<LocalViewOptions>;
  readonly rowCount: number;
  readonly columns: readonly Column[];
  insertColumns(index: number, columns: readonly Column[]): void;
  deleteColumns(indices: readonly number[]): void;
  insertRows(index: number, rows: readonly DataRow[]): void;
  deleteRows(indices: readonly number[]): void;
  moveRows(indices: readonly number[], beforeIndex: number): void;
  moveColumns(indices: readonly number[], beforeIndex: number): void;
  render(): void;
  setTheme(theme: Partial<GridTheme>): void;
  openSearch(): void;
  selectColumn(index: number): void;
  selectRow(index: number): void;
  selectAll(): void;
  autoFitColumn(index: number): void;
  autoFitRow(index: number): void;
  readonly frozenRows: number;
  readonly frozenColumns: number;
  setRowsHidden: GridEngine['setRowsHidden'];
  setColumnsHidden: GridEngine['setColumnsHidden'];
  getHiddenRows: GridEngine['getHiddenRows'];
  getHiddenColumns: GridEngine['getHiddenColumns'];
  isRowHidden: GridEngine['isRowHidden'];
  isColumnHidden: GridEngine['isColumnHidden'];
  setFrozen(rows: number, columns: number): void;
  isLocked(target: CellLockTarget): boolean;
  canManageLocks(): boolean;
  setLocked(target: CellLockTarget, locked: boolean): void;
  getFormat(rowIndex: number, columnIndex: number): Readonly<CellFormat>;
  canFormat(targets: readonly CellFormatTarget[]): boolean;
  format(targets: readonly CellFormatTarget[], patch: CellFormatPatch | null): void;
  updateCells(updates: readonly CellUpdate[]): void;
  undo(): boolean;
  redo(): boolean;
  getCellPermission(rowIndex: number, columnIndex: number): CellPermission;
  getSelection(): CellSelection | null;
  getSelectionRange(): SelectionRange | null;
  getSelectionRanges(): SelectionRange[];
  cutSelectionBlocks(): string;
  cancelCut(): void;
  copySelectionBlocks(): string;
  pasteSelectionBlocks(text: string, options?: PasteOptions): void;
  copySelection(): string;
  paste(text: string, options?: PasteOptions): void;
  setColumnWidth(index: number, width: number): void;
  setRowHeight(index: number, height: number): void;
  destroy(): void;
}

const stateIconSvg = {
  lock: icons.lock,
  'arrow-up': icons['arrow-up'],
  'arrow-down': icons['arrow-down'],
  funnel: icons.funnel,
  'chevron-down': icons['chevron-down'],
} as const;

/** Mount a grid. The caller owns the container and its dimensions. */
export function createGrid(options: GridOptions): Grid {
  const { container, dataSource } = options;
  const t = createCanvasTranslator(options.locale, options.messages);
  const gridContext: GridContext = {
    options,
    get engine() {
      return engine;
    },
    env: {
      get doc() {
        return doc;
      },
      get win() {
        return win;
      },
      get t() {
        return t;
      },
    },
    layout: {
      get columns() {
        return columns;
      },
      set columns(value) {
        columns = value;
      },
      get rowCount() {
        return rowCount;
      },
      set rowCount(value) {
        rowCount = value;
      },
      get headers() {
        return headers;
      },
      set headers(value) {
        headers = value;
      },
      get leafHeaders() {
        return leafHeaders;
      },
      set leafHeaders(value) {
        leafHeaders = value;
      },
      get currentView() {
        return currentView;
      },
      set currentView(value) {
        currentView = value;
      },
      get headerHeight() {
        return headerHeight;
      },
      set headerHeight(value) {
        headerHeight = value;
      },
      get indexWidth() {
        return indexWidth;
      },
      set indexWidth(value) {
        indexWidth = value;
      },
    },
    appearance: {
      get theme() {
        return theme;
      },
      set theme(value) {
        theme = value;
      },
    },
    runtime: {
      get destroyed() {
        return destroyed;
      },
      set destroyed(value) {
        destroyed = value;
      },
      get frame() {
        return rendering.frame;
      },
      set frame(value) {
        rendering.frame = value;
      },
    },
  };
  const numberText = createNumberDisplay(gridContext.options);
  let motionSettings = resolveMotion(gridContext.options.motion, container.ownerDocument);
  let motionDuration = motionSettings.duration;

  const managesView =
    gridContext.options.viewMode === 'core' ||
    (gridContext.options.viewMode !== 'host' && !gridContext.options.onViewChange);
  let currentView = gridContext.options.view;
  const activeBorderWidth = gridContext.options.selectionStyle?.activeBorderWidth ?? 1;
  const rangeBorderWidth = gridContext.options.selectionStyle?.rangeBorderWidth ?? 1;
  const rangeTintOpacity = gridContext.options.selectionStyle?.rangeTintOpacity ?? 0.06;
  if (
    !Number.isFinite(rangeBorderWidth) ||
    rangeBorderWidth < 1 ||
    rangeBorderWidth > 4 ||
    !Number.isFinite(rangeTintOpacity) ||
    rangeTintOpacity < 0 ||
    rangeTintOpacity > 1
  )
    throw new RangeError('Invalid range selection style.');
  const headerTintOpacity = gridContext.options.selectionStyle?.headerTintOpacity ?? 0.12;
  if (
    !Number.isFinite(activeBorderWidth) ||
    activeBorderWidth < 1 ||
    activeBorderWidth > 4 ||
    !Number.isFinite(headerTintOpacity) ||
    headerTintOpacity < 0 ||
    headerTintOpacity > 1
  )
    throw new RangeError('Invalid selection style.');
  const doc = container.ownerDocument;
  const { richTextColumns, richText, displayedText, clearDisplayCache } = createRichDisplay({
    options: gridContext.options,
    doc: gridContext.env.doc,
    t: gridContext.env.t,
    numberText,
  });
  const win = gridContext.env.doc.defaultView!;
  let theme = Object.freeze({
    background: '#ffffff',
    textColor: '#0f172a',
    headerBackground: '#edf2f7',
    headerTextColor: '#334155',
    iconColor: '#475569',
    searchHighlightColor: '#f59e0b',
    gridLineColor: '#e2e8f0',
    selectionColor: '#2563eb',
    freezeColor: '#94a3b8',
    scrollbarColor: '#a8b6c8',
    linkColor: '#2563eb',
    increaseColor: '#16803c',
    decreaseColor: '#c8284d',
    font: '400 13px system-ui, sans-serif',
    headerFont: '600 13px system-ui, sans-serif',
    ...gridContext.options.theme,
  });
  function validateTheme(candidate: GridTheme): void {
    for (const [key, value] of Object.entries(candidate)) {
      const property = key === 'font' || key === 'headerFont' ? 'font' : 'color';
      if (
        typeof value !== 'string' ||
        /var\(|currentcolor|^(inherit|initial|unset|revert)/i.test(value.trim()) ||
        !gridContext.env.win.CSS.supports(property, value)
      ) {
        throw new TypeError(`Invalid grid theme ${key}. Use a concrete CSS ${property} value.`);
      }
    }
  }
  validateTheme(gridContext.appearance.theme);
  const rendering = createRendering({
    get motionSettings() {
      return motionSettings;
    },
    fadeSelection: (rects) => motion.fadeSelection(rects),
    animateFeedback: (node, frames) => motion.animateFeedback(node, frames),
    openViewDialog: (col, sort) => menus.openViewDialog(col, sort),
    get accessibility() {
      return accessibility;
    },
    get accessibleBody() {
      return accessibleBody;
    },
    get accessibleCell() {
      return accessibleCell;
    },
    get actionError() {
      return actionError;
    },
    get activeBorderWidth() {
      return activeBorderWidth;
    },
    get activeCell() {
      return activeCell;
    },
    get activeRow() {
      return activeRow;
    },
    get avatarColumns() {
      return avatarColumns;
    },
    get canvas() {
      return canvas;
    },
    get closeMenu() {
      return closeMenu;
    },
    get columnAxis() {
      return columnAxis;
    },
    get columnEditors() {
      return columnEditors;
    },
    get columns() {
      return gridContext.layout.columns;
    },
    get context() {
      return context;
    },
    get currentView() {
      return gridContext.layout.currentView;
    },
    get destroyed() {
      return gridContext.runtime.destroyed;
    },
    get doc() {
      return gridContext.env.doc;
    },
    get editors() {
      return editors;
    },
    get endResize() {
      return endResize;
    },
    get engine() {
      return gridContext.engine;
    },
    get enteringGroups() {
      return enteringGroups;
    },
    get finishEdit() {
      return finishEdit;
    },
    get freezeHorizontal() {
      return freezeHorizontal;
    },
    get freezeVertical() {
      return freezeVertical;
    },
    get getSelectionRange() {
      return getSelectionRange;
    },
    get getSelectionRanges() {
      return getSelectionRanges;
    },
    get headerHeight() {
      return gridContext.layout.headerHeight;
    },
    get headerRowHeight() {
      return headerRowHeight;
    },
    get headerSurface() {
      return headerSurface;
    },
    get headerTintOpacity() {
      return headerTintOpacity;
    },
    get headers() {
      return gridContext.layout.headers;
    },
    get highlightSearch() {
      return highlightSearch;
    },
    get indexGutter() {
      return indexGutter;
    },
    get indexWidth() {
      return gridContext.layout.indexWidth;
    },
    get interaction() {
      return interaction;
    },
    get leafHeaders() {
      return gridContext.layout.leafHeaders;
    },
    get measureRowHeight() {
      return measureRowHeight;
    },
    get mediaColumn() {
      return mediaColumn;
    },
    get mediaController() {
      return mediaController;
    },
    get mediaLimit() {
      return mediaLimit;
    },
    get mediaSize() {
      return mediaSize;
    },
    get motionEnabled() {
      return motionEnabled;
    },
    get numberText() {
      return numberText;
    },
    get openMenu() {
      return openMenu;
    },
    get options() {
      return gridContext.options;
    },
    get positionEditor() {
      return positionEditor;
    },
    get rangeBorderWidth() {
      return rangeBorderWidth;
    },
    get rangeTintOpacity() {
      return rangeTintOpacity;
    },
    get releaseUnusedImages() {
      return releaseUnusedImages;
    },
    get reorderHandle() {
      return reorderHandle;
    },
    get richText() {
      return richText;
    },
    get root() {
      return root;
    },
    get rowAxis() {
      return rowAxis;
    },
    get rowCount() {
      return gridContext.layout.rowCount;
    },
    get rowLabels() {
      return rowLabels;
    },
    get rowLockSvg() {
      return rowLockSvg;
    },
    get scroller() {
      return scroller;
    },
    get selectAll() {
      return selectAll;
    },
    get selectHeaderGroup() {
      return selectHeaderGroup;
    },
    get selectRow() {
      return selectRow;
    },
    get selectionHandles() {
      return selectionHandles;
    },
    get startAxisSelection() {
      return startAxisSelection;
    },
    get stateIconSvg() {
      return stateIconSvg;
    },
    get stateIcons() {
      return stateIcons;
    },
    get stateLabels() {
      return stateLabels;
    },
    get structureAction() {
      return structureAction;
    },
    get syncAccessibleCell() {
      return syncAccessibleCell;
    },
    get t() {
      return gridContext.env.t;
    },
    get theme() {
      return gridContext.appearance.theme;
    },
    get viewportAccessibility() {
      return viewportAccessibility;
    },
    get visibleIndices() {
      return visibleIndices;
    },
    get win() {
      return gridContext.env.win;
    },
  });
  const {
    svgIcon,
    invalidate,
    updateCells,
    replay,
    cellLinks,
    linksForValue,
    validationMessage,
    rowValueLocked,
    viewport,
    draw,
    render,
    schedule,
  } = rendering;
  const indicatorPolicy = Object.freeze({ ...gridContext.options.permissions });
  let headers = headerLayout(gridContext.options.columns, gridContext.options.headerGroups);
  const headerRowHeight = gridContext.options.headerHeight ?? 36;
  let headerHeight = headerRowHeight * gridContext.layout.headers.levels;
  let leafHeaders = gridContext.layout.headers.cells.filter((cell) => cell.leaf).sort((a, b) => a.start - b.start);
  if (!Number.isFinite(gridContext.layout.headerHeight) || gridContext.layout.headerHeight <= 0)
    throw new RangeError('Grid sizes must be positive finite numbers.');
  const engine = createGridEngine({
    columns: gridContext.options.columns.map((column) =>
      (gridContext.options.imageColumns?.includes(column.key) ||
        gridContext.options.avatarColumns?.includes(column.key)) &&
      !column.parse
        ? { ...column, parse: parseMediaValue }
        : column,
    ),
    dataSource,
    ...(gridContext.options.historyLimits ? { historyLimits: gridContext.options.historyLimits } : {}),
    ...(gridContext.options.allowMerging === undefined ? {} : { allowMerging: gridContext.options.allowMerging }),
    ...(gridContext.options.allowRowGrouping === undefined
      ? {}
      : { allowRowGrouping: gridContext.options.allowRowGrouping }),
    ...(gridContext.options.canChangeLayout === undefined
      ? {}
      : { canChangeLayout: gridContext.options.canChangeLayout }),
    ...(managesView && gridContext.options.view ? { view: gridContext.options.view } : {}),
    ...(gridContext.options.rowHeight === undefined ? {} : { rowHeight: gridContext.options.rowHeight }),
    ...(gridContext.options.columnWidths === undefined ? {} : { columnWidths: gridContext.options.columnWidths }),
    ...(gridContext.options.columnWidth === undefined ? {} : { columnWidth: gridContext.options.columnWidth }),
    ...(gridContext.options.canChangeVisibility
      ? { canChangeVisibility: gridContext.options.canChangeVisibility }
      : {}),
    canChangeStructure: (request) => {
      if (gridContext.options.canChangeStructure?.(request) === false) return false;
      if (request.axis === 'column') {
        if (request.kind === 'insert' && !request.columns) return true;
        try {
          const next =
            request.columns ??
            (request.kind === 'delete'
              ? gridContext.engine.columns.filter((_, i) => !request.indices.includes(i))
              : (
                  request.order ??
                  reorderedIndices(gridContext.engine.columns.length, request.indices, request.beforeIndex)
                ).map((i) => gridContext.engine.columns[i]!));
          reorderedHeaderGroups(next, gridContext.options.headerGroups);
        } catch {
          return false;
        }
      }
      return true;
    },
    ...(gridContext.options.permissions === undefined ? {} : { permissions: gridContext.options.permissions }),
    ...(gridContext.options.resolveCellPermission === undefined
      ? {}
      : { resolveCellPermission: gridContext.options.resolveCellPermission }),
    ...(gridContext.options.onEvent === undefined ? {} : { onEvent: gridContext.options.onEvent }),
    ...(gridContext.options.onObserverError === undefined
      ? {}
      : { onObserverError: gridContext.options.onObserverError }),
    ...(gridContext.options.allowLockChanges === undefined
      ? {}
      : { allowLockChanges: gridContext.options.allowLockChanges }),
    ...(gridContext.options.frozenRows === undefined ? {} : { frozenRows: gridContext.options.frozenRows }),
    ...(gridContext.options.frozenColumns === undefined ? {} : { frozenColumns: gridContext.options.frozenColumns }),
    onInvalidate(change) {
      const menu = overlay.menu;
      if (menu && change.type === 'structure') {
        const col = Number(menu.dataset.gridMenuColumn),
          row = Number(menu.dataset.gridMenuRow);
        if (
          !Number.isSafeInteger(col) ||
          change.columnMap[col] !== col ||
          (menu.dataset.gridMenuHeader !== 'true' && change.rowMap[row] !== row)
        )
          closeMenu();
      } else if (menu && (change.type === 'layout' || change.type === 'selection')) closeMenu();
      if (change.type !== 'selection') clearCopyFeedback();
      if (change.type === 'cells') {
        if (gridContext.engine.getMergedCells().length) rendering.fullDraw = true;
        if (gridContext.options.autoRowHeight) {
          change.cells.forEach((cell) => rendering.measuredRows.delete(cell.rowIndex));
          rendering.fullDraw = true;
        }
        invalidate(change.cells);
        if (!searchBar.hidden) refreshSearch();
      } else if (change.type === 'layout' || change.type === 'structure') {
        if (change.type === 'structure') {
          editors.hoveredChoice = null;
          if (managesView) gridContext.layout.currentView = gridContext.engine.view;
          if (interaction.axisAnchor) {
            const map = interaction.axisAnchor.axis === 'row' ? change.rowMap : change.columnMap,
              next = map[interaction.axisAnchor.index];
            interaction.axisAnchor =
              next !== undefined && next >= 0 ? { ...interaction.axisAnchor, index: next } : null;
          }
          onPointerEnd();
          gridContext.layout.columns = gridContext.engine.columns;
          gridContext.layout.rowCount = gridContext.engine.rowCount;
          const outline = gridContext.engine.getRowGroups();
          const levels = outline.reduce(
            (max, group) =>
              Math.max(
                max,
                outline.filter((other) => other.startRow <= group.startRow && other.endRow >= group.endRow).length,
              ),
            0,
          );
          gridContext.layout.indexWidth =
            gridContext.options.indexColumn === false
              ? 0
              : Math.max(48, String(gridContext.engine.sourceRowCount).length * 8 + 16) + levels * 24;
          scroller.style.left =
            headerSurface.style.left =
            canvas.style.left =
            indexGutter.style.width =
              String(gridContext.layout.indexWidth) + 'px';
          gridContext.layout.headers = headerLayout(
            gridContext.layout.columns,
            reorderedHeaderGroups(gridContext.layout.columns, gridContext.options.headerGroups),
          );
          gridContext.layout.headerHeight = headerRowHeight * gridContext.layout.headers.levels;
          headerSurface.style.height = scroller.style.top = `${gridContext.layout.headerHeight}px`;
          if (viewportAccessibility) {
            headerSurface.setAttribute('role', gridContext.layout.headers.levels > 1 ? 'rowgroup' : 'row');
            if (gridContext.layout.headers.levels === 1) headerSurface.setAttribute('aria-rowindex', '1');
            else headerSurface.removeAttribute('aria-rowindex');
          }
          gridContext.layout.leafHeaders = gridContext.layout.headers.cells
            .filter((cell) => cell.leaf)
            .sort((a, b) => a.start - b.start);
          if (
            headerSurface.contains(gridContext.env.doc.activeElement) ||
            indexGutter.contains(gridContext.env.doc.activeElement)
          )
            scroller.focus({ preventScroll: true });
          indexGutter.replaceChildren();
          clearReorder();
          rendering.measuredRows.clear();
          accessibility.accessibleCells.clear();
          accessibleBody.replaceChildren();
          scroller.setAttribute(
            'aria-rowcount',
            String(gridContext.layout.rowCount + (viewportAccessibility ? gridContext.layout.headers.levels : 0)),
          );
          scroller.setAttribute('aria-colcount', String(gridContext.layout.columns.length));
          if (!searchBar.hidden) refreshSearch();
          syncAccessibleCell();
          gridContext.options.onSelectionChange?.(gridContext.engine.getSelection());
          gridContext.options.onSelectionRangesChange?.(gridContext.engine.getSelectionRanges());
          gridContext.options.onSelectionRangeChange?.(gridContext.engine.getSelectionRange());
        }
        spacer.style.width = String(columnAxis.position(gridContext.layout.columns.length)) + 'px';
        spacer.style.height = String(rowAxis.position(gridContext.layout.rowCount)) + 'px';
        render();
      } else render();
    },
  });
  let columns = gridContext.engine.columns,
    rowCount = gridContext.engine.rowCount;
  const { rows: rowAxis, columnsLayout: columnAxis } = gridContext.engine;
  let indexWidth =
    gridContext.options.indexColumn === false ? 0 : Math.max(48, String(gridContext.layout.rowCount).length * 8 + 16);
  if (gridContext.options.imageColumns !== undefined && !Array.isArray(gridContext.options.imageColumns))
    throw new TypeError('Image columns must be column keys.');
  const imageColumns = new Set(gridContext.options.imageColumns ?? []);
  if (gridContext.options.avatarColumns !== undefined && !Array.isArray(gridContext.options.avatarColumns))
    throw new TypeError('Avatar columns must be column keys.');
  const avatarColumns = new Set(gridContext.options.avatarColumns ?? []);
  for (const key of avatarColumns)
    if (!gridContext.layout.columns.some((column) => column.key === key) || imageColumns.has(key))
      throw new TypeError('Unknown or conflicting avatar column.');
  const mediaSize = gridContext.options.mediaOptions?.size ?? 32,
    mediaLimit = gridContext.options.mediaOptions?.maxVisible ?? 4;
  if (
    !Number.isFinite(mediaSize) ||
    mediaSize < 20 ||
    mediaSize > 96 ||
    !Number.isSafeInteger(mediaLimit) ||
    mediaLimit < 1 ||
    mediaLimit > 20
  )
    throw new RangeError('Invalid media size or visible count.');
  const mediaColumn = (key: string) => imageColumns.has(key) || avatarColumns.has(key);
  const mediaController = createMediaController({
    get avatarColumns() {
      return avatarColumns;
    },
    get columns() {
      return gridContext.layout.columns;
    },
    get destroyed() {
      return gridContext.runtime.destroyed;
    },
    get doc() {
      return gridContext.env.doc;
    },
    get engine() {
      return gridContext.engine;
    },
    get finishEdit() {
      return finishEdit;
    },
    get getSelectionRanges() {
      return getSelectionRanges;
    },
    get mediaColumn() {
      return mediaColumn;
    },
    get options() {
      return gridContext.options;
    },
    get overlay() {
      return overlay;
    },
    get pasteSelectionBlocks() {
      return pasteSelectionBlocks;
    },
    get root() {
      return root;
    },
    get scroller() {
      return scroller;
    },
    get t() {
      return gridContext.env.t;
    },
    get win() {
      return gridContext.env.win;
    },
  });
  const { pasteImages, openMedia, releaseUnusedImages } = mediaController;

  for (const key of imageColumns)
    if (!gridContext.layout.columns.some((column) => column.key === key)) throw new TypeError('Unknown image column.');

  const columnEditors = new Map<string, ColumnEditor>();

  for (const [key, config] of Object.entries(gridContext.options.columnEditors ?? {})) {
    const column = gridContext.layout.columns.find((column) => column.key === key);
    if (!column) throw new TypeError('Unknown editor column.');
    columnEditors.set(key, validateColumnEditor(column, config));
  }

  const viewportAccessibility = gridContext.options.accessibility === 'viewport';
  if (
    gridContext.options.accessibility !== undefined &&
    !['active', 'viewport'].includes(gridContext.options.accessibility)
  )
    throw new TypeError('Invalid accessibility mode.');
  const root = gridContext.env.doc.createElement('div');
  root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;background:var(--acheron-background)';
  for (const [key, value] of Object.entries(gridContext.appearance.theme))
    root.style.setProperty('--acheron-' + key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()), value);
  const dialogStyles = gridContext.env.doc.createElement('style');
  dialogStyles.textContent = `
    dialog[data-grid-dialog] { position:fixed;inset:0;margin:auto;width:min(420px,calc(100% - 32px));max-width:none;max-height:calc(100% - 32px);overflow:auto;box-sizing:border-box;padding:24px;border:1px solid var(--acheron-grid-line-color);border-radius:12px;box-shadow:0 16px 48px #0f172a33;background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font);line-height:1.5 }
    dialog[data-grid-dialog][open], dialog[data-grid-dialog] form { display:flex;flex-direction:column;gap:14px }
    [data-grid-viewport], dialog[data-grid-dialog] { scrollbar-width:thin;scrollbar-color:var(--acheron-scrollbar-color) var(--acheron-header-background) }
    [data-grid-viewport]::-webkit-scrollbar, dialog[data-grid-dialog]::-webkit-scrollbar { width:8px;height:8px }
    [data-grid-viewport]::-webkit-scrollbar-thumb, dialog[data-grid-dialog]::-webkit-scrollbar-thumb { background:var(--acheron-scrollbar-color);border:2px solid var(--acheron-header-background);border-radius:8px }
    [data-grid-viewport]::-webkit-scrollbar-track, [data-grid-viewport]::-webkit-scrollbar-corner { background:var(--acheron-header-background) }
    [data-grid-viewport]::-webkit-scrollbar-button { display:none }
    .acheron-context-menu { scrollbar-width:thin;scrollbar-color:var(--acheron-scrollbar-color) transparent }
    .acheron-context-menu::-webkit-scrollbar { width:6px;height:6px }
    .acheron-context-menu::-webkit-scrollbar-thumb { background:var(--acheron-scrollbar-color);border-radius:6px }
    .acheron-context-menu::-webkit-scrollbar-track { background:transparent }
    .acheron-context-menu::-webkit-scrollbar-button { display:none }
    dialog[data-grid-dialog]::backdrop { background:#0f172a55 }
    dialog[data-grid-dialog] p { margin:0 }
    dialog[data-grid-dialog] > p:first-child { font-size:16px;font-weight:600 }
    dialog[data-grid-dialog] [role=alert]:empty { display:none }
    dialog[data-grid-dialog] [role=alert] { color:#9f1239 }
    dialog[data-grid-dialog] label { display:flex;align-items:center;gap:8px;flex-wrap:wrap }
    dialog[data-grid-dialog] input, dialog[data-grid-dialog] select, dialog[data-grid-dialog] button { box-sizing:border-box;font:inherit;color:inherit;border:1px solid var(--acheron-grid-line-color);border-radius:6px;background:var(--acheron-background);padding:8px 12px }
    dialog[data-grid-dialog] input:not([type=checkbox]):not([type=color]), dialog[data-grid-dialog] select { width:100%;min-width:0 }
    dialog[data-grid-dialog] input[type=checkbox] { width:16px;height:16px;padding:0;accent-color:var(--acheron-selection-color) }
    dialog[data-grid-dialog] input[type=color] { width:48px;height:36px;padding:3px }
    dialog[data-grid-dialog] button { cursor:pointer;background:var(--acheron-header-background);margin:0 }
    dialog[data-grid-dialog] button:first-child { border-color:var(--acheron-selection-color);font-weight:600 }
    dialog[data-grid-dialog] :disabled { opacity:.5;cursor:default }
    dialog[data-grid-dialog] :focus-visible { outline:2px solid var(--acheron-selection-color);outline-offset:2px }
    [data-grid-row-group]:hover:not(:disabled) { background:color-mix(in srgb,var(--acheron-icon-color) 12%,var(--acheron-header-background))!important;color:var(--acheron-text-color)!important }
    [data-grid-row-group]:focus-visible { outline:1px solid var(--acheron-selection-color);outline-offset:1px }
    [data-severity=warning] { border-color:color-mix(in srgb,#d97706 50%,var(--acheron-grid-line-color))!important;background:color-mix(in srgb,#d97706 12%,var(--acheron-background))!important }
    [aria-invalid=true]:is(input,textarea,select) { outline:1px solid #ef4444;outline-offset:-1px }
    [data-grid-row-group]:disabled { opacity:.4;cursor:default!important }
    [data-grid-row-resize]:hover { background:var(--acheron-selection-color);opacity:.5 }
    [data-grid-header-cell]:focus-visible { outline:2px solid var(--acheron-selection-color);outline-offset:-3px }
    [data-grid-header-cell] { overflow:hidden;transition:background-color var(--acheron-feedback-duration,0ms) ease-out;touch-action:none; }
    @media(hover:hover) and (pointer:fine) { [data-grid-header-cell]:hover { background:color-mix(in srgb,var(--acheron-selection-color) 7%,transparent); } }
    [data-grid-header-cell]:active { background:color-mix(in srgb,var(--acheron-selection-color) 13%,transparent);transition:none; }
    dialog[data-grid-dialog] button:active, [data-grid-choices] button:active { transform:translateY(1px); }
    @media(prefers-reduced-motion:reduce) { [data-grid-header-cell] { transition:none; } }
    [data-grid-search]:not([hidden]) { display:flex;align-items:center;flex-wrap:wrap;gap:4px }
    dialog[data-grid-dialog] [data-dialog-actions] { display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:4px }
  `;
  dialogStyles.textContent += `
    dialog[data-grid-dialog], [data-grid-choices], .acheron-context-menu { -webkit-font-smoothing:antialiased; }
    dialog[data-grid-dialog] button, [data-grid-choices] button { min-height:32px;cursor:pointer;touch-action:manipulation; }
    dialog[data-grid-dialog] button:hover:not(:disabled), [data-grid-choices] button:hover:not(:disabled) { filter:brightness(.96); }
    [data-grid-choices] button:focus-visible, [data-grid-choices] input:not([type=radio]):not([type=checkbox]):focus-visible { outline:2px solid var(--acheron-selection-color);outline-offset:2px; }
    .acheron-context-menu button:focus-visible { box-shadow:inset 0 0 0 2px var(--acheron-selection-color); }
    @media(pointer:coarse) {
      .acheron-context-menu button, [data-grid-choices] label, [data-grid-choices] button, dialog[data-grid-dialog] button { min-height:44px; }
      [data-grid-choices] input[type=search] { min-height:40px; }
    }
  `;
  root.append(dialogStyles);
  const scroller = gridContext.env.doc.createElement('div');
  const viewportLabel =
    dataSource.setValue && gridContext.layout.columns.some((column) => column.editable)
      ? gridContext.env.t('Data grid viewport')
      : gridContext.env.t('Read-only data grid viewport');
  scroller.style.cssText = `position:absolute;inset:${gridContext.layout.headerHeight}px 0 0 ${gridContext.layout.indexWidth}px;overflow:auto;overscroll-behavior:contain;outline:none`;
  scroller.dataset.gridViewport = '';
  scroller.tabIndex = 0;
  scroller.setAttribute('aria-label', viewportLabel);
  scroller.setAttribute('aria-keyshortcuts', 'Shift+F8 Control+f Meta+f Control+a Meta+a Alt+Enter');
  scroller.setAttribute('role', 'grid');
  scroller.setAttribute(
    'aria-rowcount',
    String(gridContext.layout.rowCount + (viewportAccessibility ? gridContext.layout.headers.levels : 0)),
  );
  scroller.setAttribute('aria-colcount', String(gridContext.layout.columns.length));
  scroller.setAttribute('aria-multiselectable', 'true');
  const activeRow = gridContext.env.doc.createElement('div');
  activeRow.setAttribute('role', 'row');
  activeRow.style.cssText =
    'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);pointer-events:none';
  activeRow.hidden = true;
  const activeCell = gridContext.env.doc.createElement('div');
  const instanceId = ++gridId;
  activeCell.id = `acheron-active-cell-${instanceId}`;
  activeCell.setAttribute('role', 'gridcell');
  activeCell.setAttribute('aria-selected', 'true');
  activeRow.append(activeCell);
  const accessibleBody = gridContext.env.doc.createElement('div');
  accessibleBody.style.cssText = activeRow.style.cssText;
  const accessibility = createAccessibility({
    get activeCell() {
      return activeCell;
    },
    get activeRow() {
      return activeRow;
    },
    get avatarColumns() {
      return avatarColumns;
    },
    get columns() {
      return gridContext.layout.columns;
    },
    get currentView() {
      return gridContext.layout.currentView;
    },
    get displayedText() {
      return displayedText;
    },
    get doc() {
      return gridContext.env.doc;
    },
    get engine() {
      return gridContext.engine;
    },
    get getSelectionRanges() {
      return getSelectionRanges;
    },
    get headers() {
      return gridContext.layout.headers;
    },
    get indicatorPolicy() {
      return indicatorPolicy;
    },
    get instanceId() {
      return instanceId;
    },
    get interaction() {
      return interaction;
    },
    get linksForValue() {
      return linksForValue;
    },
    get mediaColumn() {
      return mediaColumn;
    },
    get numberText() {
      return numberText;
    },
    get options() {
      return gridContext.options;
    },
    get rowValueLocked() {
      return rowValueLocked;
    },
    get scroller() {
      return scroller;
    },
    get selectionStatus() {
      return selectionStatus;
    },
    get t() {
      return gridContext.env.t;
    },
    get validationMessage() {
      return validationMessage;
    },
    get viewportAccessibility() {
      return viewportAccessibility;
    },
    get viewportLabel() {
      return viewportLabel;
    },
  });
  const { announceSelection, stateLabels, accessibleCell, syncAccessibleCell } = accessibility;
  const headerSurface = gridContext.env.doc.createElement('div');
  headerSurface.style.cssText = `position:absolute;top:0;left:${gridContext.layout.indexWidth}px;right:0;height:${gridContext.layout.headerHeight}px;overflow:hidden;touch-action:none`;
  if (viewportAccessibility) {
    headerSurface.id = `acheron-header-${instanceId}`;
    headerSurface.setAttribute('role', gridContext.layout.headers.levels > 1 ? 'rowgroup' : 'row');
    if (gridContext.layout.headers.levels === 1) headerSurface.setAttribute('aria-rowindex', '1');
    accessibleBody.id = `acheron-body-${instanceId}`;
    accessibleBody.setAttribute('role', 'rowgroup');
    activeRow.id = `acheron-active-row-${instanceId}`;
    scroller.setAttribute('aria-owns', `${headerSurface.id} ${accessibleBody.id} ${activeRow.id}`);
  }
  const spacer = gridContext.env.doc.createElement('div');
  spacer.setAttribute('aria-hidden', 'true');
  spacer.style.width = `${columnAxis.position(gridContext.layout.columns.length)}px`;
  spacer.style.position = 'relative';
  spacer.style.height = `${rowAxis.position(gridContext.layout.rowCount)}px`;
  scroller.append(spacer, accessibleBody, activeRow);
  const canvas = gridContext.env.doc.createElement('canvas');
  canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
  canvas.style.left = `${gridContext.layout.indexWidth}px`;
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable.');
  const indexGutter = gridContext.env.doc.createElement('div');
  indexGutter.dataset.gridIndex = '';
  indexGutter.hidden = gridContext.layout.indexWidth === 0;
  indexGutter.style.cssText = `position:absolute;left:0;top:0;width:${gridContext.layout.indexWidth}px;overflow:hidden;background:var(--acheron-header-background);color:var(--acheron-header-text-color);font:var(--acheron-font)`;
  indexGutter.setAttribute('aria-label', gridContext.env.t('Row index'));
  indexGutter.style.touchAction = 'none';
  root.append(scroller, canvas, headerSurface, indexGutter);
  const copyFeedback = gridContext.env.doc.createElement('div');
  copyFeedback.dataset.gridCopyFeedback = '';
  copyFeedback.setAttribute('aria-hidden', 'true');
  copyFeedback.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3';
  root.append(copyFeedback);
  const clipboard = createClipboard({
    get columnAxis() {
      return columnAxis;
    },
    get columnEditors() {
      return columnEditors;
    },
    get columns() {
      return gridContext.layout.columns;
    },
    set columns(value) {
      gridContext.layout.columns = value;
    },
    get copyFeedback() {
      return copyFeedback;
    },
    get destroyed() {
      return gridContext.runtime.destroyed;
    },
    set destroyed(value) {
      gridContext.runtime.destroyed = value;
    },
    get doc() {
      return gridContext.env.doc;
    },
    get editor() {
      return editors.editor;
    },
    set editor(value) {
      editors.editor = value;
    },
    get engine() {
      return gridContext.engine;
    },
    get getSelectionRanges() {
      return getSelectionRanges;
    },
    get headerHeight() {
      return gridContext.layout.headerHeight;
    },
    set headerHeight(value) {
      gridContext.layout.headerHeight = value;
    },
    get indexWidth() {
      return gridContext.layout.indexWidth;
    },
    set indexWidth(value) {
      gridContext.layout.indexWidth = value;
    },
    get mediaColumn() {
      return mediaColumn;
    },
    get motionDuration() {
      return motionDuration;
    },
    get motionEnabled() {
      return motionEnabled;
    },
    get pasteImages() {
      return pasteImages;
    },
    get richText() {
      return richText;
    },
    get rowAxis() {
      return rowAxis;
    },
    get rowCount() {
      return gridContext.layout.rowCount;
    },
    set rowCount(value) {
      gridContext.layout.rowCount = value;
    },
    get t() {
      return gridContext.env.t;
    },
    get viewport() {
      return viewport;
    },
    get win() {
      return gridContext.env.win;
    },
  });
  const {
    clearCopyFeedback,
    showCopyFeedback,
    renderCopyFeedback,
    clipboardBlocks,
    cancelCut,
    cutSelectionBlocks,
    copySelectionBlocks,
    pasteSelectionBlocks,
    clipboardPlain,
    clipboardHtml,
    htmlClipboardBlocks,
    writeClipboard,
    copySelection,
    paste,
    onCut,
    onCopy,
    onPaste,
  } = clipboard;

  container.append(root);

  let destroyed = false;
  const stateIcons = Object.fromEntries(
    Object.entries(stateIconSvg).map(([name, svg]) => {
      const image = gridContext.env.doc.createElement('img');
      image.onload = () => {
        if (!gridContext.runtime.destroyed) {
          rendering.fullDraw = true;
          schedule();
        }
      };
      const color = gridContext.appearance.theme.iconColor
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
      image.src = `data:image/svg+xml,${encodeURIComponent(svg.replace('currentColor', color))}`;
      return [name, image];
    }),
  );

  const rowLockSvg = new gridContext.env.win.DOMParser().parseFromString(
    stateIconSvg.lock,
    'image/svg+xml',
  ).documentElement;

  const editors = createEditors({
    get actionError() {
      return actionError;
    },
    get avatarColumns() {
      return avatarColumns;
    },
    get columnEditors() {
      return columnEditors;
    },
    get columns() {
      return gridContext.layout.columns;
    },
    get context() {
      return context;
    },
    get destroyed() {
      return gridContext.runtime.destroyed;
    },
    get doc() {
      return gridContext.env.doc;
    },
    get editorError() {
      return editorError;
    },
    get editorLabel() {
      return editorLabel;
    },
    get editorPane() {
      return editorPane;
    },
    get engine() {
      return gridContext.engine;
    },
    get enterSurface() {
      return enterSurface;
    },
    get exitSurface() {
      return exitSurface;
    },
    get headerHeight() {
      return gridContext.layout.headerHeight;
    },
    get indexWidth() {
      return gridContext.layout.indexWidth;
    },
    get invalidate() {
      return invalidate;
    },
    get mediaColumn() {
      return mediaColumn;
    },
    get options() {
      return gridContext.options;
    },
    get overlay() {
      return overlay;
    },
    get richText() {
      return richText;
    },
    get richTextColumns() {
      return richTextColumns;
    },
    get root() {
      return root;
    },
    get rowCount() {
      return gridContext.layout.rowCount;
    },
    get scroller() {
      return scroller;
    },
    get select() {
      return select;
    },
    get t() {
      return gridContext.env.t;
    },
    get theme() {
      return gridContext.appearance.theme;
    },
    get viewport() {
      return viewport;
    },
    get win() {
      return gridContext.env.win;
    },
  });
  const { clearChoiceHover, disposeEditorIntegration, guardEditNavigation, finishEdit, beginEdit, positionEditor } =
    editors;

  const interaction = createInteraction({
    structureAction: (run, axis) => structureAction(run, axis),
    get actionError() {
      return actionError;
    },
    get announceSelection() {
      return announceSelection;
    },
    get beginEdit() {
      return beginEdit;
    },
    get cancelCut() {
      return cancelCut;
    },
    get cancelLinkPreviewHover() {
      return cancelLinkPreviewHover;
    },
    get cellLinks() {
      return cellLinks;
    },
    get clearChoiceHover() {
      return clearChoiceHover;
    },
    get closeMenu() {
      return closeMenu;
    },
    get columnAxis() {
      return columnAxis;
    },
    get columnEditors() {
      return columnEditors;
    },
    get columns() {
      return gridContext.layout.columns;
    },
    get context() {
      return context;
    },
    get destroyed() {
      return gridContext.runtime.destroyed;
    },
    get editors() {
      return editors;
    },
    get engine() {
      return gridContext.engine;
    },
    get finishEdit() {
      return finishEdit;
    },
    get format() {
      return format;
    },
    get getSelection() {
      return getSelection;
    },
    get getSelectionRange() {
      return getSelectionRange;
    },
    get getSelectionRanges() {
      return getSelectionRanges;
    },
    get headerHeight() {
      return gridContext.layout.headerHeight;
    },
    get headerRowHeight() {
      return headerRowHeight;
    },
    get headerSurface() {
      return headerSurface;
    },
    get indexGutter() {
      return indexGutter;
    },
    get indexWidth() {
      return gridContext.layout.indexWidth;
    },
    get invalidate() {
      return invalidate;
    },
    get leafHeaders() {
      return gridContext.layout.leafHeaders;
    },
    get measuredRows() {
      return rendering.measuredRows;
    },
    get mediaColumn() {
      return mediaColumn;
    },
    get mediaSize() {
      return mediaSize;
    },
    get numberText() {
      return numberText;
    },
    get openLinks() {
      return openLinks;
    },
    get openMedia() {
      return openMedia;
    },
    get openMenu() {
      return openMenu;
    },
    get options() {
      return gridContext.options;
    },
    get overlay() {
      return overlay;
    },
    get reorderBadge() {
      return reorderBadge;
    },
    get reorderGuide() {
      return reorderGuide;
    },
    get replay() {
      return replay;
    },
    get resizeGuide() {
      return resizeGuide;
    },
    get richText() {
      return richText;
    },
    get root() {
      return root;
    },
    get rowAxis() {
      return rowAxis;
    },
    get rowCount() {
      return gridContext.layout.rowCount;
    },
    get rowValueLocked() {
      return rowValueLocked;
    },
    get scroller() {
      return scroller;
    },
    get stateLabels() {
      return stateLabels;
    },
    get t() {
      return gridContext.env.t;
    },
    get theme() {
      return gridContext.appearance.theme;
    },
    get validationMessage() {
      return validationMessage;
    },
    get viewport() {
      return viewport;
    },
    get viewportLabel() {
      return viewportLabel;
    },
    get win() {
      return gridContext.env.win;
    },
  });
  const {
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
  } = interaction;

  const selectionHandles = (['start', 'end'] as const).map((endpoint) => {
    const button = gridContext.env.doc.createElement('button');
    button.type = 'button';
    button.hidden = true;
    button.tabIndex = -1;
    button.setAttribute('aria-label', gridContext.env.t('Adjust selection {0}', gridContext.env.t(endpoint)));
    button.style.cssText =
      'position:absolute;width:20px;height:20px;padding:0;margin:0;border:3px solid var(--acheron-background);border-radius:50%;background:var(--acheron-selection-color);z-index:3;touch-action:none;cursor:crosshair';
    button.addEventListener('pointerdown', (event) => {
      const range = getSelectionRange();
      if (event.button !== 0 || !range || !finishEdit(true)) return;
      event.preventDefault();
      event.stopPropagation();
      interaction.handleAnchor =
        endpoint === 'start'
          ? { row: range.endRow, col: range.endColumn }
          : { row: range.startRow, col: range.startColumn };
      interaction.axisDrag = null;
      interaction.dragPointer = event.pointerId;
      interaction.dragPosition = event;
      root.setPointerCapture(event.pointerId);
    });
    root.append(button);
    return button;
  });

  const editorPane = gridContext.env.doc.createElement('div');
  editorPane.style.cssText = 'position:absolute;overflow:hidden;pointer-events:none;z-index:1';
  root.append(editorPane);
  const editorLabel = gridContext.env.doc.createElement('div');
  editorLabel.dataset.gridEditorLabel = '';
  editorLabel.hidden = true;
  editorLabel.style.cssText =
    'position:absolute;left:0;top:-25px;box-sizing:border-box;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:4px 8px;border:1px solid var(--acheron-grid-line-color);background:var(--acheron-header-background);color:var(--acheron-header-text-color);font:11px system-ui';
  editorPane.append(editorLabel);

  const overlay = createOverlay({
    win: gridContext.env.win,
    doc: gridContext.env.doc,
    root,
    engine: gridContext.engine,
    options: gridContext.options,
    t: gridContext.env.t,
    scroller,
    get destroyed() {
      return gridContext.runtime.destroyed;
    },
    cellLinks: (row, col) => cellLinks(row, col),
    svgIcon,
    exitSurface: (node) => exitSurface(node),
  });
  const { closeMenu, cancelLinkPreviewHover, openLinks } = overlay;

  const menus = createMenus({
    get actionError() {
      return actionError;
    },
    get animateLayout() {
      return animateLayout;
    },
    get autoFitColumn() {
      return autoFitColumn;
    },
    get autoFitRow() {
      return autoFitRow;
    },
    get beginEdit() {
      return beginEdit;
    },
    get cellLinks() {
      return cellLinks;
    },
    get closeMenu() {
      return closeMenu;
    },
    get columnAxis() {
      return columnAxis;
    },
    get columnEditors() {
      return columnEditors;
    },
    get columns() {
      return gridContext.layout.columns;
    },
    get creationTypes() {
      return creationTypes;
    },
    get currentView() {
      return gridContext.layout.currentView;
    },
    set currentView(value) {
      gridContext.layout.currentView = value;
    },
    get destroyed() {
      return gridContext.runtime.destroyed;
    },
    get doc() {
      return gridContext.env.doc;
    },
    get editors() {
      return editors;
    },
    get engine() {
      return gridContext.engine;
    },
    get enterSurface() {
      return enterSurface;
    },
    get finishEdit() {
      return finishEdit;
    },
    get freezeHorizontal() {
      return freezeHorizontal;
    },
    get freezeVertical() {
      return freezeVertical;
    },
    get getSelectionRange() {
      return getSelectionRange;
    },
    get getSelectionRanges() {
      return getSelectionRanges;
    },
    get groupRows() {
      return groupRows;
    },
    get headerColumn() {
      return headerColumn;
    },
    get headerHeight() {
      return gridContext.layout.headerHeight;
    },
    get htmlClipboardBlocks() {
      return htmlClipboardBlocks;
    },
    get indexRow() {
      return indexRow;
    },
    get indexWidth() {
      return gridContext.layout.indexWidth;
    },
    get interaction() {
      return interaction;
    },
    get lockNotice() {
      return lockNotice;
    },
    get lockNoticeTimer() {
      return lockNoticeTimer;
    },
    set lockNoticeTimer(value) {
      lockNoticeTimer = value;
    },
    get managesView() {
      return managesView;
    },
    get motionDuration() {
      return motionDuration;
    },
    get motionEnabled() {
      return motionEnabled;
    },
    get openLinks() {
      return openLinks;
    },
    get options() {
      return gridContext.options;
    },
    get overlay() {
      return overlay;
    },
    get paste() {
      return paste;
    },
    get pasteSelectionBlocks() {
      return pasteSelectionBlocks;
    },
    get pointerCell() {
      return pointerCell;
    },
    get render() {
      return render;
    },
    get replay() {
      return replay;
    },
    get resizeAxis() {
      return resizeAxis;
    },
    get root() {
      return root;
    },
    get rowAxis() {
      return rowAxis;
    },
    get rowCount() {
      return gridContext.layout.rowCount;
    },
    get rowLockCache() {
      return rendering.rowLockCache;
    },
    get scroller() {
      return scroller;
    },
    get select() {
      return select;
    },
    get selectColumn() {
      return selectColumn;
    },
    get selectRow() {
      return selectRow;
    },
    get selectedAxisIndices() {
      return selectedAxisIndices;
    },
    get structureAction() {
      return structureAction;
    },
    get svgIcon() {
      return svgIcon;
    },
    get t() {
      return gridContext.env.t;
    },
    get win() {
      return gridContext.env.win;
    },
    get writeClipboard() {
      return writeClipboard;
    },
  });
  const { format, setFrozen, setLocked, openMenu, onHeaderContextMenu, onContextMenu } = menus;

  const resizeGuide = gridContext.env.doc.createElement('div');
  resizeGuide.setAttribute('aria-hidden', 'true');
  resizeGuide.setAttribute('data-grid-resize-guide', '');
  resizeGuide.style.cssText =
    'display:none;position:absolute;pointer-events:none;z-index:3;background:var(--acheron-selection-color)';
  root.append(resizeGuide);
  const freezeVertical = gridContext.env.doc.createElement('div');
  const freezeHorizontal = gridContext.env.doc.createElement('div');
  for (const line of [freezeVertical, freezeHorizontal]) {
    line.setAttribute('aria-hidden', 'true');
    line.style.cssText = 'position:absolute;pointer-events:none;z-index:2;background:var(--acheron-freeze-color)';
    root.append(line);
  }
  freezeVertical.dataset.gridFreezeLine = 'column';
  freezeHorizontal.dataset.gridFreezeLine = 'row';
  const actionError = gridContext.env.doc.createElement('div');
  actionError.setAttribute('role', 'alert');
  actionError.style.cssText =
    'display:none;position:absolute;bottom:20px;left:12px;right:24px;z-index:2;padding:10px;background:color-mix(in srgb,#ef4444 12%,var(--acheron-background));color:var(--acheron-text-color);border:1px solid color-mix(in srgb,#ef4444 50%,var(--acheron-grid-line-color));border-radius:6px;font:13px system-ui';
  root.append(actionError);
  const lockNotice = gridContext.env.doc.createElement('div');
  lockNotice.dataset.gridLockNotice = '';
  lockNotice.setAttribute('role', 'status');
  lockNotice.hidden = true;
  lockNotice.style.cssText =
    'position:absolute;top:48px;left:16px;right:16px;z-index:12;padding:16px;background:var(--acheron-background);color:var(--acheron-text-color);border:1px solid var(--acheron-grid-line-color);box-shadow:0 8px 24px #0002;font:var(--acheron-font);pointer-events:none';
  const lockTitle = gridContext.env.doc.createElement('strong');
  lockTitle.style.cssText = 'display:flex;align-items:center;gap:8px';
  lockTitle.append(
    svgIcon('lock'),
    (gridContext.options.tableLockNotice && gridContext.options.tableLockNotice.title) ||
      gridContext.env.t('Table locked'),
  );
  const lockDescription = gridContext.env.doc.createElement('div');
  lockDescription.style.cssText = 'margin-top:8px;opacity:.8';
  lockDescription.textContent =
    (gridContext.options.tableLockNotice && gridContext.options.tableLockNotice.description) ||
    gridContext.env.t('Editing is disabled while the table is locked.');
  lockNotice.append(lockTitle, lockDescription);
  root.append(lockNotice);
  let lockNoticeTimer: number | undefined;

  const editorError = gridContext.env.doc.createElement('div');
  editorError.id = `acheron-editor-error-${++editorId}`;
  editorError.setAttribute('role', 'alert');
  editorError.style.cssText =
    'display:none;position:absolute;pointer-events:none;z-index:3;padding:8px;border:1px solid color-mix(in srgb,#ef4444 50%,var(--acheron-grid-line-color));border-radius:6px;background:color-mix(in srgb,#ef4444 12%,var(--acheron-background));color:var(--acheron-text-color);font:13px system-ui';
  root.append(editorError);
  const selectionStatus = gridContext.env.doc.createElement('div');
  selectionStatus.setAttribute('role', 'status');
  selectionStatus.style.cssText =
    'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
  root.append(selectionStatus);

  const searchBar = gridContext.env.doc.createElement('div');
  searchBar.hidden = true;
  searchBar.dataset.gridSearch = '';
  searchBar.setAttribute('role', 'search');
  searchBar.setAttribute('aria-label', gridContext.env.t('Find in grid'));
  searchBar.style.cssText =
    'position:absolute;top:4px;right:20px;max-width:calc(100% - 24px);z-index:4;padding:6px;border:1px solid var(--acheron-grid-line-color);border-radius:6px;background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font);box-shadow:0 4px 12px #0f172a26';
  const searchInput = gridContext.env.doc.createElement('input');
  searchInput.type = 'search';
  searchInput.setAttribute('aria-label', gridContext.env.t('Find in grid'));
  searchInput.style.cssText =
    'width:140px;min-width:80px;max-width:100%;padding:6px;font:inherit;color:inherit;background:var(--acheron-background);border:1px solid var(--acheron-grid-line-color);border-radius:4px;outline:none;box-shadow:none';
  const searchStatus = gridContext.env.doc.createElement('span');
  searchStatus.setAttribute('role', 'status');
  searchStatus.style.cssText = 'display:inline-block;padding:0 8px';
  const searchPrevious = gridContext.env.doc.createElement('button');
  const searchNext = gridContext.env.doc.createElement('button');
  const searchClose = gridContext.env.doc.createElement('button');
  for (const [button, label, text] of [
    [searchPrevious, gridContext.env.t('Previous match'), '↑'],
    [searchNext, gridContext.env.t('Next match'), '↓'],
    [searchClose, gridContext.env.t('Close search'), '×'],
  ] as const) {
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.append(svgIcon(text === '↑' ? 'arrow-up' : text === '↓' ? 'arrow-down' : 'x', 14));
    button.style.cssText =
      'padding:4px 8px;margin-left:2px;font:inherit;color:inherit;background:var(--acheron-background);border:1px solid var(--acheron-grid-line-color);border-radius:3px';
  }
  searchBar.append(searchInput, searchStatus, searchPrevious, searchNext, searchClose);
  root.append(searchBar);
  const { refreshSearch, openSearch, searchShortcut, highlightSearch, disposeSearch } = createSearch({
    win: gridContext.env.win,
    searchBar,
    searchInput,
    searchStatus,
    searchPrevious,
    searchNext,
    searchClose,
    t: gridContext.env.t,
    engine: gridContext.engine,
    displayedText,
    scroller,
    context,
    overlay,
    select: (row, col) => select(row, col),
    render: () => render(),
    finishEdit: (commit) => finishEdit(commit),
    closeMenu: () => closeMenu(),
    endResize: () => endResize(),
    get destroyed() {
      return gridContext.runtime.destroyed;
    },
    get rowCount() {
      return gridContext.layout.rowCount;
    },
    get columns() {
      return gridContext.layout.columns;
    },
    get theme() {
      return gridContext.appearance.theme;
    },
  });

  const builtinColumnTypes: readonly ColumnType[] = [
    {
      key: 'text',
      label: gridContext.env.t('Text'),
      create: (input) => ({
        column: { key: input.key, title: input.title, editable: true, defaultValue: input.defaultText },
      }),
    },
    {
      key: 'number',
      label: gridContext.env.t('Number'),
      create: (input) => {
        const parse = (text: string) => {
          if (!text.trim()) return null;
          const value = Number(text);
          if (!Number.isFinite(value)) throw new Error('Enter a finite number.');
          return value;
        };
        return {
          column: { key: input.key, title: input.title, editable: true, parse, defaultValue: parse(input.defaultText) },
        };
      },
    },
    {
      key: 'checkbox',
      label: gridContext.env.t('Checkbox'),
      create: (input) => {
        const parse = (text: string) => {
          if (text === '' || text === 'false') return false;
          if (text === 'true') return true;
          throw new Error('Use true or false.');
        };
        return {
          column: { key: input.key, title: input.title, editable: true, parse, defaultValue: parse(input.defaultText) },
          editor: { type: 'checkbox' },
        };
      },
    },
  ];
  const creationTypes = gridContext.options.columnTypes ?? builtinColumnTypes;
  if (
    !creationTypes.length ||
    new Set(creationTypes.map((type) => type.key)).size !== creationTypes.length ||
    creationTypes.some((type) => !type.key || !type.label || typeof type.create !== 'function')
  )
    throw new TypeError('Invalid column types.');

  const getSelection = gridContext.engine.getSelection;
  const getSelectionRange = gridContext.engine.getSelectionRange;
  const getSelectionRanges = gridContext.engine.getSelectionRanges;

  const reorderGuide = gridContext.env.doc.createElement('div');
  reorderGuide.dataset.gridReorderGuide = '';
  reorderGuide.setAttribute('aria-hidden', 'true');
  reorderGuide.style.cssText =
    'display:none;position:absolute;pointer-events:none;z-index:8;background:var(--acheron-selection-color);box-shadow:0 0 0 1px var(--acheron-background)';
  const reorderBadge = gridContext.env.doc.createElement('div');
  reorderBadge.dataset.gridReorderBadge = '';
  reorderBadge.setAttribute('aria-hidden', 'true');
  reorderBadge.style.cssText =
    'display:none;position:absolute;pointer-events:none;z-index:9;padding:6px 10px;border:1px solid var(--acheron-grid-line-color);border-radius:5px;background:var(--acheron-background);color:var(--acheron-text-color);box-shadow:0 3px 10px #0002;font:12px system-ui;white-space:nowrap';
  root.append(reorderGuide, reorderBadge);

  let observedWidth = root.clientWidth;
  let observedHeight = root.clientHeight;
  const observer = new ResizeObserver(() => {
    const width = root.clientWidth;
    const height = root.clientHeight;
    if (width === observedWidth && height === observedHeight) return;
    clearCopyFeedback();
    clearLayoutMotion();
    observedWidth = width;
    observedHeight = height;
    render();
  });
  observer.observe(root);
  scroller.addEventListener('scroll', renderCopyFeedback, { passive: true });
  scroller.addEventListener('scroll', clearLayoutMotion, { passive: true });
  scroller.addEventListener('scroll', closeMenuOnScroll, { passive: true });
  scroller.addEventListener('scroll', render, { passive: true });
  scroller.addEventListener('scroll', clearChoiceHover, { passive: true });
  root.addEventListener('pointerleave', cancelLinkPreviewHover);
  root.addEventListener('pointerleave', clearChoiceHover);
  scroller.addEventListener('pointerdown', onPointerDown);
  scroller.addEventListener('click', onLinkClick);
  scroller.addEventListener('contextmenu', onContextMenu);
  root.addEventListener('contextmenu', onHeaderContextMenu);
  root.addEventListener('keydown', searchShortcut, true);
  root.addEventListener('dblclick', onAxisDoubleClick, true);
  root.addEventListener('pointerdown', onHeaderPointerDown, true);
  root.addEventListener('keydown', cancelResizeKey, true);
  root.addEventListener('pointermove', onHeaderPointerMove);
  root.addEventListener('pointerup', commitResize);
  root.addEventListener('pointercancel', endResize);
  root.addEventListener('lostpointercapture', endResize);
  root.addEventListener('pointermove', onPointerMove);
  const removeTooltips = installTooltips(root);
  root.addEventListener('pointerup', commitTouchReorder, true);
  root.addEventListener('pointerup', onPointerEnd);
  root.addEventListener('pointercancel', onPointerEnd);
  root.addEventListener('lostpointercapture', onPointerEnd);
  scroller.addEventListener('cut', onCut);
  scroller.addEventListener('copy', onCopy);
  scroller.addEventListener('paste', onPaste);
  scroller.addEventListener('keydown', onKeyDown);
  scroller.addEventListener('dblclick', onDoubleClick);
  gridContext.env.win.addEventListener('blur', onPointerEnd);
  gridContext.env.win.addEventListener('resize', render);
  gridContext.env.win.addEventListener('scroll', positionEditor, { capture: true, passive: true });
  render();

  function closeMenuOnScroll(): void {
    closeMenu();
  }
  function clearLayoutMotion(): void {
    motion.clearLayoutMotion();
  }
  const motion = createMotion({
    get settings() {
      return motionSettings;
    },
    win: gridContext.env.win,
    root,
    canvas,
    doc: gridContext.env.doc,
    engine: gridContext.engine,
    dataSource,
    draw,
    viewport,
    get destroyed() {
      return gridContext.runtime.destroyed;
    },
    get columns() {
      return gridContext.layout.columns;
    },
    get headerHeight() {
      return gridContext.layout.headerHeight;
    },
    get indexWidth() {
      return gridContext.layout.indexWidth;
    },
    get frame() {
      return gridContext.runtime.frame;
    },
    set frame(value) {
      gridContext.runtime.frame = value;
    },
  });

  const { enterSurface, exitSurface, animateLayout, motionEnabled, removeMotionListener } = motion;
  const enteringGroups = new Set<string>();
  function groupRows(start: number, end: number): string {
    return structureAction(() => {
      const id = gridContext.engine.groupRows(start, end);
      enteringGroups.add(id);
      return id;
    });
  }
  function structureAction<T>(run: () => T, axis?: 'row' | 'column'): T {
    if (editors.editor || gridContext.runtime.destroyed)
      throw new Error('Save or cancel the editor before changing structure.');
    return animateLayout(run, axis ?? 'auto');
  }
  let canvasBulkActive = false;
  async function bulkAction<T>(run: () => Promise<T>): Promise<T> {
    if (gridContext.runtime.destroyed) throw new Error('Grid is destroyed.');
    if (editors.editor) throw new Error('Finish editing before running bulk commands.');
    if (canvasBulkActive) throw new Error('A bulk command is already running.');
    canvasBulkActive = true;
    const previousInert = root.inert,
      previousBusy = root.getAttribute('aria-busy');
    const restoreFocus = root.contains(doc.activeElement);
    root.inert = true;
    root.setAttribute('aria-busy', 'true');
    try {
      return await run();
    } finally {
      canvasBulkActive = false;
      root.inert = previousInert;
      if (previousBusy === null) root.removeAttribute('aria-busy');
      else root.setAttribute('aria-busy', previousBusy);
      if (restoreFocus && !gridContext.runtime.destroyed && !root.inert) scroller.focus({ preventScroll: true });
    }
  }
  return {
    getMotion: () => Object.freeze({ ...motionSettings }),
    setMotion: (value) => {
      if (gridContext.runtime.destroyed) throw new Error('Grid is destroyed.');
      const next = resolveMotion(value, gridContext.env.doc);
      motion.clearLayoutMotion();
      root.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
      motionSettings = next;
      motionDuration = next.duration;
      motion.syncSettings();
      rendering.render();
    },
    updateCellsAsync: (updates, options) => bulkAction(() => gridContext.engine.updateCellsAsync(updates, options)),
    pasteAsync: (text, bulk, options) => bulkAction(() => gridContext.engine.pasteAsync(text, bulk, options)),
    undoAsync: (options) => bulkAction(() => gridContext.engine.undoAsync(options)),
    redoAsync: (options) => bulkAction(() => gridContext.engine.redoAsync(options)),
    setViewAsync: (view, options) =>
      bulkAction(async () => {
        await gridContext.engine.setViewAsync(view, options);
        gridContext.layout.currentView = gridContext.engine.view;
      }),
    subscribe: gridContext.engine.subscribe,
    getValue: gridContext.engine.getValue,
    replaceText: (search: string, replacement: string, options?: Parameters<GridEngine['replaceText']>[2]) => {
      finishEdit(false);
      clearCopyFeedback();
      return gridContext.engine.replaceText(search, replacement, options);
    },
    takeObserverErrors: gridContext.engine.takeObserverErrors,
    captureRowIdentity: gridContext.engine.captureRowIdentity,
    refreshData: (ids?: readonly RowId[] | 'values') => {
      finishEdit(false);
      clearCopyFeedback();
      clipboard.pendingCutText = undefined;
      const refresh = () => gridContext.engine.refreshData(ids);
      if (
        ids === 'values' &&
        motionSettings.liveSort &&
        (gridContext.engine.view.sort || gridContext.engine.view.sorts?.length)
      )
        animateLayout(refresh, 'row');
      else refresh();
    },
    exportState: gridContext.engine.exportState,
    restoreState: (state: unknown) => {
      if (editors.editor) throw new Error('Finish editing before restoring state.');
      if (!state || typeof state !== 'object' || !('configuration' in state))
        throw new TypeError('Invalid grid state.');
      const restored = restoreGridConfiguration(
        state.configuration,
        gridContext.layout.columns,
        gridContext.engine.sourceRowCount,
      );
      reorderedHeaderGroups(restored.columns, gridContext.options.headerGroups);
      gridContext.engine.restoreState(state);
    },
    setColumnEditor: (key: string, config: ColumnEditor | null) => {
      if (gridContext.runtime.destroyed) throw new Error('Grid is destroyed.');
      const column = gridContext.layout.columns.find((column) => column.key === key);
      if (!column) throw new Error('Unknown editor column.');
      const valid = config === null ? null : validateColumnEditor(column, config);
      if (editors.editor && gridContext.engine.getSelection()?.columnKey === key) finishEdit(false);
      if (valid) columnEditors.set(key, valid);
      else columnEditors.delete(key);
      clearChoiceHover();
      render();
    },
    exportConfiguration: () => {
      if (!managesView)
        throw new Error('Export configuration requires core-managed view; persist host view separately.');
      return gridContext.engine.exportConfiguration();
    },
    getMerge: gridContext.engine.getMerge,
    getMergedCells: gridContext.engine.getMergedCells,
    canMerge: gridContext.engine.canMerge,
    mergeCells: (range: SelectionRange) => structureAction(() => gridContext.engine.mergeCells(range)),
    unmergeCells: (range: SelectionRange) => structureAction(() => gridContext.engine.unmergeCells(range)),
    getRowGroups: gridContext.engine.getRowGroups,
    groupRows,
    ungroupRows: (id: string) => structureAction(() => gridContext.engine.ungroupRows(id)),
    setGroupCollapsed: (id: string, collapsed: boolean) =>
      structureAction(() => gridContext.engine.setGroupCollapsed(id, collapsed), 'row'),
    setView: (view: LocalViewOptions) =>
      structureAction(() => {
        gridContext.engine.setView(view);
        gridContext.layout.currentView = gridContext.engine.view;
      }, 'row'),
    get view() {
      return managesView ? gridContext.engine.view : (gridContext.layout.currentView ?? {});
    },
    cutSelectionBlocks,
    cancelCut,
    copySelectionBlocks,
    pasteSelectionBlocks,
    get rowCount() {
      return gridContext.layout.rowCount;
    },
    get columns() {
      return gridContext.layout.columns;
    },
    insertColumns: (index: number, added: readonly Column[]) =>
      structureAction(() => gridContext.engine.insertColumns(index, added)),
    deleteColumns: (indices: readonly number[]) => structureAction(() => gridContext.engine.deleteColumns(indices)),
    insertRows: (index: number, rows: readonly DataRow[]) =>
      structureAction(() => gridContext.engine.insertRows(index, rows)),
    deleteRows: (indices: readonly number[]) => structureAction(() => gridContext.engine.deleteRows(indices)),
    moveRows: (indices: readonly number[], beforeIndex: number) =>
      structureAction(() => gridContext.engine.moveRows(indices, beforeIndex), 'row'),
    moveColumns: (indices: readonly number[], beforeIndex: number) =>
      structureAction(() => gridContext.engine.moveColumns(indices, beforeIndex), 'column'),
    setTheme(patch) {
      if (gridContext.runtime.destroyed) throw new Error('Grid is destroyed.');
      const next = Object.freeze({ ...gridContext.appearance.theme, ...patch });
      validateTheme(next);
      clearLayoutMotion();
      clearCopyFeedback();
      gridContext.appearance.theme = next;
      rendering.measuredRows.clear();
      for (const [key, value] of Object.entries(gridContext.appearance.theme))
        root.style.setProperty('--acheron-' + key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()), value);
      for (const [name, image] of Object.entries(stateIcons)) {
        const color = gridContext.appearance.theme.iconColor
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;');
        image.src = `data:image/svg+xml,${encodeURIComponent(stateIconSvg[name as keyof typeof stateIconSvg].replace('currentColor', color))}`;
      }
      render();
    },
    render: () => {
      if (!searchBar.hidden) refreshSearch();
      else render();
    },
    openSearch,
    selectColumn,
    selectRow,
    selectAll,
    autoFitColumn,
    autoFitRow,
    get frozenRows() {
      return gridContext.engine.frozenRows;
    },
    get frozenColumns() {
      return gridContext.engine.frozenColumns;
    },
    setFrozen,
    setRowsHidden: (indices, hidden) => {
      if (finishEdit(true)) {
        cancelCut();
        structureAction(() => gridContext.engine.setRowsHidden(indices, hidden), 'row');
      }
    },
    setColumnsHidden: (indices, hidden) => {
      if (finishEdit(true)) {
        cancelCut();
        structureAction(() => gridContext.engine.setColumnsHidden(indices, hidden), 'column');
      }
    },
    getHiddenRows: gridContext.engine.getHiddenRows,
    getHiddenColumns: gridContext.engine.getHiddenColumns,
    isRowHidden: gridContext.engine.isRowHidden,
    isColumnHidden: gridContext.engine.isColumnHidden,
    isLocked: gridContext.engine.isLocked,
    canManageLocks: gridContext.engine.canManageLocks,
    setLocked,
    getFormat: gridContext.engine.getFormat,
    canFormat: gridContext.engine.canFormat,
    format,
    updateCells,
    undo: () => replay(false),
    redo: () => replay(true),
    getCellPermission: gridContext.engine.getCellPermission,
    getSelection,
    getSelectionRange,
    getSelectionRanges,
    copySelection,
    paste,
    setColumnWidth: (index, width) => resizeAxis(columnAxis, index, width),
    setRowHeight: (index, height) => resizeAxis(rowAxis, index, height),
    destroy() {
      if (gridContext.runtime.destroyed) return;
      rendering.clearValueHistory();
      cancelLinkPreviewHover();
      root.removeEventListener('pointerleave', cancelLinkPreviewHover);
      clipboard.pendingCutText = undefined;
      clipboard.cutRevision++;
      gridContext.env.win.clearTimeout(lockNoticeTimer);
      clearCopyFeedback();
      clearLayoutMotion();
      removeMotionListener();
      if (editors.choices) {
        disposeChoicePanel(editors.choices);
        editors.choices.remove();
      }
      editors.choices = null;
      disposeEditorIntegration();
      gridContext.env.win.removeEventListener('beforeunload', guardEditNavigation);
      clearReorder();
      gridContext.engine.destroy();
      gridContext.runtime.destroyed = true;
      for (const image of Object.values(stateIcons)) image.onload = null;
      closeMenu();
      disposeSearch();
      clearDisplayCache();
      mediaController.visibleImages.clear();
      releaseUnusedImages();
      root.removeEventListener('contextmenu', onHeaderContextMenu);
      root.removeEventListener('keydown', searchShortcut, true);
      overlay.activeDialog?.remove();
      overlay.activeDialog = null;
      mediaController.mediaUpload?.abort();
      for (const src of mediaController.ownedImageUrls) gridContext.env.win.URL.revokeObjectURL(src);
      mediaController.ownedImageUrls.clear();
      endResize();
      root.removeEventListener('dblclick', onAxisDoubleClick, true);
      root.removeEventListener('pointerdown', onHeaderPointerDown, true);
      root.removeEventListener('keydown', cancelResizeKey, true);
      root.removeEventListener('pointermove', onHeaderPointerMove);
      root.removeEventListener('pointerup', commitResize);
      root.removeEventListener('pointercancel', endResize);
      root.removeEventListener('lostpointercapture', endResize);
      scroller.removeEventListener('contextmenu', onContextMenu);
      rendering.dirty.clear();
      const input = editors.editor;
      editors.editor = null;
      editors.richEditor?.remove();
      editors.richEditor = null;
      input?.remove();
      onPointerEnd();
      removeTooltips();
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', commitTouchReorder, true);
      root.removeEventListener('pointerup', onPointerEnd);
      root.removeEventListener('pointercancel', onPointerEnd);
      root.removeEventListener('lostpointercapture', onPointerEnd);
      scroller.removeEventListener('cut', onCut);
      scroller.removeEventListener('copy', onCopy);
      scroller.removeEventListener('paste', onPaste);
      scroller.removeEventListener('dblclick', onDoubleClick);
      scroller.removeEventListener('pointerdown', onPointerDown);
      scroller.removeEventListener('click', onLinkClick);
      scroller.removeEventListener('keydown', onKeyDown);
      if (gridContext.runtime.frame !== undefined) gridContext.env.win.cancelAnimationFrame(gridContext.runtime.frame);
      observer.disconnect();
      scroller.removeEventListener('scroll', renderCopyFeedback);
      scroller.removeEventListener('scroll', clearLayoutMotion);
      scroller.removeEventListener('scroll', closeMenuOnScroll);
      scroller.removeEventListener('scroll', render);
      scroller.removeEventListener('scroll', clearChoiceHover);
      root.removeEventListener('pointerleave', clearChoiceHover);
      gridContext.env.win.removeEventListener('blur', onPointerEnd);
      gridContext.env.win.removeEventListener('resize', render);
      gridContext.env.win.removeEventListener('scroll', positionEditor, true);
      root.remove();
    },
  };
}

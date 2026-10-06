import { createRendering } from './internal/rendering.js';
import { createMenus } from './internal/menus.js';
import { createAccessibility } from './internal/accessibility.js';
import { createInteraction } from './internal/interaction.js';
import { createEditors } from './internal/editors.js';
import { createMediaController } from './internal/media-controller.js';
import { createClipboard } from './internal/clipboard.js';
import { createSearch } from './internal/search.js';
import { createOverlay } from './internal/overlay.js';
import { createMotion } from './internal/motion.js';
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
  motion?: boolean | { readonly duration?: number };
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
  const numberText = createNumberDisplay(options);
  const motionDuration = typeof options.motion === 'object' ? (options.motion.duration ?? 220) : 220;
  if (!Number.isFinite(motionDuration) || motionDuration < 0 || motionDuration > 1000)
    throw new RangeError('Motion duration must be between 0 and 1000ms.');

  const managesView = options.viewMode === 'core' || (options.viewMode !== 'host' && !options.onViewChange);
  let currentView = options.view;
  const activeBorderWidth = options.selectionStyle?.activeBorderWidth ?? 1;
  const rangeBorderWidth = options.selectionStyle?.rangeBorderWidth ?? 1;
  const rangeTintOpacity = options.selectionStyle?.rangeTintOpacity ?? 0.06;
  if (
    !Number.isFinite(rangeBorderWidth) ||
    rangeBorderWidth < 1 ||
    rangeBorderWidth > 4 ||
    !Number.isFinite(rangeTintOpacity) ||
    rangeTintOpacity < 0 ||
    rangeTintOpacity > 1
  )
    throw new RangeError('Invalid range selection style.');
  const headerTintOpacity = options.selectionStyle?.headerTintOpacity ?? 0.12;
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
    options,
    doc,
    t,
    numberText,
  });
  const win = doc.defaultView!;
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
    font: '400 13px system-ui, sans-serif',
    headerFont: '600 13px system-ui, sans-serif',
    ...options.theme,
  });
  function validateTheme(candidate: GridTheme): void {
    for (const [key, value] of Object.entries(candidate)) {
      const property = key === 'font' || key === 'headerFont' ? 'font' : 'color';
      if (
        typeof value !== 'string' ||
        /var\(|currentcolor|^(inherit|initial|unset|revert)/i.test(value.trim()) ||
        !win.CSS.supports(property, value)
      ) {
        throw new TypeError(`Invalid grid theme ${key}. Use a concrete CSS ${property} value.`);
      }
    }
  }
  validateTheme(theme);
  const rendering = createRendering({
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
      return columns;
    },
    get context() {
      return context;
    },
    get currentView() {
      return currentView;
    },
    get destroyed() {
      return destroyed;
    },
    get doc() {
      return doc;
    },
    get editors() {
      return editors;
    },
    get endResize() {
      return endResize;
    },
    get engine() {
      return engine;
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
      return headerHeight;
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
      return headers;
    },
    get highlightSearch() {
      return highlightSearch;
    },
    get indexGutter() {
      return indexGutter;
    },
    get indexWidth() {
      return indexWidth;
    },
    get interaction() {
      return interaction;
    },
    get leafHeaders() {
      return leafHeaders;
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
      return options;
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
      return rowCount;
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
      return t;
    },
    get theme() {
      return theme;
    },
    get viewportAccessibility() {
      return viewportAccessibility;
    },
    get visibleIndices() {
      return visibleIndices;
    },
    get win() {
      return win;
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
  const indicatorPolicy = Object.freeze({ ...options.permissions });
  let headers = headerLayout(options.columns, options.headerGroups);
  const headerRowHeight = options.headerHeight ?? 36;
  let headerHeight = headerRowHeight * headers.levels;
  let leafHeaders = headers.cells.filter((cell) => cell.leaf).sort((a, b) => a.start - b.start);
  if (!Number.isFinite(headerHeight) || headerHeight <= 0)
    throw new RangeError('Grid sizes must be positive finite numbers.');
  const engine = createGridEngine({
    columns: options.columns.map((column) =>
      (options.imageColumns?.includes(column.key) || options.avatarColumns?.includes(column.key)) && !column.parse
        ? { ...column, parse: parseMediaValue }
        : column,
    ),
    dataSource,
    ...(options.allowMerging === undefined ? {} : { allowMerging: options.allowMerging }),
    ...(options.allowRowGrouping === undefined ? {} : { allowRowGrouping: options.allowRowGrouping }),
    ...(options.canChangeLayout === undefined ? {} : { canChangeLayout: options.canChangeLayout }),
    ...(managesView && options.view ? { view: options.view } : {}),
    ...(options.rowHeight === undefined ? {} : { rowHeight: options.rowHeight }),
    ...(options.columnWidths === undefined ? {} : { columnWidths: options.columnWidths }),
    ...(options.columnWidth === undefined ? {} : { columnWidth: options.columnWidth }),
    ...(options.canChangeVisibility ? { canChangeVisibility: options.canChangeVisibility } : {}),
    canChangeStructure: (request) => {
      if (options.canChangeStructure?.(request) === false) return false;
      if (request.axis === 'column') {
        if (request.kind === 'insert' && !request.columns) return true;
        try {
          const next =
            request.columns ??
            (request.kind === 'delete'
              ? engine.columns.filter((_, i) => !request.indices.includes(i))
              : (request.order ?? reorderedIndices(engine.columns.length, request.indices, request.beforeIndex)).map(
                  (i) => engine.columns[i]!,
                ));
          reorderedHeaderGroups(next, options.headerGroups);
        } catch {
          return false;
        }
      }
      return true;
    },
    ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
    ...(options.resolveCellPermission === undefined ? {} : { resolveCellPermission: options.resolveCellPermission }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    ...(options.onObserverError === undefined ? {} : { onObserverError: options.onObserverError }),
    ...(options.allowLockChanges === undefined ? {} : { allowLockChanges: options.allowLockChanges }),
    ...(options.frozenRows === undefined ? {} : { frozenRows: options.frozenRows }),
    ...(options.frozenColumns === undefined ? {} : { frozenColumns: options.frozenColumns }),
    onInvalidate(change) {
      if (change.type !== 'selection') clearCopyFeedback();
      if (change.type === 'cells') {
        if (engine.getMergedCells().length) rendering.fullDraw = true;
        if (options.autoRowHeight) {
          change.cells.forEach((cell) => rendering.measuredRows.delete(cell.rowIndex));
          rendering.fullDraw = true;
        }
        invalidate(change.cells);
        if (!searchBar.hidden) refreshSearch();
      } else if (change.type === 'layout' || change.type === 'structure') {
        if (change.type === 'structure') {
          editors.hoveredChoice = null;
          if (managesView) currentView = engine.view;
          if (interaction.axisAnchor) {
            const map = interaction.axisAnchor.axis === 'row' ? change.rowMap : change.columnMap,
              next = map[interaction.axisAnchor.index];
            interaction.axisAnchor =
              next !== undefined && next >= 0 ? { ...interaction.axisAnchor, index: next } : null;
          }
          onPointerEnd();
          columns = engine.columns;
          rowCount = engine.rowCount;
          const outline = engine.getRowGroups();
          const levels = outline.reduce(
            (max, group) =>
              Math.max(
                max,
                outline.filter((other) => other.startRow <= group.startRow && other.endRow >= group.endRow).length,
              ),
            0,
          );
          indexWidth =
            options.indexColumn === false
              ? 0
              : Math.max(48, String(engine.sourceRowCount).length * 8 + 16) + levels * 24;
          scroller.style.left =
            headerSurface.style.left =
            canvas.style.left =
            indexGutter.style.width =
              String(indexWidth) + 'px';
          headers = headerLayout(columns, reorderedHeaderGroups(columns, options.headerGroups));
          headerHeight = headerRowHeight * headers.levels;
          headerSurface.style.height = scroller.style.top = `${headerHeight}px`;
          if (viewportAccessibility) {
            headerSurface.setAttribute('role', headers.levels > 1 ? 'rowgroup' : 'row');
            if (headers.levels === 1) headerSurface.setAttribute('aria-rowindex', '1');
            else headerSurface.removeAttribute('aria-rowindex');
          }
          leafHeaders = headers.cells.filter((cell) => cell.leaf).sort((a, b) => a.start - b.start);
          if (headerSurface.contains(doc.activeElement) || indexGutter.contains(doc.activeElement))
            scroller.focus({ preventScroll: true });
          headerSurface.replaceChildren();
          indexGutter.replaceChildren();
          clearReorder();
          rendering.measuredRows.clear();
          accessibility.accessibleCells.clear();
          accessibleBody.replaceChildren();
          scroller.setAttribute('aria-rowcount', String(rowCount + (viewportAccessibility ? headers.levels : 0)));
          scroller.setAttribute('aria-colcount', String(columns.length));
          if (!searchBar.hidden) refreshSearch();
          syncAccessibleCell();
          options.onSelectionChange?.(engine.getSelection());
          options.onSelectionRangesChange?.(engine.getSelectionRanges());
          options.onSelectionRangeChange?.(engine.getSelectionRange());
        }
        spacer.style.width = String(columnAxis.position(columns.length)) + 'px';
        spacer.style.height = String(rowAxis.position(rowCount)) + 'px';
        render();
      } else render();
    },
  });
  let columns = engine.columns,
    rowCount = engine.rowCount;
  const { rows: rowAxis, columnsLayout: columnAxis } = engine;
  let indexWidth = options.indexColumn === false ? 0 : Math.max(48, String(rowCount).length * 8 + 16);
  if (options.imageColumns !== undefined && !Array.isArray(options.imageColumns))
    throw new TypeError('Image columns must be column keys.');
  const imageColumns = new Set(options.imageColumns ?? []);
  if (options.avatarColumns !== undefined && !Array.isArray(options.avatarColumns))
    throw new TypeError('Avatar columns must be column keys.');
  const avatarColumns = new Set(options.avatarColumns ?? []);
  for (const key of avatarColumns)
    if (!columns.some((column) => column.key === key) || imageColumns.has(key))
      throw new TypeError('Unknown or conflicting avatar column.');
  const mediaSize = options.mediaOptions?.size ?? 32,
    mediaLimit = options.mediaOptions?.maxVisible ?? 4;
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
      return columns;
    },
    get destroyed() {
      return destroyed;
    },
    get doc() {
      return doc;
    },
    get engine() {
      return engine;
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
      return options;
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
      return t;
    },
    get win() {
      return win;
    },
  });
  const { pasteImages, openMedia, releaseUnusedImages } = mediaController;

  for (const key of imageColumns)
    if (!columns.some((column) => column.key === key)) throw new TypeError('Unknown image column.');

  const columnEditors = new Map<string, ColumnEditor>();

  for (const [key, config] of Object.entries(options.columnEditors ?? {})) {
    const column = columns.find((column) => column.key === key);
    if (!column) throw new TypeError('Unknown editor column.');
    columnEditors.set(key, validateColumnEditor(column, config));
  }

  const viewportAccessibility = options.accessibility === 'viewport';
  if (options.accessibility !== undefined && !['active', 'viewport'].includes(options.accessibility))
    throw new TypeError('Invalid accessibility mode.');
  const root = doc.createElement('div');
  root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;background:var(--acheron-background)';
  for (const [key, value] of Object.entries(theme))
    root.style.setProperty('--acheron-' + key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()), value);
  const dialogStyles = doc.createElement('style');
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
  const scroller = doc.createElement('div');
  const viewportLabel =
    dataSource.setValue && columns.some((column) => column.editable)
      ? t('Data grid viewport')
      : t('Read-only data grid viewport');
  scroller.style.cssText = `position:absolute;inset:${headerHeight}px 0 0 ${indexWidth}px;overflow:auto;overscroll-behavior:contain;outline:none`;
  scroller.dataset.gridViewport = '';
  scroller.tabIndex = 0;
  scroller.setAttribute('aria-label', viewportLabel);
  scroller.setAttribute('aria-keyshortcuts', 'Shift+F8 Control+f Meta+f Control+a Meta+a Alt+Enter');
  scroller.setAttribute('role', 'grid');
  scroller.setAttribute('aria-rowcount', String(rowCount + (viewportAccessibility ? headers.levels : 0)));
  scroller.setAttribute('aria-colcount', String(columns.length));
  scroller.setAttribute('aria-multiselectable', 'true');
  const activeRow = doc.createElement('div');
  activeRow.setAttribute('role', 'row');
  activeRow.style.cssText =
    'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);pointer-events:none';
  activeRow.hidden = true;
  const activeCell = doc.createElement('div');
  const instanceId = ++gridId;
  activeCell.id = `acheron-active-cell-${instanceId}`;
  activeCell.setAttribute('role', 'gridcell');
  activeCell.setAttribute('aria-selected', 'true');
  activeRow.append(activeCell);
  const accessibleBody = doc.createElement('div');
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
      return columns;
    },
    get currentView() {
      return currentView;
    },
    get displayedText() {
      return displayedText;
    },
    get doc() {
      return doc;
    },
    get engine() {
      return engine;
    },
    get getSelectionRanges() {
      return getSelectionRanges;
    },
    get headers() {
      return headers;
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
      return options;
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
      return t;
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
  const headerSurface = doc.createElement('div');
  headerSurface.style.cssText = `position:absolute;top:0;left:${indexWidth}px;right:0;height:${headerHeight}px;overflow:hidden;touch-action:none`;
  if (viewportAccessibility) {
    headerSurface.id = `acheron-header-${instanceId}`;
    headerSurface.setAttribute('role', headers.levels > 1 ? 'rowgroup' : 'row');
    if (headers.levels === 1) headerSurface.setAttribute('aria-rowindex', '1');
    accessibleBody.id = `acheron-body-${instanceId}`;
    accessibleBody.setAttribute('role', 'rowgroup');
    activeRow.id = `acheron-active-row-${instanceId}`;
    scroller.setAttribute('aria-owns', `${headerSurface.id} ${accessibleBody.id} ${activeRow.id}`);
  }
  const spacer = doc.createElement('div');
  spacer.setAttribute('aria-hidden', 'true');
  spacer.style.width = `${columnAxis.position(columns.length)}px`;
  spacer.style.position = 'relative';
  spacer.style.height = `${rowAxis.position(rowCount)}px`;
  scroller.append(spacer, accessibleBody, activeRow);
  const canvas = doc.createElement('canvas');
  canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
  canvas.style.left = `${indexWidth}px`;
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable.');
  const indexGutter = doc.createElement('div');
  indexGutter.dataset.gridIndex = '';
  indexGutter.hidden = indexWidth === 0;
  indexGutter.style.cssText = `position:absolute;left:0;top:0;width:${indexWidth}px;overflow:hidden;background:var(--acheron-header-background);color:var(--acheron-header-text-color);font:var(--acheron-font)`;
  indexGutter.setAttribute('aria-label', t('Row index'));
  indexGutter.style.touchAction = 'none';
  root.append(scroller, canvas, headerSurface, indexGutter);
  const copyFeedback = doc.createElement('div');
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
      return columns;
    },
    set columns(value) {
      columns = value;
    },
    get copyFeedback() {
      return copyFeedback;
    },
    get destroyed() {
      return destroyed;
    },
    set destroyed(value) {
      destroyed = value;
    },
    get doc() {
      return doc;
    },
    get editor() {
      return editors.editor;
    },
    set editor(value) {
      editors.editor = value;
    },
    get engine() {
      return engine;
    },
    get getSelectionRanges() {
      return getSelectionRanges;
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
      return rowCount;
    },
    set rowCount(value) {
      rowCount = value;
    },
    get t() {
      return t;
    },
    get viewport() {
      return viewport;
    },
    get win() {
      return win;
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
      const image = doc.createElement('img');
      image.onload = () => {
        if (!destroyed) {
          rendering.fullDraw = true;
          schedule();
        }
      };
      const color = theme.iconColor.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      image.src = `data:image/svg+xml,${encodeURIComponent(svg.replace('currentColor', color))}`;
      return [name, image];
    }),
  );

  const rowLockSvg = new win.DOMParser().parseFromString(stateIconSvg.lock, 'image/svg+xml').documentElement;

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
      return columns;
    },
    get context() {
      return context;
    },
    get destroyed() {
      return destroyed;
    },
    get doc() {
      return doc;
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
      return engine;
    },
    get enterSurface() {
      return enterSurface;
    },
    get exitSurface() {
      return exitSurface;
    },
    get headerHeight() {
      return headerHeight;
    },
    get indexWidth() {
      return indexWidth;
    },
    get invalidate() {
      return invalidate;
    },
    get mediaColumn() {
      return mediaColumn;
    },
    get options() {
      return options;
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
      return rowCount;
    },
    get scroller() {
      return scroller;
    },
    get select() {
      return select;
    },
    get t() {
      return t;
    },
    get theme() {
      return theme;
    },
    get viewport() {
      return viewport;
    },
    get win() {
      return win;
    },
  });
  const { clearChoiceHover, disposeEditorIntegration, guardEditNavigation, finishEdit, beginEdit, positionEditor } =
    editors;

  const interaction = createInteraction({
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
      return columns;
    },
    get context() {
      return context;
    },
    get destroyed() {
      return destroyed;
    },
    get editors() {
      return editors;
    },
    get engine() {
      return engine;
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
      return headerHeight;
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
      return indexWidth;
    },
    get invalidate() {
      return invalidate;
    },
    get leafHeaders() {
      return leafHeaders;
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
      return options;
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
      return rowCount;
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
      return t;
    },
    get theme() {
      return theme;
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
      return win;
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
    const button = doc.createElement('button');
    button.type = 'button';
    button.hidden = true;
    button.tabIndex = -1;
    button.setAttribute('aria-label', t('Adjust selection {0}', endpoint));
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

  const editorPane = doc.createElement('div');
  editorPane.style.cssText = 'position:absolute;overflow:hidden;pointer-events:none;z-index:1';
  root.append(editorPane);
  const editorLabel = doc.createElement('div');
  editorLabel.dataset.gridEditorLabel = '';
  editorLabel.hidden = true;
  editorLabel.style.cssText =
    'position:absolute;left:0;top:-25px;box-sizing:border-box;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:4px 8px;border:1px solid var(--acheron-grid-line-color);background:var(--acheron-header-background);color:var(--acheron-header-text-color);font:11px system-ui';
  editorPane.append(editorLabel);

  const overlay = createOverlay({
    win,
    doc,
    root,
    engine,
    options,
    t,
    scroller,
    get destroyed() {
      return destroyed;
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
      return columns;
    },
    get creationTypes() {
      return creationTypes;
    },
    get currentView() {
      return currentView;
    },
    set currentView(value) {
      currentView = value;
    },
    get destroyed() {
      return destroyed;
    },
    get doc() {
      return doc;
    },
    get editors() {
      return editors;
    },
    get engine() {
      return engine;
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
      return headerHeight;
    },
    get htmlClipboardBlocks() {
      return htmlClipboardBlocks;
    },
    get indexRow() {
      return indexRow;
    },
    get indexWidth() {
      return indexWidth;
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
      return options;
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
      return rowCount;
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
      return t;
    },
    get win() {
      return win;
    },
    get writeClipboard() {
      return writeClipboard;
    },
  });
  const { format, setFrozen, setLocked, openMenu, onHeaderContextMenu, onContextMenu } = menus;

  const resizeGuide = doc.createElement('div');
  resizeGuide.setAttribute('aria-hidden', 'true');
  resizeGuide.setAttribute('data-grid-resize-guide', '');
  resizeGuide.style.cssText =
    'display:none;position:absolute;pointer-events:none;z-index:3;background:var(--acheron-selection-color)';
  root.append(resizeGuide);
  const freezeVertical = doc.createElement('div');
  const freezeHorizontal = doc.createElement('div');
  for (const line of [freezeVertical, freezeHorizontal]) {
    line.setAttribute('aria-hidden', 'true');
    line.style.cssText = 'position:absolute;pointer-events:none;z-index:2;background:var(--acheron-freeze-color)';
    root.append(line);
  }
  freezeVertical.dataset.gridFreezeLine = 'column';
  freezeHorizontal.dataset.gridFreezeLine = 'row';
  const actionError = doc.createElement('div');
  actionError.setAttribute('role', 'alert');
  actionError.style.cssText =
    'display:none;position:absolute;bottom:20px;left:12px;right:24px;z-index:2;padding:10px;background:color-mix(in srgb,#ef4444 12%,var(--acheron-background));color:var(--acheron-text-color);border:1px solid color-mix(in srgb,#ef4444 50%,var(--acheron-grid-line-color));border-radius:6px;font:13px system-ui';
  root.append(actionError);
  const lockNotice = doc.createElement('div');
  lockNotice.dataset.gridLockNotice = '';
  lockNotice.setAttribute('role', 'status');
  lockNotice.hidden = true;
  lockNotice.style.cssText =
    'position:absolute;top:48px;left:16px;right:16px;z-index:12;padding:16px;background:var(--acheron-background);color:var(--acheron-text-color);border:1px solid var(--acheron-grid-line-color);box-shadow:0 8px 24px #0002;font:var(--acheron-font);pointer-events:none';
  const lockTitle = doc.createElement('strong');
  lockTitle.style.cssText = 'display:flex;align-items:center;gap:8px';
  lockTitle.append(svgIcon('lock'), (options.tableLockNotice && options.tableLockNotice.title) || t('Table locked'));
  const lockDescription = doc.createElement('div');
  lockDescription.style.cssText = 'margin-top:8px;opacity:.8';
  lockDescription.textContent =
    (options.tableLockNotice && options.tableLockNotice.description) ||
    t('Editing is disabled while the table is locked.');
  lockNotice.append(lockTitle, lockDescription);
  root.append(lockNotice);
  let lockNoticeTimer: number | undefined;

  const editorError = doc.createElement('div');
  editorError.id = `acheron-editor-error-${++editorId}`;
  editorError.setAttribute('role', 'alert');
  editorError.style.cssText =
    'display:none;position:absolute;pointer-events:none;z-index:3;padding:8px;border:1px solid color-mix(in srgb,#ef4444 50%,var(--acheron-grid-line-color));border-radius:6px;background:color-mix(in srgb,#ef4444 12%,var(--acheron-background));color:var(--acheron-text-color);font:13px system-ui';
  root.append(editorError);
  const selectionStatus = doc.createElement('div');
  selectionStatus.setAttribute('role', 'status');
  selectionStatus.style.cssText =
    'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
  root.append(selectionStatus);

  const searchBar = doc.createElement('div');
  searchBar.hidden = true;
  searchBar.dataset.gridSearch = '';
  searchBar.setAttribute('role', 'search');
  searchBar.setAttribute('aria-label', t('Find in grid'));
  searchBar.style.cssText =
    'position:absolute;top:4px;right:20px;max-width:calc(100% - 24px);z-index:4;padding:6px;border:1px solid var(--acheron-grid-line-color);border-radius:6px;background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font);box-shadow:0 4px 12px #0f172a26';
  const searchInput = doc.createElement('input');
  searchInput.type = 'search';
  searchInput.setAttribute('aria-label', t('Find in grid'));
  searchInput.style.cssText =
    'width:140px;min-width:80px;max-width:100%;padding:6px;font:inherit;color:inherit;background:var(--acheron-background);border:1px solid var(--acheron-grid-line-color);border-radius:4px;outline:none;box-shadow:none';
  const searchStatus = doc.createElement('span');
  searchStatus.setAttribute('role', 'status');
  searchStatus.style.cssText = 'display:inline-block;padding:0 8px';
  const searchPrevious = doc.createElement('button');
  const searchNext = doc.createElement('button');
  const searchClose = doc.createElement('button');
  for (const [button, label, text] of [
    [searchPrevious, t('Previous match'), '↑'],
    [searchNext, t('Next match'), '↓'],
    [searchClose, t('Close search'), '×'],
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
    win,
    searchBar,
    searchInput,
    searchStatus,
    searchPrevious,
    searchNext,
    searchClose,
    t,
    engine,
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
      return destroyed;
    },
    get rowCount() {
      return rowCount;
    },
    get columns() {
      return columns;
    },
    get theme() {
      return theme;
    },
  });

  const builtinColumnTypes: readonly ColumnType[] = [
    {
      key: 'text',
      label: t('Text'),
      create: (input) => ({
        column: { key: input.key, title: input.title, editable: true, defaultValue: input.defaultText },
      }),
    },
    {
      key: 'number',
      label: t('Number'),
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
      label: 'Checkbox',
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
  const creationTypes = options.columnTypes ?? builtinColumnTypes;
  if (
    !creationTypes.length ||
    new Set(creationTypes.map((type) => type.key)).size !== creationTypes.length ||
    creationTypes.some((type) => !type.key || !type.label || typeof type.create !== 'function')
  )
    throw new TypeError('Invalid column types.');

  const getSelection = engine.getSelection;
  const getSelectionRange = engine.getSelectionRange;
  const getSelectionRanges = engine.getSelectionRanges;

  const reorderGuide = doc.createElement('div');
  reorderGuide.dataset.gridReorderGuide = '';
  reorderGuide.setAttribute('aria-hidden', 'true');
  reorderGuide.style.cssText =
    'display:none;position:absolute;pointer-events:none;z-index:8;background:var(--acheron-selection-color);box-shadow:0 0 0 1px var(--acheron-background)';
  const reorderBadge = doc.createElement('div');
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
  win.addEventListener('blur', onPointerEnd);
  win.addEventListener('resize', render);
  win.addEventListener('scroll', positionEditor, { capture: true, passive: true });
  render();

  function clearLayoutMotion(): void {
    motion.clearLayoutMotion();
  }
  const motion = createMotion({
    options,
    motionDuration,
    win,
    root,
    canvas,
    doc,
    engine,
    dataSource,
    draw,
    viewport,
    get destroyed() {
      return destroyed;
    },
    get columns() {
      return columns;
    },
    get headerHeight() {
      return headerHeight;
    },
    get indexWidth() {
      return indexWidth;
    },
    get frame() {
      return rendering.frame;
    },
    set frame(value) {
      rendering.frame = value;
    },
  });

  const { enterSurface, exitSurface, animateLayout, motionEnabled, removeMotionListener } = motion;
  const enteringGroups = new Set<string>();
  function groupRows(start: number, end: number): string {
    return structureAction(() => {
      const id = engine.groupRows(start, end);
      enteringGroups.add(id);
      return id;
    });
  }
  function structureAction<T>(run: () => T, axis?: 'row' | 'column'): T {
    if (editors.editor || destroyed) throw new Error('Save or cancel the editor before changing structure.');
    return axis ? animateLayout(run, axis) : run();
  }
  return {
    subscribe: engine.subscribe,
    getValue: engine.getValue,
    replaceText: (search: string, replacement: string, options?: Parameters<GridEngine['replaceText']>[2]) => {
      finishEdit(false);
      clearCopyFeedback();
      return engine.replaceText(search, replacement, options);
    },
    takeObserverErrors: engine.takeObserverErrors,
    captureRowIdentity: engine.captureRowIdentity,
    refreshData: (ids?: readonly RowId[] | 'values') => {
      finishEdit(false);
      clearCopyFeedback();
      clipboard.pendingCutText = undefined;
      engine.refreshData(ids);
    },
    exportState: engine.exportState,
    restoreState: (state: unknown) => {
      if (editors.editor) throw new Error('Finish editing before restoring state.');
      if (!state || typeof state !== 'object' || !('configuration' in state))
        throw new TypeError('Invalid grid state.');
      const restored = restoreGridConfiguration(state.configuration, columns, engine.sourceRowCount);
      reorderedHeaderGroups(restored.columns, options.headerGroups);
      engine.restoreState(state);
    },
    setColumnEditor: (key: string, config: ColumnEditor | null) => {
      if (destroyed) throw new Error('Grid is destroyed.');
      const column = columns.find((column) => column.key === key);
      if (!column) throw new Error('Unknown editor column.');
      const valid = config === null ? null : validateColumnEditor(column, config);
      if (editors.editor && engine.getSelection()?.columnKey === key) finishEdit(false);
      if (valid) columnEditors.set(key, valid);
      else columnEditors.delete(key);
      clearChoiceHover();
      render();
    },
    exportConfiguration: () => {
      if (!managesView)
        throw new Error('Export configuration requires core-managed view; persist host view separately.');
      return engine.exportConfiguration();
    },
    getMerge: engine.getMerge,
    getMergedCells: engine.getMergedCells,
    canMerge: engine.canMerge,
    mergeCells: (range: SelectionRange) => structureAction(() => engine.mergeCells(range)),
    unmergeCells: (range: SelectionRange) => structureAction(() => engine.unmergeCells(range)),
    getRowGroups: engine.getRowGroups,
    groupRows,
    ungroupRows: (id: string) => structureAction(() => engine.ungroupRows(id)),
    setGroupCollapsed: (id: string, collapsed: boolean) =>
      structureAction(() => engine.setGroupCollapsed(id, collapsed), 'row'),
    setView: (view: LocalViewOptions) =>
      structureAction(() => {
        engine.setView(view);
        currentView = engine.view;
      }),
    get view() {
      return managesView ? engine.view : (currentView ?? {});
    },
    cutSelectionBlocks,
    cancelCut,
    copySelectionBlocks,
    pasteSelectionBlocks,
    get rowCount() {
      return rowCount;
    },
    get columns() {
      return columns;
    },
    insertColumns: (index: number, added: readonly Column[]) =>
      structureAction(() => engine.insertColumns(index, added)),
    deleteColumns: (indices: readonly number[]) => structureAction(() => engine.deleteColumns(indices)),
    insertRows: (index: number, rows: readonly DataRow[]) => structureAction(() => engine.insertRows(index, rows)),
    deleteRows: (indices: readonly number[]) => structureAction(() => engine.deleteRows(indices)),
    moveRows: (indices: readonly number[], beforeIndex: number) =>
      structureAction(() => engine.moveRows(indices, beforeIndex), 'row'),
    moveColumns: (indices: readonly number[], beforeIndex: number) =>
      structureAction(() => engine.moveColumns(indices, beforeIndex), 'column'),
    setTheme(patch) {
      if (destroyed) throw new Error('Grid is destroyed.');
      const next = Object.freeze({ ...theme, ...patch });
      validateTheme(next);
      clearLayoutMotion();
      clearCopyFeedback();
      theme = next;
      rendering.measuredRows.clear();
      for (const [key, value] of Object.entries(theme))
        root.style.setProperty('--acheron-' + key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()), value);
      for (const [name, image] of Object.entries(stateIcons)) {
        const color = theme.iconColor.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
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
      return engine.frozenRows;
    },
    get frozenColumns() {
      return engine.frozenColumns;
    },
    setFrozen,
    setRowsHidden: (indices, hidden) => {
      if (finishEdit(true)) {
        cancelCut();
        engine.setRowsHidden(indices, hidden);
      }
    },
    setColumnsHidden: (indices, hidden) => {
      if (finishEdit(true)) {
        cancelCut();
        engine.setColumnsHidden(indices, hidden);
      }
    },
    getHiddenRows: engine.getHiddenRows,
    getHiddenColumns: engine.getHiddenColumns,
    isRowHidden: engine.isRowHidden,
    isColumnHidden: engine.isColumnHidden,
    isLocked: engine.isLocked,
    canManageLocks: engine.canManageLocks,
    setLocked,
    getFormat: engine.getFormat,
    canFormat: engine.canFormat,
    format,
    updateCells,
    undo: () => replay(false),
    redo: () => replay(true),
    getCellPermission: engine.getCellPermission,
    getSelection,
    getSelectionRange,
    getSelectionRanges,
    copySelection,
    paste,
    setColumnWidth: (index, width) => resizeAxis(columnAxis, index, width),
    setRowHeight: (index, height) => resizeAxis(rowAxis, index, height),
    destroy() {
      if (destroyed) return;
      cancelLinkPreviewHover();
      root.removeEventListener('pointerleave', cancelLinkPreviewHover);
      clipboard.pendingCutText = undefined;
      clipboard.cutRevision++;
      win.clearTimeout(lockNoticeTimer);
      clearCopyFeedback();
      clearLayoutMotion();
      removeMotionListener();
      if (editors.choices) {
        disposeChoicePanel(editors.choices);
        editors.choices.remove();
      }
      editors.choices = null;
      disposeEditorIntegration();
      win.removeEventListener('beforeunload', guardEditNavigation);
      clearReorder();
      engine.destroy();
      destroyed = true;
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
      for (const src of mediaController.ownedImageUrls) win.URL.revokeObjectURL(src);
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
      if (rendering.frame !== undefined) win.cancelAnimationFrame(rendering.frame);
      observer.disconnect();
      scroller.removeEventListener('scroll', renderCopyFeedback);
      scroller.removeEventListener('scroll', clearLayoutMotion);
      scroller.removeEventListener('scroll', render);
      scroller.removeEventListener('scroll', clearChoiceHover);
      root.removeEventListener('pointerleave', clearChoiceHover);
      win.removeEventListener('blur', onPointerEnd);
      win.removeEventListener('resize', render);
      win.removeEventListener('scroll', positionEditor, true);
      root.remove();
    },
  };
}

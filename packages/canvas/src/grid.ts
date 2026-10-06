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
  const measuredRows = new Set<number>();
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
        if (engine.getMergedCells().length) fullDraw = true;
        if (options.autoRowHeight) {
          change.cells.forEach((cell) => measuredRows.delete(cell.rowIndex));
          fullDraw = true;
        }
        invalidate(change.cells);
        if (!searchBar.hidden) refreshSearch();
      } else if (change.type === 'layout' || change.type === 'structure') {
        if (change.type === 'structure') {
          hoveredChoice = null;
          if (managesView) currentView = engine.view;
          if (axisAnchor) {
            const map = axisAnchor.axis === 'row' ? change.rowMap : change.columnMap,
              next = map[axisAnchor.index];
            axisAnchor = next !== undefined && next >= 0 ? { ...axisAnchor, index: next } : null;
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
          measuredRows.clear();
          accessibleCells.clear();
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
  function choiceOptionsFor(key: string): ChoiceEditorOptions | false | undefined {
    const config = columnEditors.get(key),
      local = config && config.type !== 'checkbox' ? config.choiceEditor : undefined;
    return local === false ? false : local ? { ...(options.choiceEditor || {}), ...local } : options.choiceEditor;
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
  const accessibleCells = new Map<string, HTMLElement>();
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
      return editor;
    },
    set editor(value) {
      editor = value;
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
  let frame: number | undefined;
  let destroyed = false;
  const stateIcons = Object.fromEntries(
    Object.entries(stateIconSvg).map(([name, svg]) => {
      const image = doc.createElement('img');
      image.onload = () => {
        if (!destroyed) {
          fullDraw = true;
          schedule();
        }
      };
      const color = theme.iconColor.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      image.src = `data:image/svg+xml,${encodeURIComponent(svg.replace('currentColor', color))}`;
      return [name, image];
    }),
  );
  function svgIcon(name: keyof typeof icons, size = 16): Element {
    const svg = new win.DOMParser().parseFromString(icons[name], 'image/svg+xml').documentElement;
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    return doc.importNode(svg, true);
  }
  const rowLockSvg = new win.DOMParser().parseFromString(stateIconSvg.lock, 'image/svg+xml').documentElement;
  function stateIcon(name: keyof typeof stateIconSvg, x: number, y: number): void {
    const image = stateIcons[name]!;
    if (image.complete && image.naturalWidth) context!.drawImage(image, x, y, 16, 16);
  }

  let hoveredChoice: { row: number; col: number } | null = null;
  function clearChoiceHover(): void {
    if (!hoveredChoice) return;
    const old = hoveredChoice;
    hoveredChoice = null;
    if (old.row < rowCount && old.col < columns.length)
      invalidate([{ rowIndex: old.row, columnKey: columns[old.col]!.key }]);
  }
  let dragPointer: number | null = null;
  let axisAnchor: { axis: 'row' | 'column'; index: number } | null = null;
  let axisDrag: { axis: 'row' | 'column'; index: number } | null = null;
  let dragPosition: { clientX: number; clientY: number } | null = null;
  let dragFrame: number | undefined;
  let handleAnchor: { row: number; col: number } | null = null;
  let touchSelection = false;
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
      handleAnchor =
        endpoint === 'start'
          ? { row: range.endRow, col: range.endColumn }
          : { row: range.startRow, col: range.startColumn };
      axisDrag = null;
      dragPointer = event.pointerId;
      dragPosition = event;
      root.setPointerCapture(event.pointerId);
    });
    root.append(button);
    return button;
  });
  let addNextSelection = false;
  let editor: CellEditor | null = null;
  let editorCleanup: (() => void) | undefined;
  function disposeEditorIntegration(): void {
    const cleanup = editorCleanup;
    editorCleanup = undefined;
    try {
      cleanup?.();
    } catch (error) {
      try {
        options.onObserverError?.(error);
      } catch {}
    }
  }
  let richEditor: HTMLDivElement | null = null;
  let choices: HTMLElement | null = null;
  const editorPane = doc.createElement('div');
  editorPane.style.cssText = 'position:absolute;overflow:hidden;pointer-events:none;z-index:1';
  root.append(editorPane);
  const editorLabel = doc.createElement('div');
  editorLabel.dataset.gridEditorLabel = '';
  editorLabel.hidden = true;
  editorLabel.style.cssText =
    'position:absolute;left:0;top:-25px;box-sizing:border-box;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:4px 8px;border:1px solid var(--acheron-grid-line-color);background:var(--acheron-header-background);color:var(--acheron-header-text-color);font:11px system-ui';
  editorPane.append(editorLabel);
  let editorAnchor: { left: number; top: number; width: number; height: number } | null = null;
  function guardEditNavigation(event: BeforeUnloadEvent): void {
    if (editor) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  let fullDraw = true;
  const dirty = new Map<string, { rowIndex: number; columnKey: string }>();
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

  let suggestionsEnabled = options.contextMenuSuggestions ?? false;

  let resizing: {
    pointerId: number;
    axis: 'column' | 'row';
    index: number;
    start: number;
    size: number;
    proposed: number;
    edge: number;
  } | null = null;
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

  function announceSelection(): void {
    const selection = engine.getSelection();
    selectionStatus.textContent = `${selection ? t('Row {0}, {1}. {2} selected range(s).', selection.rowIndex + 1, columns[selection.columnIndex]!.title, getSelectionRanges().length) : t('Selection cleared.')}${addNextSelection ? t(' Next click or navigation adds a range.') : ''}`;
  }

  function openSizeDialog(
    label: string,
    current: number,
    apply: (size: number) => void,
    units: string | null = 'px',
  ): void {
    const dialog = doc.createElement('dialog');
    overlay.activeDialog?.remove();
    overlay.activeDialog = dialog;
    dialog.setAttribute('aria-label', label);
    dialog.dataset.gridDialog = '';
    const form = doc.createElement('form');
    const fieldLabel = doc.createElement('label');
    fieldLabel.textContent = `${label}${units ? ` (${units})` : ''} `;
    const input = doc.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = units ? 'any' : '1';
    input.required = true;
    input.value = String(current);

    fieldLabel.append(input);
    const save = doc.createElement('button');
    save.type = 'submit';
    save.textContent = t('Apply');
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.textContent = t('Cancel');

    cancel.addEventListener('click', () => dialog.close());
    input.addEventListener('input', () => input.setCustomValidity(''));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        apply(input.valueAsNumber);
        dialog.close();
      } catch (error) {
        input.setCustomValidity(error instanceof Error ? t(error.message) : t('Invalid size.'));
        input.reportValidity();
      }
    });
    const actions = doc.createElement('div');
    actions.dataset.dialogActions = '';
    actions.append(save, cancel);
    form.append(fieldLabel, actions);
    dialog.append(form);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (overlay.activeDialog === dialog) overlay.activeDialog = null;
      if (!destroyed && !editor) scroller.focus({ preventScroll: true });
    });
    root.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  }

  function format(targets: readonly CellFormatTarget[], patch: CellFormatPatch | null): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before changing formatting.');
    engine.format(targets, patch);
  }

  function openFormatDialog(row: number, col: number): void {
    const ranges = getSelectionRanges();
    const dialog = doc.createElement('dialog');
    overlay.activeDialog?.remove();
    overlay.activeDialog = dialog;
    dialog.setAttribute('aria-label', t('Format cells'));
    dialog.dataset.gridDialog = '';
    const form = doc.createElement('form');
    const scopeLabel = doc.createElement('label');
    scopeLabel.textContent = t('Apply to ');
    const scope = doc.createElement('select');
    for (const [value, label] of [
      ['selection', t('Selected cells')],
      ['row', t('This row')],
      ['column', t('This column')],
      ['table', t('Whole table')],
    ]) {
      const option = doc.createElement('option');
      option.value = value!;
      option.textContent = label!;
      scope.append(option);
    }
    scopeLabel.append(scope);
    form.append(scopeLabel);
    function field(label: string, value: string, checked: boolean) {
      const line = doc.createElement('div');
      line.style.cssText = 'display:flex;gap:12px;align-items:center;margin:16px 0';
      const apply = doc.createElement('input');
      apply.type = 'checkbox';
      apply.checked = checked;
      const applyLabel = doc.createElement('label');
      applyLabel.append(apply, t(' Change {0}', label.toLowerCase()));
      const color = doc.createElement('input');
      color.type = 'color';
      color.value = value;
      color.setAttribute('aria-label', label);
      line.append(applyLabel, color);
      form.append(line);
      return { apply, color };
    }
    const background = field(t('Background color'), '#fff4b3', true);
    const text = field(t('Text color'), '#0f172a', false);
    const numberApply = doc.createElement('input');
    numberApply.type = 'checkbox';
    const numberSelect = doc.createElement('select');
    numberSelect.setAttribute('aria-label', t('Number format'));
    for (const [value, label] of [
      ['decimal', t('Decimal')],
      ['integer', t('Integer')],
      ['percent', t('Percent')],
      ['currency', t('Currency')],
    ]) {
      const option = doc.createElement('option');
      option.value = value!;
      option.textContent = label!;
      numberSelect.append(option);
    }
    const numberLabel = doc.createElement('label');
    numberLabel.append(numberApply, t(' Change number format '), numberSelect);
    form.append(numberLabel);
    const error = doc.createElement('div');
    error.setAttribute('role', 'alert');
    error.style.cssText = 'color:#9f1239;margin-bottom:12px';
    error.hidden = true;
    const save = doc.createElement('button');
    save.type = 'submit';
    save.textContent = t('Apply');
    const clear = doc.createElement('button');
    clear.type = 'button';
    clear.textContent = t('Clear formatting');
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.textContent = t('Cancel');

    function targets(): CellFormatTarget[] {
      if (scope.value === 'row') return [{ scope: 'row', rowIndex: row }];
      if (scope.value === 'column') return [{ scope: 'column', columnIndex: col }];
      if (scope.value === 'table') return [{ scope: 'table' }];
      return ranges.map((range) => ({ scope: 'range', range }));
    }
    function checkPermission(): void {
      const allowed = engine.canFormat(targets());
      save.disabled = clear.disabled = !allowed;
      error.hidden = allowed;
      error.textContent = allowed ? '' : t('Formatting is not allowed for this selection.');
    }
    function apply(patch: CellFormatPatch): void {
      try {
        format(targets(), patch);
        dialog.close();
      } catch (failure) {
        error.textContent = failure instanceof Error ? t(failure.message) : t('Formatting failed.');
        error.hidden = false;
      }
    }
    scope.addEventListener('change', checkPermission);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!background.apply.checked && !text.apply.checked && !numberApply.checked) {
        error.textContent = t('Choose a format to change.');
        error.hidden = false;
        return;
      }
      apply({
        ...(numberApply.checked ? { numberFormat: numberSelect.value as NumberFormat } : {}),
        ...(background.apply.checked ? { background: background.color.value } : {}),
        ...(text.apply.checked ? { textColor: text.color.value } : {}),
      });
    });
    clear.addEventListener('click', () => apply({ background: null, textColor: null, numberFormat: null }));
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (overlay.activeDialog === dialog) overlay.activeDialog = null;
      if (!destroyed && !editor) scroller.focus({ preventScroll: true });
    });
    const actions = doc.createElement('div');
    actions.dataset.dialogActions = '';
    actions.append(save, clear, cancel);
    form.append(error, actions);
    dialog.append(form);
    root.append(dialog);
    checkPermission();
    dialog.showModal();
    scope.focus();
  }

  function setLocked(target: CellLockTarget, locked: boolean): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before changing locks.');
    const wasLocked = engine.isLocked(target);
    engine.setLocked(target, locked);
    rowLockCache.clear();
    if (target.scope === 'table') {
      win.clearTimeout(lockNoticeTimer);
      lockNotice.getAnimations().forEach((animation) => animation.cancel());
      lockNotice.hidden = true;
      if (locked && !wasLocked && options.tableLockNotice !== false) {
        lockNotice.hidden = false;
        if (motionEnabled())
          lockNotice.animate(
            [
              { opacity: 0, transform: 'translateY(2px)' },
              { opacity: 1, transform: 'translateY(0)', offset: 0.045 },
              { opacity: 1, offset: 0.95 },
              { opacity: 0 },
            ],
            { duration: 4000, easing: 'ease-out' },
          );
        lockNoticeTimer = win.setTimeout(() => {
          lockNotice.hidden = true;
        }, 4000);
      }
    }
  }

  function setFrozen(rows: number, columns: number): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before changing frozen panes.');
    const axis = rows !== engine.frozenRows ? 'row' : 'column';
    animateLayout(() => engine.setFrozen(rows, columns), axis);
    if (motionEnabled())
      for (const [line, scale] of [
        [freezeVertical, 'scaleY'],
        [freezeHorizontal, 'scaleX'],
      ] as const)
        if (!line.hidden) {
          line.style.transformOrigin = 'top left';
          line.animate(
            [
              { opacity: 0, transform: `${scale}(0)` },
              { opacity: 1, transform: `${scale}(1)` },
            ],
            { duration: motionDuration, easing: 'cubic-bezier(.22,1,.36,1)' },
          );
        }
  }

  function resizeAxis(axis: typeof rowAxis, index: number, size: number): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before resizing cells.');
    if (axis === rowAxis) {
      engine.setRowHeight(index, size);
    } else {
      engine.setColumnWidth(index, size);
      measuredRows.clear();
    }
  }

  function visibleIndices(axis: 'row' | 'column'): Set<number> {
    const indices = new Set<number>();
    for (const region of viewport().regions) {
      const range = axis === 'row' ? region.rows : region.columns;
      for (let index = range.start; index < range.end; index++) indices.add(index);
    }
    return indices;
  }
  function autoFitColumn(index: number): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before resizing cells.');
    columnAxis.size(index);
    const column = columns[index]!;
    const ctx = context!;
    ctx.save();
    let width: number;
    try {
      ctx.font = theme.headerFont;
      width = ctx.measureText(column.title).width + 56;
      ctx.font = theme.font;
      for (const row of visibleIndices('row')) {
        const value = engine.getValue(row, column.key);
        if (mediaColumn(column.key)) {
          width = Math.max(width, mediaSize * 2 + 16);
          continue;
        } else if (columnEditors.get(column.key)?.type === 'checkbox') width = Math.max(width, 36);
        else {
          const rich = richText(value, column.key, engine.getFormat(row, index).contentFormat);
          if (rich) width = Math.max(width, layoutRichText(ctx, rich, theme.font, Infinity, false).width + 20);
          else
            for (const line of numberText(value, engine.getFormat(row, index).numberFormat).split('\n'))
              width = Math.max(width, ctx.measureText(line).width + 20);
          ctx.font = theme.font;
        }
      }
    } finally {
      ctx.restore();
    }
    resizeAxis(columnAxis, index, Math.max(24, Math.min(1000, Math.ceil(width))));
  }
  function autoFitRow(index: number): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before resizing cells.');
    rowAxis.size(index);
    resizeAxis(rowAxis, index, measureRowHeight(index));
  }
  function measureRowHeight(index: number, allColumns = false): number {
    const ctx = context!;
    ctx.save();
    let height = options.rowHeight ?? 24;
    try {
      ctx.font = theme.font;
      const metrics = ctx.measureText('M');
      const lineHeight = Math.ceil(metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) || 18;
      for (const col of allColumns ? columns.keys() : visibleIndices('column')) {
        const key = columns[col]!.key;
        const value = engine.getValue(index, key);
        const custom = options.measureCellHeight?.(value, key, columnAxis.size(col));
        if (custom !== undefined) {
          if (!Number.isFinite(custom) || custom <= 0)
            throw new RangeError('Measured cell height must be positive and finite.');
          height = Math.max(height, custom);
          continue;
        }
        if (mediaColumn(key)) {
          height = Math.max(height, mediaSize + 8);
          continue;
        }
        const rich = richText(value, key, engine.getFormat(index, col).contentFormat);
        if (rich) {
          const layout = layoutRichText(
            ctx,
            rich,
            theme.font,
            Math.max(0, columnAxis.size(col) - 20),
            !!options.wrapText,
            Math.ceil(1000 / lineHeight),
          );
          height = Math.max(height, Math.min(1000, layout.lines * layout.lineHeight + 12));
          ctx.font = theme.font;
          continue;
        }
        let lines = 1;
        let line = '';
        if (options.wrapText)
          for (const character of numberText(value, engine.getFormat(index, col).numberFormat)) {
            if (
              character === '\n' ||
              (line && ctx.measureText(line + character).width > Math.max(0, columnAxis.size(col) - 20))
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
      !(event.target instanceof win.Node) ||
      (event.target !== root &&
        !scroller.contains(event.target) &&
        !indexGutter.contains(event.target) &&
        !headerSurface.contains(event.target))
    )
      return;
    const column = columnEdge(event);
    const row = column === null ? rowEdge(event) : null;
    if (column === null && row === null) return;
    event.preventDefault();
    event.stopPropagation();
    endResize();
    onPointerEnd();
    if (!finishEdit(true)) return;
    try {
      if (column !== null) autoFitColumn(column);
      else autoFitRow(row!);
    } catch (error) {
      actionError.textContent = error instanceof Error ? t(error.message) : t('Unable to fit size.');
      actionError.style.display = 'block';
    }
  }

  function selectedAxisIndices(axis: 'row' | 'column', index: number): number[] {
    const ranges = getSelectionRanges().filter((range) =>
      axis === 'row'
        ? range.startColumn === 0 && range.endColumn === columns.length - 1
        : range.startRow === 0 && range.endRow === rowCount - 1,
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
  function changeRows(request: Readonly<RowChangeRequest>): void {
    if (!finishEdit(true)) return;
    if (options.canRowChange?.(request) === false) throw new Error('Changing rows is disabled.');
    options.onRowChange?.(request);
  }
  function openMenu(row: number, col: number, x: number, y: number, header = false): void {
    closeMenu();
    const range = getSelectionRange();
    if (
      rowCount &&
      !getSelectionRanges().some(
        (range) => row >= range.startRow && row <= range.endRow && col >= range.startColumn && col <= range.endColumn,
      )
    )
      select(row, col, false, false);
    if (destroyed || (rowCount > 0 && !engine.getCellPermission(row, col).selectable)) return;
    header ||=
      axisAnchor?.axis === 'column' &&
      getSelectionRanges().some(
        (range) =>
          range.startRow === 0 && range.endRow === rowCount - 1 && col >= range.startColumn && col <= range.endColumn,
      );
    const selection =
      engine.getSelection() ??
      (header || (!rowCount && options.onRowChange)
        ? { rowIndex: 0, columnIndex: col, columnKey: columns[col]!.key, rowId: 0 }
        : null);
    if (!selection) return;
    const popup = doc.createElement('div');
    overlay.menu = popup;
    popup.popover = 'auto';
    popup.setAttribute('role', 'menu');
    popup.setAttribute('aria-label', header ? t('Column actions') : t('Cell actions'));
    popup.className = 'acheron-context-menu';
    popup.style.cssText =
      'position:fixed;margin:0;padding:6px;min-width:200px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;border:1px solid var(--acheron-grid-line-color);border-radius:10px;box-shadow:0 12px 32px #0003;background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font)';
    const style = doc.createElement('style');
    style.textContent =
      '.acheron-context-menu [hidden]{display:none!important}.acheron-context-menu button{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:4px;background:transparent;text-align:left;color:inherit;font:inherit;cursor:pointer;outline:none}.acheron-context-menu button:hover:not(:disabled),.acheron-context-menu button:focus-visible{background:var(--acheron-header-background)}.acheron-context-menu button:focus-visible{box-shadow:inset 0 0 0 2px var(--acheron-selection-color)}.acheron-context-menu button:disabled{opacity:.45;cursor:default}.acheron-context-menu svg{flex:none;color:var(--acheron-icon-color)}.acheron-context-menu [role=separator]{height:1px;background:var(--acheron-grid-line-color);margin:5px 4px}';
    popup.append(style);
    style.textContent +=
      '.acheron-context-menu:popover-open{display:grid;gap:2px}.acheron-context-menu:not(:popover-open){display:none}';
    popup.addEventListener('toggle', () => {
      if (!popup.matches(':popover-open') && overlay.menu === popup) closeMenu();
    });
    const filter = doc.createElement('input');
    filter.type = 'search';
    filter.hidden = true;
    filter.placeholder = t('Filter actions…');
    filter.setAttribute('aria-label', t('Filter actions'));
    filter.style.cssText =
      'position:sticky;top:0;width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--acheron-grid-line-color);border-radius:4px;background:var(--acheron-background);color:inherit;font:inherit;outline:none';
    popup.append(filter);
    const empty = doc.createElement('div');
    empty.textContent = t('No matching actions');
    empty.hidden = true;
    empty.setAttribute('role', 'status');
    empty.style.padding = '10px';
    let showAll = !suggestionsEnabled;
    const recommended = (label: string): boolean =>
      /^(Copy|Cut|Paste|Undo|Redo|Open links|Edit cell)/.test(label) ||
      (header
        ? /^(Sort|Filter|Resize column|Auto-fit column|Move columns|Freeze columns|Lock.*column|Unlock.*column)/.test(
            label,
          )
        : axisAnchor?.axis === 'row'
          ? /^(Group|Ungroup|Collapse|Expand|Move rows|Insert row|Delete.*row|Lock.*row|Unlock.*row)/.test(label)
          : /^(Merge|Unmerge|Format cells|Lock.*cell|Unlock.*cell)/.test(label));
    function filterActions(): void {
      const query = filter.value.trim().toLocaleLowerCase();
      let count = 0;
      for (const button of Array.from(popup.querySelectorAll<HTMLButtonElement>('button[data-action]'))) {
        button.hidden = query
          ? !button.textContent!.toLocaleLowerCase().includes(query)
          : !showAll && (button.disabled || !recommended(button.dataset.action!) || count >= 8);
        if (!button.hidden) count++;
      }
      let previousGroup = '';
      for (const child of Array.from(popup.children)) {
        if (child.getAttribute('role') === 'separator') (child as HTMLElement).hidden = true;
        if (child instanceof win.HTMLButtonElement && !child.hidden) {
          if (previousGroup && child.dataset.group !== previousGroup) {
            let preceding = child.previousElementSibling;
            while (preceding && preceding.getAttribute('role') !== 'separator')
              preceding = preceding.previousElementSibling;
            if (preceding) (preceding as HTMLElement).hidden = false;
          }
          previousGroup = child.dataset.group!;
        }
      }
      empty.hidden = count > 0;
      mode.hidden = !!query;
      all.hidden = !!query || showAll;
      if (popup.isConnected && popup.matches(':popover-open')) {
        popup.style.left = `${Math.max(8, Math.min(x, win.innerWidth - popup.offsetWidth - 8))}px`;
        popup.style.top = `${Math.max(8, Math.min(y, win.innerHeight - popup.offsetHeight - 8))}px`;
      }
    }
    filter.addEventListener('input', filterActions);
    const fingerprint = JSON.stringify(getSelectionRanges());
    const menuIcons: readonly (readonly [string, keyof typeof icons, string])[] = [
      ['Copy', 'copy', 'clipboard'],
      ['Cut', 'scissors', 'clipboard'],
      ['Paste', 'clipboard-paste', 'clipboard'],
      ['Select row', 'rows-3', 'selection'],
      ['Select column', 'columns-3', 'selection'],
      ['Sort ascending', 'arrow-up', 'view'],
      ['Sort descending', 'arrow-down', 'view'],
      ['Filter', 'funnel', 'view'],
      ['Clear sort', 'list-filter', 'view'],
      ['Insert row above', 'between-horizontal-start', 'structure'],
      ['Insert row', 'between-horizontal-end', 'structure'],
      ['Insert rows', 'rows-3', 'structure'],
      ['Insert column left', 'between-vertical-start', 'structure'],
      ['Insert column', 'between-vertical-end', 'structure'],
      ['Delete', 'x', 'structure'],
      ['Move', 'move', 'structure'],
      ['Merge', 'columns-3', 'outline'],
      ['Unmerge', 'columns-3', 'outline'],
      ['Group', 'rows-3', 'outline'],
      ['Ungroup', 'rows-3', 'outline'],
      ['Collapse', 'chevron-down', 'outline'],
      ['Expand', 'chevron-down', 'outline'],
      ['Open links', 'external-link', 'links'],
      ['Edit', 'square-pen', 'editing'],
      ['Undo', 'undo-2', 'editing'],
      ['Redo', 'redo-2', 'editing'],
      ['Format', 'palette', 'editing'],
      ['Unlock', 'lock-open', 'permissions'],
      ['Lock', 'lock', 'permissions'],
      ['Cell is', 'lock', 'permissions'],
      ['Freeze', 'snowflake', 'freeze'],
      ['Unfreeze', 'panel-top-close', 'freeze'],
      ['Auto-fit', 'maximize-2', 'layout'],
      ['Resize column', 'arrow-left-right', 'layout'],
      ['Resize row', 'arrow-up-down', 'layout'],
    ];
    let previousGroup = '';
    function item(label: string, enabled: boolean, action: () => void | Promise<void>): void {
      const button = doc.createElement('button');
      button.type = 'button';
      const [, name, group] = menuIcons.find(([prefix]) => label.startsWith(prefix)) ?? ['', 'square-pen', 'editing'];
      if (previousGroup && group !== previousGroup) {
        const separator = doc.createElement('div');
        separator.setAttribute('role', 'separator');
        popup.append(separator);
      }
      previousGroup = group;
      button.dataset.group = group;
      button.append(svgIcon(name), doc.createTextNode(t(label)));
      button.dataset.action = label;
      button.setAttribute('role', 'menuitem');
      button.disabled = !enabled;
      button.addEventListener('click', async () => {
        closeMenu(true);
        actionError.style.display = 'none';
        try {
          await action();
        } catch (error) {
          if (!destroyed) {
            actionError.textContent = `${error instanceof Error ? t(error.message) : t('Action failed.')}${label === 'Copy' || label === 'Cut' || label.startsWith('Paste') ? t(' Use Ctrl/Cmd+C or Ctrl/Cmd+V if the browser blocks menu clipboard access.') : ''}`;
            actionError.style.display = 'block';
          }
        }
      });
      popup.append(button);
    }
    item(
      'Copy',
      rowCount > 0 &&
        getSelectionRanges().length > 0 &&
        engine.getCellPermission(selection.rowIndex, selection.columnIndex).copyable &&
        !!win.navigator.clipboard?.writeText,
      writeClipboard,
    );
    item(
      'Cut',
      rowCount > 0 &&
        getSelectionRanges().length > 0 &&
        engine.canEdit(selection.rowIndex, selection.columnIndex) &&
        !!win.navigator.clipboard?.writeText,
      () => writeClipboard(true),
    );
    const readClipboard = async (pasteOptions?: PasteOptions) => {
      let text = '',
        html = '';
      if (win.navigator.clipboard.read) {
        const items = await win.navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
          if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
        }
      } else text = await win.navigator.clipboard.readText();
      if (destroyed || fingerprint !== JSON.stringify(getSelectionRanges()))
        throw new Error('Selection changed before paste. Try again.');
      if (html) pasteSelectionBlocks(encodeBlocks(htmlClipboardBlocks(html)), pasteOptions);
      else paste(text, pasteOptions);
    };
    item('Paste', !!win.navigator.clipboard?.readText && engine.canPaste(), () => readClipboard());
    item('Paste values only', !!win.navigator.clipboard?.readText && engine.canPaste(), () =>
      readClipboard({ mode: 'values' }),
    );
    item(
      'Paste formats only',
      !!win.navigator.clipboard?.readText &&
        engine.canFormat(getSelectionRanges().map((range) => ({ scope: 'range' as const, range }))),
      () => readClipboard({ mode: 'formats' }),
    );
    item('Paste transposed', !!win.navigator.clipboard?.readText && engine.canPaste(), () =>
      readClipboard({ transpose: true }),
    );
    item('Paste skipping empty cells', !!win.navigator.clipboard?.readText && engine.canPaste(), () =>
      readClipboard({ skipEmpty: true }),
    );
    if (header) {
      item('Select column', true, () => selectColumn(col));
      item('Sort ascending…', managesView || !!options.onViewChange, () => openViewDialog(col, 'asc'));
      item('Sort descending…', managesView || !!options.onViewChange, () => openViewDialog(col, 'desc'));
      item('Filter column…', managesView || !!options.onViewChange, () => openViewDialog(col));
      item('Clear sort and filters…', managesView || !!options.onViewChange, () => openViewDialog(col, 'clear'));
    } else {
      item('Select row', rowCount > 0, () => selectRow(row));
      item('Select column', true, () => selectColumn(col));
    }
    item(header ? 'Hide selected columns' : 'Hide selected rows', !engine.isLocked({ scope: 'table' }), () => {
      if (header) engine.setColumnsHidden(selectedAxisIndices('column', col), true);
      else engine.setRowsHidden(selectedAxisIndices('row', row), true);
    });
    item('Show all hidden rows', engine.getHiddenRows().length > 0, () =>
      engine.setRowsHidden(engine.getHiddenRows(), false),
    );
    item(
      'Show all hidden columns',
      columns.some((_, i) => engine.isColumnHidden(i)),
      () => engine.setColumnsHidden(engine.getHiddenColumns(), false),
    );
    const indices = selectedAxisIndices(header ? 'column' : 'row', header ? col : row);
    if (!header && rowCount) {
      const selected = getSelectionRanges(),
        span = selected.length === 1 ? selected[0] : undefined;
      item('Merge cells', !!span && engine.canMerge(span), () => {
        if (span) structureAction(() => engine.mergeCells(span));
      });
      const affected = span
        ? engine
            .getMergedCells()
            .filter(
              (merge) =>
                merge.startRow <= engine.getRowSourceIndex(span.endRow) &&
                merge.endRow >= engine.getRowSourceIndex(span.startRow) &&
                merge.startColumn <= span.endColumn &&
                merge.endColumn >= span.startColumn,
            )
        : [];
      item(
        'Unmerge cells',
        affected.length > 0 && affected.every((range) => engine.canChangeLayout({ kind: 'unmerge', range })),
        () => {
          if (span) structureAction(() => engine.unmergeCells(span));
        },
      );
      const wholeRows =
        !!span && span.startColumn === 0 && span.endColumn === columns.length - 1 && span.endRow > span.startRow;
      item(
        'Group selected rows',
        wholeRows &&
          !engine.getRowGroups().some((group) => group.collapsed) &&
          !engine.view.sort &&
          !engine.view.sorts?.length &&
          !engine.view.filters?.length &&
          !!span &&
          engine.canChangeLayout({
            kind: 'group',
            group: { id: '', startRow: span.startRow, endRow: span.endRow, collapsed: false },
          }),
        () => {
          if (span) groupRows(span.startRow, span.endRow);
        },
      );
      const sourceRow = engine.getRowSourceIndex(row),
        rowGroups = engine
          .getRowGroups()
          .filter((group) => sourceRow >= group.startRow && sourceRow <= group.endRow)
          .sort((a, b) => a.endRow - a.startRow - (b.endRow - b.startRow));
      const group = rowGroups[0];
      if (group) {
        item(
          group.collapsed ? 'Expand row group' : 'Collapse row group',
          engine.canChangeLayout({ kind: group.collapsed ? 'expand' : 'collapse', group }),
          () => structureAction(() => engine.setGroupCollapsed(group.id, !group.collapsed), 'row'),
        );
        item('Ungroup rows', engine.canChangeLayout({ kind: 'ungroup', group }), () =>
          structureAction(() => engine.ungroupRows(group.id)),
        );
      }
    }
    if (!header && options.onRowChange) {
      const above = Object.freeze({ kind: 'insert' as const, beforeIndex: indices[0]!, count: 1 });
      const below = Object.freeze({
        kind: 'insert' as const,
        beforeIndex: rowCount ? indices[indices.length - 1]! + 1 : 0,
        count: 1,
      });
      const deletion = Object.freeze({ kind: 'delete' as const, indices: Object.freeze(indices) });
      item('Insert row above', options.canRowChange?.(above) !== false, () => changeRows(above));
      item('Insert row below', options.canRowChange?.(below) !== false, () => changeRows(below));
      item('Insert rows…', options.canRowChange?.(above) !== false, () =>
        openSizeDialog(
          t('Number of rows'),
          1,
          (count) => {
            if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new RangeError('Choose 1–1000 rows.');
            changeRows(Object.freeze({ ...above, count }));
          },
          null,
        ),
      );
      item(
        indices.length > 1 ? `Delete ${indices.length} selected rows` : 'Delete row',
        rowCount > 0 && options.canRowChange?.(deletion) !== false,
        () => changeRows(deletion),
      );
    }
    if (header && options.allowColumnChanges) {
      const request = {
        axis: 'column' as const,
        kind: 'insert' as const,
        indices: [],
        beforeIndex: indices[0]!,
        count: 1,
      };
      item('Insert column left…', engine.canChangeStructure(request), () => openColumnDialog(indices[0]!));
      item('Insert column right…', engine.canChangeStructure({ ...request, beforeIndex: indices.at(-1)! + 1 }), () =>
        openColumnDialog(indices.at(-1)! + 1),
      );
      item(
        indices.length > 1 ? 'Delete ' + indices.length + ' selected columns' : 'Delete column',
        indices.length < columns.length &&
          engine.canChangeStructure({
            axis: 'column',
            kind: 'delete',
            indices,
            beforeIndex: indices[0]!,
            count: indices.length,
          }),
        () => engine.deleteColumns(indices),
      );
    }
    if (options.onReorder)
      item(
        header ? 'Move columns to…' : 'Move rows to…',
        (header || rowCount > 0) &&
          options.canReorder?.({ axis: header ? 'column' : 'row', indices, beforeIndex: indices[0]! }) !== false,
        () => {
          const axis = header ? 'column' : 'row';
          const count = header ? columns.length : rowCount;
          openSizeDialog(
            header ? t('Destination column') : t('Destination row'),
            indices[0]! + 1,
            (destination) => {
              if (!Number.isSafeInteger(destination) || destination < 1 || destination > count - indices.length + 1)
                throw new RangeError(`Choose a position from 1 to ${count - indices.length + 1}.`);
              const moved = new Set(indices);
              const remaining = Array.from({ length: count }, (_, i) => i).filter((i) => !moved.has(i));
              const request = Object.freeze({
                axis,
                indices: Object.freeze(indices),
                beforeIndex: remaining[destination - 1] ?? count,
              });
              if (options.canReorder?.(request) === false) throw new Error('Moving items is disabled.');
              options.onReorder?.(request);
            },
            null,
          );
        },
      );
    if (!header && rowCount && cellLinks(row, col).length)
      item('Open links…', options.allowOpenLinks !== false, () => openLinks(row, col, x, y));
    item('Edit cell', rowCount > 0 && engine.canEdit(selection.rowIndex, selection.columnIndex), beginEdit);
    item('Undo', engine.canUndo(), () => {
      replay(false);
    });
    item('Redo', engine.canRedo(), () => {
      replay(true);
    });
    item(
      'Format cells…',
      rowCount > 0 && engine.canFormat(getSelectionRanges().map((range) => ({ scope: 'range', range }))),
      () => openFormatDialog(row, col),
    );
    const lockRanges = getSelectionRanges();
    const selectedCellsLocked = lockRanges.every((range) => {
      for (let r = range.startRow; r <= range.endRow; r++)
        for (let c = range.startColumn; c <= range.endColumn; c++)
          if (!engine.isLocked({ scope: 'cell', rowIndex: r, columnIndex: c })) return false;
      return true;
    });
    const lockTargets: [string, CellLockTarget[]][] = [
      [
        lockRanges.length > 1 ||
        lockRanges.some((range) => range.startRow !== range.endRow || range.startColumn !== range.endColumn)
          ? 'selected cells'
          : 'cell',
        [{ scope: 'cell', rowIndex: row, columnIndex: col }],
      ],
      ['row', selectedAxisIndices('row', row).map((rowIndex) => ({ scope: 'row', rowIndex }))],
      ['column', selectedAxisIndices('column', col).map((columnIndex) => ({ scope: 'column', columnIndex }))],
      ['table', [{ scope: 'table' }]],
    ];
    for (const [label, targets] of lockTargets) {
      if (!targets.length || (!rowCount && (label === 'row' || label.includes('cell')))) continue;
      const locked = label.includes('cell') ? selectedCellsLocked : targets.every((target) => engine.isLocked(target));
      const name =
        targets.length > 1 && (label === 'row' || label === 'column')
          ? t('{0} selected {1}s', targets.length, t(label))
          : t(label);
      item(`${locked ? 'Unlock' : 'Lock'} ${name}`, engine.canManageLocks(), () => {
        if (label.includes('cell')) {
          for (const range of lockRanges)
            for (let r = range.startRow; r <= range.endRow; r++)
              for (let c = range.startColumn; c <= range.endColumn; c++)
                setLocked({ scope: 'cell', rowIndex: r, columnIndex: c }, !locked);
        } else for (const target of targets) setLocked(target, !locked);
      });
    }
    if (rowCount > 0 && !engine.getCellPermission(row, col).writable) item('Cell is read-only', false, () => {});
    const rowsFit = rowCount > 0 && rowAxis.position(row + 1) < scroller.clientHeight;
    const columnsFit = columnAxis.position(col + 1) < scroller.clientWidth;
    item('Freeze rows through this row', rowsFit && engine.frozenRows !== row + 1, () =>
      setFrozen(row + 1, engine.frozenColumns),
    );
    item('Freeze columns through this column', columnsFit && engine.frozenColumns !== col + 1, () =>
      setFrozen(engine.frozenRows, col + 1),
    );
    item(
      'Freeze through this cell',
      rowsFit && columnsFit && (engine.frozenRows !== row + 1 || engine.frozenColumns !== col + 1),
      () => setFrozen(row + 1, col + 1),
    );
    item('Unfreeze rows', engine.frozenRows > 0, () => setFrozen(0, engine.frozenColumns));
    item('Unfreeze columns', engine.frozenColumns > 0, () => setFrozen(engine.frozenRows, 0));
    item('Unfreeze table', engine.frozenRows > 0 || engine.frozenColumns > 0, () => setFrozen(0, 0));
    item('Auto-fit column', true, () => autoFitColumn(col));
    item('Auto-fit row', rowCount > 0, () => autoFitRow(row));
    item('Resize column…', true, () =>
      openSizeDialog(t('Column width'), columnAxis.size(col), (size) => resizeAxis(columnAxis, col, size)),
    );
    item('Resize row…', rowCount > 0, () =>
      openSizeDialog(t('Row height'), rowAxis.size(row), (size) => resizeAxis(rowAxis, row, size)),
    );
    const mode = doc.createElement('button');
    mode.type = 'button';
    mode.setAttribute('role', 'menuitemcheckbox');
    mode.textContent = t('Suggested actions');
    mode.setAttribute('aria-checked', String(suggestionsEnabled));
    mode.setAttribute('aria-label', t('Suggested actions'));
    mode.textContent = t('Suggested actions: ') + (suggestionsEnabled ? t('On') : t('Off'));
    mode.addEventListener('click', () => {
      mode.focus();
      suggestionsEnabled = !suggestionsEnabled;
      showAll = !suggestionsEnabled;
      mode.setAttribute('aria-checked', String(suggestionsEnabled));
      mode.textContent = t('Suggested actions: ') + (suggestionsEnabled ? t('On') : t('Off'));
      all.hidden = showAll;
      filterActions();
    });
    const all = doc.createElement('button');
    all.type = 'button';
    all.textContent = t('Show all actions');
    all.setAttribute('role', 'menuitem');
    all.addEventListener('click', () => {
      showAll = true;
      filterActions();
      all.hidden = true;
    });
    filter.before(mode);
    popup.append(all, empty);
    filterActions();
    all.hidden = showAll;

    popup.addEventListener('keydown', (event) => {
      const buttons = Array.from(popup.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([hidden])'));
      const index = buttons.indexOf(doc.activeElement as HTMLButtonElement);
      if (event.key === 'Escape' && filter.value) {
        event.preventDefault();
        filter.value = '';
        filterActions();
        filter.hidden = true;
        buttons[0]?.focus();
      } else if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        closeMenu(true);
      } else if (
        event.target !== filter &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.key.length === 1 || event.key === 'Backspace')
      ) {
        event.preventDefault();
        filter.hidden = false;
        filter.value = event.key === 'Backspace' ? filter.value.slice(0, -1) : filter.value + event.key;
        filterActions();
        filter.focus();
      } else if (event.target === filter && event.key === 'Enter') {
        event.preventDefault();
        popup.querySelector<HTMLButtonElement>('button[data-action]:not(:disabled):not([hidden])')?.click();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
      event.stopPropagation();
    });
    root.append(popup);
    popup.showPopover();
    popup.style.left = `${Math.max(8, Math.min(x, win.innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(y, win.innerHeight - popup.offsetHeight - 8))}px`;
    enterSurface(popup);
    popup.querySelector<HTMLButtonElement>('button[data-action]:not(:disabled):not([hidden])')?.focus();
  }

  function headerColumn(event: MouseEvent): number | null {
    const bounds = root.getBoundingClientRect();
    const x = event.clientX - bounds.left - indexWidth;
    const y = event.clientY - bounds.top;
    if (x < 0 || x >= scroller.clientWidth || y < 0 || y >= headerHeight || !columns.length) return null;
    const col = columnAxis.indexAt(x + (x < viewport().frozenWidth ? 0 : scroller.scrollLeft));
    return col < columns.length && y >= leafHeaders[col]!.level * headerRowHeight ? col : null;
  }

  function onHeaderContextMenu(event: MouseEvent): void {
    if (event.target instanceof win.Node && overlay.menu?.contains(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const bounds = root.getBoundingClientRect();
    if (
      indexWidth &&
      event.clientX >= bounds.left &&
      event.clientX < bounds.left + indexWidth &&
      event.clientY >= bounds.top + headerHeight
    ) {
      event.preventDefault();
      event.stopPropagation();
      const row = indexRow(event);
      if (row !== null && finishEdit(true)) {
        if (
          !getSelectionRanges().some(
            (range) =>
              range.startColumn === 0 &&
              range.endColumn === columns.length - 1 &&
              row >= range.startRow &&
              row <= range.endRow,
          )
        )
          selectRow(row);
        openMenu(row, 0, event.clientX, event.clientY);
      }
      return;
    }
    if (event.clientY < bounds.top || event.clientY >= bounds.top + headerHeight) return;
    event.preventDefault();
    event.stopPropagation();
    const col = headerColumn(event);
    if (col === null || !finishEdit(true)) return;
    if (
      !getSelectionRanges().some(
        (range) =>
          range.startRow === 0 && range.endRow === rowCount - 1 && col >= range.startColumn && col <= range.endColumn,
      )
    )
      selectColumn(col);
    const selection = engine.getSelection();
    if (!rowCount || selection) openMenu(selection?.rowIndex ?? 0, col, event.clientX, event.clientY, true);
  }

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
  let createdColumn = 0;
  function openColumnDialog(beforeIndex: number): void {
    if (!options.allowColumnChanges || overlay.activeDialog?.open) return;
    const dialog = doc.createElement('dialog');
    dialog.dataset.gridDialog = '';
    dialog.setAttribute('aria-label', t('Insert column'));
    overlay.activeDialog = dialog;
    const heading = doc.createElement('p');
    heading.textContent = t('Insert column');
    const key = doc.createElement('input'),
      title = doc.createElement('input'),
      type = doc.createElement('select'),
      initial = doc.createElement('input');
    do {
      key.value = 'column_' + ++createdColumn;
    } while (columns.some((column) => column.key === key.value));
    key.required = title.required = true;
    for (const item of creationTypes) {
      const option = doc.createElement('option');
      option.value = item.key;
      option.textContent = item.label;
      type.append(option);
    }
    const field = (name: string, input: HTMLElement) => {
      const label = doc.createElement('label');
      label.textContent = name;
      input.setAttribute('aria-label', name);
      label.append(input);
      return label;
    };
    const status = doc.createElement('p');
    status.setAttribute('role', 'alert');
    const apply = doc.createElement('button');
    apply.type = 'button';
    apply.textContent = t('Insert column');
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.textContent = t('Cancel');
    cancel.onclick = () => dialog.close();
    apply.onclick = () => {
      if (!key.reportValidity() || !title.reportValidity()) return;
      try {
        if (!key.value.trim() || !title.value.trim()) throw new Error('Key and title are required.');
        const definition = creationTypes
          .find((item) => item.key === type.value)!
          .create(Object.freeze({ key: key.value.trim(), title: title.value.trim(), defaultText: initial.value }));
        if (definition.column.key !== key.value.trim()) throw new Error('Column factory must retain the supplied key.');
        const editorConfig = definition.editor ? validateColumnEditor(definition.column, definition.editor) : undefined;
        engine.insertColumns(beforeIndex, [definition.column]);
        if (editorConfig) columnEditors.set(definition.column.key, editorConfig);
        dialog.close();
        render();
      } catch (error) {
        status.textContent = error instanceof Error ? t(error.message) : t('Unable to insert column.');
      }
    };
    const actions = doc.createElement('div');
    actions.dataset.dialogActions = '';
    actions.append(apply, cancel);
    dialog.append(
      heading,
      field(t('Column key'), key),
      field(t('Column title'), title),
      field(t('Column type'), type),
      field(t('Default value'), initial),
      status,
      actions,
    );
    root.append(dialog);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (overlay.activeDialog === dialog) overlay.activeDialog = null;
      if (!destroyed) scroller.focus({ preventScroll: true });
    });
    dialog.showModal();
    title.focus();
  }

  function openViewDialog(col: number, sort?: 'asc' | 'desc' | 'clear'): void {
    if ((!managesView && !options.onViewChange) || overlay.activeDialog?.open) return;
    const dialog = doc.createElement('dialog');
    overlay.activeDialog = dialog;
    dialog.setAttribute('aria-label', sort ? t('Change row view') : t('Filter column'));
    dialog.dataset.gridDialog = '';
    const title = doc.createElement('p');
    title.textContent =
      sort === 'clear'
        ? t('Show all rows in source order')
        : `${sort ? t('Sort {0}', sort === 'asc' ? t('ascending') : t('descending')) : t('Filter')}: ${columns[col]!.title}`;
    const note = doc.createElement('p');
    note.textContent = managesView
      ? t(
          'Selection, undo history, colors, locks and sizes follow their records. Edits update this view automatically. Clear the view before changing rows or columns.',
        )
      : t('The host applies this row view. State retention depends on its handler.');
    const input = doc.createElement('input');
    input.type = 'search';
    input.setAttribute('aria-label', t('Contains text'));
    input.placeholder = t('Contains text (empty removes this filter)');
    input.style.width = '100%';
    input.value = currentView?.filters?.find((filter) => filter.columnKey === columns[col]!.key)?.query ?? '';
    const condition = doc.createElement('select');
    condition.setAttribute('aria-label', t('Filter condition'));
    for (const [value, label] of [
      ['contains', t('Contains text')],
      ['equals', t('Equals text')],
      ['not-empty', t('Has a value')],
      ['empty', t('Is empty')],
    ]) {
      const option = doc.createElement('option');
      option.value = value!;
      option.textContent = label!;
      condition.append(option);
    }
    condition.value =
      currentView?.filters?.find((filter) => filter.columnKey === columns[col]!.key)?.operator ?? 'contains';
    const updateInput = () => {
      input.disabled = condition.value === 'empty' || condition.value === 'not-empty';
    };
    condition.addEventListener('change', updateInput);
    updateInput();
    const status = doc.createElement('p');
    status.setAttribute('role', 'alert');
    const apply = doc.createElement('button');
    apply.type = 'button';
    apply.textContent = t('Apply view');
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.textContent = t('Cancel');
    cancel.addEventListener('click', () => dialog.close());
    const commit = () => {
      const key = columns[col]!.key;
      const filters = (currentView?.filters ?? []).filter((filter) => filter.columnKey !== key);
      if (!sort && (input.value || condition.value === 'empty' || condition.value === 'not-empty')) {
        const operator = condition.value as 'contains' | 'equals' | 'not-empty' | 'empty';
        filters.push({ columnKey: key, query: input.value, operator });
      }
      const view: LocalViewOptions =
        sort === 'clear'
          ? {}
          : sort
            ? {
                ...(currentView?.filters ? { filters: currentView.filters } : {}),
                sort: { columnKey: key, direction: sort },
              }
            : { ...currentView, filters };
      try {
        if (managesView) engine.setView(view);
        currentView = view;
        options.onViewChange?.(view);
        if (dialog.isConnected) dialog.close();
      } catch (error) {
        status.textContent = error instanceof Error ? t(error.message) : t('Unable to change view.');
      }
    };
    apply.addEventListener('click', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        commit();
      }
    });
    dialog.append(title, note);
    if (!sort) dialog.append(condition, input);
    const actions = doc.createElement('div');
    actions.dataset.dialogActions = '';
    actions.append(apply, cancel);
    dialog.append(status, actions);
    root.append(dialog);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (overlay.activeDialog === dialog) overlay.activeDialog = null;
      if (!destroyed && !editor) scroller.focus({ preventScroll: true });
    });
    dialog.showModal();
    (sort ? apply : input).focus();
  }

  function onContextMenu(event: MouseEvent): void {
    if (event.target === editor) return;
    const cell = pointerCell(event);
    if (!cell) {
      if (
        columns.length &&
        ((!rowCount && options.onRowChange) || engine.getHiddenRows().length || engine.getHiddenColumns().length)
      ) {
        event.preventDefault();
        if (finishEdit(true)) openMenu(0, 0, event.clientX, event.clientY);
      }
      return;
    }
    event.preventDefault();
    if (!finishEdit(true)) return;
    openMenu(cell.row, cell.col, event.clientX, event.clientY);
  }

  function columnEdge(event: MouseEvent): number | null {
    const bounds = root.getBoundingClientRect();
    const x = event.clientX - bounds.left - indexWidth;
    const y = event.clientY - bounds.top;
    if (x < 0 || x >= scroller.clientWidth || y < 0 || y >= headerHeight || !columns.length) return null;
    const view = viewport();
    if (engine.frozenColumns > 0 && Math.abs(columnAxis.position(engine.frozenColumns) - x) <= 8 && x <= view.width)
      return engine.frozenColumns - 1;
    const offset = x + (x < view.frozenWidth ? 0 : view.scrollLeft);
    const col = columnAxis.indexAt(offset);
    if (col < columns.length && y < leafHeaders[col]!.level * headerRowHeight) return null;
    const first = x < view.frozenWidth ? 0 : engine.frozenColumns;
    const limit = x < view.frozenWidth ? engine.frozenColumns : columns.length;
    if (col < limit && col >= first && Math.abs(columnAxis.position(col + 1) - offset) <= 8) return col;
    if (col > first && Math.abs(columnAxis.position(col) - offset) <= 8) return col - 1;
    return null;
  }

  function rowEdge(event: MouseEvent): number | null {
    const bounds = scroller.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (
      x < -indexWidth ||
      x > (engine.frozenColumns ? Math.min(columnAxis.size(0), scroller.clientWidth) : 10) ||
      y < 0 ||
      y >= scroller.clientHeight ||
      !rowCount ||
      !columns.length
    )
      return null;
    const tolerance = x <= 10 ? 8 : 3;
    const view = viewport();
    if (engine.frozenRows > 0 && Math.abs(rowAxis.position(engine.frozenRows) - y) <= tolerance)
      return engine.frozenRows - 1;
    const offset = y + (y < view.frozenHeight ? 0 : view.scrollTop);
    const row = rowAxis.indexAt(offset);
    const first = y < view.frozenHeight ? 0 : engine.frozenRows;
    const limit = y < view.frozenHeight ? engine.frozenRows : rowCount;
    if (row < limit && row >= first && Math.abs(rowAxis.position(row + 1) - offset) <= tolerance) return row;
    if (row > first && Math.abs(rowAxis.position(row) - offset) <= tolerance) return row - 1;
    return null;
  }

  function showResizeGuide(): void {
    if (!resizing) return;
    const view = viewport();
    const position = resizing.edge + resizing.proposed - resizing.size;
    resizeGuide.dataset.axis = resizing.axis;
    resizeGuide.style.display = 'block';
    resizeGuide.style.left =
      resizing.axis === 'column' ? `${indexWidth + Math.max(0, Math.min(view.width - 2, position))}px` : '0px';
    resizeGuide.style.top =
      resizing.axis === 'row'
        ? `${Math.max(headerHeight, Math.min(headerHeight + view.height - 2, position))}px`
        : '0px';
    resizeGuide.style.width = resizing.axis === 'column' ? '2px' : `${indexWidth + view.width}px`;
    resizeGuide.style.height = resizing.axis === 'row' ? '2px' : `${headerHeight + view.height}px`;
  }

  function selectHeaderGroup(first: number, last: number, event: PointerEvent | KeyboardEvent): void {
    if (!rowCount || !finishEdit(true)) return;
    const anchor = event.shiftKey
      ? axisAnchor?.axis === 'column'
        ? axisAnchor.index
        : (engine.getSelection()?.columnIndex ?? first)
      : first;
    selectScope(
      axisRange('column', anchor, anchor > last ? first : last),
      event.shiftKey ? 'extend' : event.ctrlKey || event.metaKey ? 'add' : 'replace',
    );
    axisAnchor = { axis: 'column', index: anchor };
    scroller.focus({ preventScroll: true });
  }
  function onHeaderPointerDown(event: PointerEvent): void {
    if (event.target instanceof win.Element && event.target.closest('[data-grid-row-group]')) return;
    const moveTarget =
      event.target instanceof win.Element ? event.target.closest<HTMLElement>('[data-grid-reorder]') : null;
    if (
      moveTarget?.draggable &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      columnEdge(event) === null &&
      rowEdge(event) === null
    ) {
      if (event.pointerType === 'touch') startTouchReorder(event, moveTarget);
      return;
    }
    if (resizing) {
      event.preventDefault();
      return;
    }
    if (
      event.button !== 0 ||
      event.altKey ||
      (event.target !== root &&
        !(
          event.target instanceof win.Node &&
          (scroller.contains(event.target) ||
            indexGutter.contains(event.target) ||
            headerSurface.contains(event.target))
        ))
    )
      return;
    const bounds = root.getBoundingClientRect();
    if (indexWidth && event.clientX < bounds.left + indexWidth && event.clientY < bounds.top + headerHeight) {
      event.preventDefault();
      selectAll();
      scroller.focus({ preventScroll: true });
      return;
    }
    const column = columnEdge(event);
    const row = column === null ? rowEdge(event) : null;
    if (column === null && row === null) {
      const group =
        event.target instanceof win.Element ? event.target.closest<HTMLElement>('[data-grid-header-group]') : null;
      if (group) {
        event.preventDefault();
        selectHeaderGroup(Number(group.dataset.groupStart), Number(group.dataset.groupEnd), event);
        return;
      }
      const row = indexRow(event);
      if (row !== null && finishEdit(true)) {
        event.preventDefault();
        startAxisSelection('row', row, event);
        return;
      }
      const col = headerColumn(event);
      if (col !== null && rowCount && finishEdit(true)) {
        event.preventDefault();
        startAxisSelection('column', col, event);
      }
      return;
    }
    event.preventDefault();
    if (!finishEdit(true)) return;
    closeMenu();
    const axis = column === null ? 'row' : 'column';
    const index = column ?? row!;
    const size = axis === 'column' ? columnAxis.size(index) : rowAxis.size(index);
    const view = viewport();
    const edge =
      axis === 'column'
        ? columnAxis.position(index + 1) - (index < engine.frozenColumns ? 0 : view.scrollLeft)
        : headerHeight + rowAxis.position(index + 1) - (index < engine.frozenRows ? 0 : view.scrollTop);
    resizing = {
      pointerId: event.pointerId,
      axis,
      index,
      size,
      proposed: size,
      start: axis === 'column' ? event.clientX : event.clientY,
      edge,
    };
    scroller.focus({ preventScroll: true });
    root.setPointerCapture(event.pointerId);
    root.style.cursor = axis === 'column' ? 'col-resize' : 'row-resize';
    showResizeGuide();
  }

  function onHeaderPointerMove(event: PointerEvent): void {
    if (touchReorder) return;
    root.style.cursor = resizing
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
      !editor &&
      !overlay.menu &&
      options.allowOpenLinks !== false &&
      cellLinks(cell.row, cell.col).length
        ? `${cell.row}:${cell.col}`
        : '';
    if (key !== overlay.linkHoverKey) {
      cancelLinkPreviewHover();
      overlay.linkHoverKey = key;
      if (key && cell) {
        const row = cell.row,
          col = cell.col,
          x = event.clientX,
          y = event.clientY + 12;
        overlay.linkHoverTimer = win.setTimeout(() => {
          if (!destroyed && !editor && !overlay.menu) openLinks(row, col, x, y, false);
        }, 450);
      }
    }
    const config = cell ? columnEditors.get(columns[cell.col]!.key) : undefined;
    const next =
      cell && config && config.type !== 'checkbox' && !resizing && !editor && engine.canEdit(cell.row, cell.col)
        ? cell
        : null;
    if (next?.row !== hoveredChoice?.row || next?.col !== hoveredChoice?.col) {
      clearChoiceHover();
      hoveredChoice = next;
      if (next) invalidate([{ rowIndex: next.row, columnKey: columns[next.col]!.key }]);
    }
    const bounds = root.getBoundingClientRect();
    const headerColumn = columnAxis.indexAt(
      event.clientX -
        bounds.left -
        indexWidth +
        (event.clientX - bounds.left - indexWidth < viewport().frozenWidth ? 0 : scroller.scrollLeft),
    );
    root.title =
      root.style.cursor === 'row-resize'
        ? t('Drag the row boundary to resize height')
        : column !== null
          ? t('Drag the column boundary to resize width')
          : event.clientY - bounds.top < headerHeight &&
              event.clientX >= bounds.left + indexWidth &&
              headerColumn >= 0 &&
              headerColumn < columns.length
            ? stateLabels(null, headerColumn)
                .map((label) => t(label))
                .join('; ')
            : indexRow(event) !== null
              ? [t('Select row {0}', indexRow(event)! + 1), ...rowLabels(indexRow(event)!)].join('; ')
              : cell
                ? stateLabels(cell.row, cell.col)
                    .map((label) => t(label))
                    .join('; ')
                : '';
    if (cell && !resizing) {
      const message = validationMessage(engine.getValue(cell.row, columns[cell.col]!.key), cell.col);
      if (message) root.title = message;
    }
    if (!resizing && cell && event.altKey && options.allowOpenLinks !== false && cellLinks(cell.row, cell.col).length) {
      root.style.cursor = 'pointer';
      root.title = t('Alt+click to open links');
    }
    if (hoveredChoice && cell) {
      const rect = viewport().cellRect(cell.row, cell.col);
      if (event.clientX - scroller.getBoundingClientRect().left >= rect.x + rect.width - 24)
        root.style.cursor = 'pointer';
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
    resizeGuide.style.display = 'none';
    root.style.cursor = '';
    root.title = '';
    if (pointerId !== undefined && root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId);
  }

  function commitResize(event: PointerEvent): void {
    if (resizing?.pointerId !== event.pointerId) return;
    const draft = resizing;
    endResize();
    try {
      resizeAxis(draft.axis === 'column' ? columnAxis : rowAxis, draft.index, draft.proposed);
    } catch (error) {
      actionError.textContent = error instanceof Error ? t(error.message) : t('Unable to resize.');
      actionError.style.display = 'block';
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

  function invalidate(changes: readonly { rowIndex: number; columnKey: string }[]): void {
    const selection = engine.getSelection();
    for (const change of changes) {
      dirty.set(JSON.stringify([change.rowIndex, change.columnKey]), change);
      if (mediaColumn(change.columnKey)) fullDraw = true;
    }
    if (
      selection &&
      changes.some((change) => change.rowIndex === selection.rowIndex && change.columnKey === selection.columnKey)
    )
      syncAccessibleCell();
    schedule();
  }

  function updateCells(updates: readonly CellUpdate[]): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before updating cells.');
    engine.updateCells(updates);
  }

  function replay(redo: boolean): boolean {
    if (destroyed || editor) return false;
    return redo ? engine.redo() : engine.undo();
  }

  function finishEdit(commit: boolean): boolean {
    const selection = engine.getSelection();
    if (!editor || !selection) return true;
    if (commit) {
      try {
        if (!editor.checkValidity()) throw new Error(editor.validationMessage);
        engine.editCell(
          selection.rowIndex,
          selection.columnIndex,
          editor instanceof win.HTMLInputElement && editor.type === 'checkbox'
            ? String(editor.checked)
            : editor instanceof win.HTMLSelectElement && editor.multiple
              ? choiceValue(editor)
              : editor.value,
        );
      } catch (error) {
        editorError.dataset.severity = 'error';
        editor.setCustomValidity(error instanceof Error ? t(error.message) : t('Unable to save cell.'));
        editor.setAttribute('aria-invalid', 'true');
        editorError.textContent = error instanceof Error ? t(error.message) : t('Unable to save cell.');
        editorError.style.display = 'block';
        positionEditor();
        (choices?.querySelector<HTMLInputElement>('input') ?? richEditor ?? editor).focus({ preventScroll: true });
        return false;
      }
    }
    const input = editor;
    editor = null;
    richEditor?.remove();
    richEditor = null;
    if (choices) {
      disposeChoicePanel(choices);
      exitSurface(choices);
    }
    choices = null;
    disposeEditorIntegration();
    input.remove();
    editorAnchor = null;
    editorLabel.hidden = true;
    win.removeEventListener('beforeunload', guardEditNavigation);
    editorError.style.position = 'absolute';
    editorError.style.display = 'none';
    editorError.textContent = '';
    editorPane.style.width = editorPane.style.height = '0px';
    select(selection.rowIndex, selection.columnIndex, true);
    return true;
  }

  function beginEdit(): void {
    const selection = engine.getSelection();
    if (destroyed || editor || !selection || !engine.canEdit(selection.rowIndex, selection.columnIndex)) return;
    const column = columns[selection.columnIndex]!;
    const value = engine.getValue(selection.rowIndex, column.key);
    const preview = richText(
      value,
      column.key,
      engine.getFormat(selection.rowIndex, selection.columnIndex).contentFormat,
    );
    if (preview?.unavailable) {
      actionError.textContent = t('Rich text cannot be edited until it can be displayed.');
      actionError.style.display = 'block';
      return;
    }
    try {
      const custom = options.createEditor?.(Object.freeze({ ...selection, value }), doc) ?? null;
      if (
        custom &&
        (custom.ownerDocument !== doc || custom.parentNode || !['INPUT', 'SELECT', 'TEXTAREA'].includes(custom.tagName))
      ) {
        throw new Error('Cell editor must be a detached input, select or textarea from the grid document.');
      }
      if (!custom && mediaColumn(column.key)) {
        if (overlay.activeDialog?.open) return;
        const dialog = createMediaEditor(
          doc,
          value,
          avatarColumns.has(column.key),
          (next) => {
            if (
              destroyed ||
              engine.getRowId(selection.rowIndex) !== selection.rowId ||
              columns[selection.columnIndex]?.key !== column.key ||
              !Object.is(engine.getValue(selection.rowIndex, column.key), value)
            )
              throw new Error('This cell changed. Cancel and reopen the editor.');
            engine.editCell(selection.rowIndex, selection.columnIndex, JSON.stringify(next));
          },
          t,
        );
        overlay.activeDialog = dialog;
        root.append(dialog);
        dialog.addEventListener('close', () => {
          dialog.remove();
          if (overlay.activeDialog === dialog) overlay.activeDialog = null;
          if (!destroyed) scroller.focus({ preventScroll: true });
        });
        dialog.showModal();
        return;
      }
      const configured = columnEditors.get(column.key);
      if (!custom && (configured?.type === 'select' || configured?.type === 'multiselect')) {
        const select = doc.createElement('select');
        for (const value of configured.values) {
          const definition = typeof value === 'string' ? { value } : value;
          const option = doc.createElement('option');
          option.value = definition.value;
          option.textContent = definition.label ?? definition.value;
          option.disabled = definition.disabled ?? false;
          select.append(option);
        }
        select.dataset.gridChoiceEditor = '';
        select.multiple = configured.type === 'multiselect';
        select.size = select.multiple ? Math.min(8, configured.values.length) : 0;
        select.required =
          !select.multiple &&
          !configured.values.some((value) => (typeof value === 'string' ? value : value.value) === '');
        editor = select;
      } else if (!custom && configured?.type === 'checkbox') {
        if (typeof value !== 'boolean') throw new TypeError('Checkbox cells require boolean values.');
        const checkbox = doc.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = value;
        editor = checkbox;
      } else editor = custom ?? doc.createElement(options.multilineEditor ? 'textarea' : 'input');
      if (!custom) {
        if (editor instanceof win.HTMLSelectElement && editor.multiple) {
          const original = String(value ?? '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
          editor.dataset.choiceOriginalValues = JSON.stringify([...new Set(original)]);
          const selected = new Set(original);
          for (const option of Array.from(editor.options)) option.selected = selected.has(option.value);
        } else
          editor.value =
            value == null
              ? ''
              : mediaColumn(column.key) && Array.isArray(value)
                ? JSON.stringify(value)
                : String(value);
      }
    } catch (error) {
      actionError.textContent = error instanceof Error ? t(error.message) : t('Unable to create cell editor.');
      actionError.style.display = 'block';
      return;
    }
    actionError.style.display = 'none';
    editor.setAttribute(
      'aria-label',
      t('Edit row {0}, {1}', engine.getRowSourceIndex(selection.rowIndex) + 1, column.title),
    );
    editor.setAttribute('aria-errormessage', editorError.id);
    editor.style.cssText =
      'position:absolute;box-sizing:border-box;pointer-events:auto;outline:none;border:1px solid var(--acheron-selection-color);background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font);padding:0 8px';
    const cellFormat = engine.getFormat(selection.rowIndex, selection.columnIndex);
    if (cellFormat.background) editor.style.background = cellFormat.background;
    if (cellFormat.textColor) editor.style.color = cellFormat.textColor;
    if (cellFormat.fontWeight) editor.style.fontWeight = cellFormat.fontWeight;
    if (cellFormat.fontStyle) editor.style.fontStyle = cellFormat.fontStyle;
    if (editor instanceof win.HTMLTextAreaElement) editor.style.resize = 'none';
    if (editor instanceof win.HTMLInputElement && editor.type === 'checkbox') {
      editor.style.maxWidth = editor.style.maxHeight = '16px';
      editor.style.margin = '8px';
      editor.style.padding = '0';
      editor.style.accentColor = 'var(--acheron-selection-color)';
      // WebKit may blur a focused checkbox on mouse down before its click toggles the draft.
      editor.addEventListener('mousedown', (event) => event.preventDefault());
    }
    const clearValidation = () => {
      editor?.setCustomValidity('');
      editor?.removeAttribute('aria-invalid');
      editorError.style.display = 'none';
      editorError.dataset.severity = column.invalidInput === 'allow' ? 'warning' : 'error';
      if (editor) {
        try {
          const text =
            editor instanceof win.HTMLInputElement && editor.type === 'checkbox'
              ? String(editor.checked)
              : editor instanceof win.HTMLSelectElement && editor.multiple
                ? choiceValue(editor)
                : editor.value;
          const message = column.validate?.(column.parse ? column.parse(text) : text);
          if (message) {
            editor.setAttribute('aria-invalid', 'true');
            editorError.textContent =
              message +
              (column.invalidInput === 'allow' ? ' You can save this value.' : ' Correct this before saving.');
            editorError.style.display = 'block';
          }
        } catch (error) {
          editorError.dataset.severity = 'error';
          editor.setAttribute('aria-invalid', 'true');
          editorError.textContent = error instanceof Error ? t(error.message) : t('Invalid value.');
          editorError.style.display = 'block';
        }
      }
      positionEditor();
    };
    editor.addEventListener('input', clearValidation);
    editor.addEventListener('change', clearValidation);
    clearValidation();
    editor.addEventListener('keydown', (event) => {
      if (!(event instanceof win.KeyboardEvent)) return;
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if (
        editor instanceof win.HTMLTextAreaElement &&
        event.key === 'Enter' &&
        (event.altKey || event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        editor.setRangeText('\n', editor.selectionStart, editor.selectionEnd, 'end');
        editor.dispatchEvent(new win.Event('input', { bubbles: true }));
        return;
      }
      if (editor instanceof win.HTMLTextAreaElement && event.key === 'Tab') {
        event.preventDefault();
        const current = engine.getSelection()!;
        if (finishEdit(true)) {
          const position = Math.max(
            0,
            Math.min(
              rowCount * columns.length - 1,
              current.rowIndex * columns.length + current.columnIndex + (event.shiftKey ? -1 : 1),
            ),
          );
          select(Math.floor(position / columns.length), position % columns.length);
          scroller.focus({ preventScroll: true });
        }
        return;
      }
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        if (finishEdit(event.key === 'Enter')) scroller.focus({ preventScroll: true });
      } else if (event.key === 'Tab' && !finishEdit(true)) event.preventDefault();
    });
    editor.addEventListener('blur', () => {
      if (
        !options.editorOptions?.pinned &&
        !choices &&
        !(
          editor instanceof win.HTMLSelectElement &&
          editor.dataset.gridChoiceEditor !== undefined &&
          choiceOptionsFor(column.key)
        )
      )
        finishEdit(true);
    });
    editorPane.append(editor);
    const contentFormat = cellFormat.contentFormat ?? richTextColumns.get(column.key);
    if (contentFormat && contentFormat !== 'plain' && !options.createEditor && !columnEditors.has(column.key)) {
      const backing = editor;
      const surface = doc.createElement('div');
      richEditor = surface;
      surface.contentEditable = 'true';
      surface.setAttribute('role', 'textbox');
      surface.setAttribute('aria-multiline', 'true');
      surface.setAttribute('aria-label', backing.getAttribute('aria-label')!);
      surface.setAttribute('aria-errormessage', editorError.id);
      surface.style.cssText =
        backing.style.cssText +
        ';white-space:pre-wrap;overflow:auto;overflow-wrap:anywhere;padding:4px 8px;line-height:normal';
      surface.innerHTML = richTextHtml(
        richText(value, column.key, contentFormat) ?? {
          text: String(value ?? ''),
          runs: [{ text: String(value ?? '') }],
        },
        doc,
      );
      backing.setAttribute('aria-hidden', 'true');
      backing.tabIndex = -1;
      backing.style.visibility = 'hidden';
      backing.style.pointerEvents = 'none';
      const sync = () => {
        backing.value = richTextSource(readHtml(surface.innerHTML, doc, true), contentFormat, doc);
        backing.dispatchEvent(new win.Event('input', { bubbles: true }));
      };
      const insert = (rich: RichText) => {
        const selection = win.getSelection();
        if (!selection?.rangeCount || !surface.contains(selection.anchorNode)) return;
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const template = doc.createElement('template');
        template.innerHTML = richTextHtml(rich, doc);
        const last = template.content.lastChild;
        range.insertNode(template.content);
        if (last) {
          range.setStartAfter(last);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        sync();
      };
      surface.addEventListener('input', sync);
      surface.addEventListener('paste', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const html = event.clipboardData?.getData('text/html');
        const text = event.clipboardData?.getData('text/plain') ?? '';
        const rich = html ? readHtml(html, doc) : { text, runs: [{ text }] };
        insert(
          engine.getCellPermission(selection.rowIndex, selection.columnIndex).formatting
            ? rich
            : { text: rich.text, runs: [{ text: rich.text }] },
        );
      });
      surface.addEventListener('drop', (event) => {
        event.preventDefault();
      });
      surface.addEventListener('click', (event) => {
        if ((event.target as Element).closest('a')) event.preventDefault();
      });
      surface.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.isComposing || event.keyCode === 229) return;
        if ((event.ctrlKey || event.metaKey) && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
          if (
            !engine.getCellPermission(selection.rowIndex, selection.columnIndex).formatting ||
            (contentFormat === 'markdown' && event.key.toLowerCase() === 'u')
          )
            event.preventDefault();
          return;
        }
        if (event.key === 'Enter' && (event.altKey || event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          insert({ text: '\n', runs: [{ text: '\n' }] });
          return;
        }
        if (['Enter', 'Escape', 'Tab'].includes(event.key)) {
          event.preventDefault();
          backing.dispatchEvent(new win.KeyboardEvent('keydown', { key: event.key, shiftKey: event.shiftKey }));
        }
      });
      surface.addEventListener('blur', () => {
        if (!options.editorOptions?.pinned) finishEdit(true);
      });
      editorPane.append(surface);
    }
    if (options.editorOptions?.guardNavigation !== false) win.addEventListener('beforeunload', guardEditNavigation);
    editorLabel.textContent = t(
      '{0} · Row {1} · {2}',
      column.title,
      engine.getRowSourceIndex(selection.rowIndex) + 1,
      String(engine.getRowId(selection.rowIndex)),
    );
    positionEditor();
    (richEditor ?? editor).focus({ preventScroll: true });
    if (richEditor) {
      const range = doc.createRange();
      range.selectNodeContents(richEditor);
      const selection = win.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else if (editor.tagName !== 'SELECT' && 'select' in editor) editor.select();
    const choiceOptions = choiceOptionsFor(column.key);
    if (editor instanceof win.HTMLSelectElement && editor.dataset.gridChoiceEditor !== undefined && choiceOptions) {
      choices = choicePanel(
        editor,
        root,
        choiceOptions,
        (commit) => {
          const done = finishEdit(commit);
          if (done) scroller.focus({ preventScroll: true });
          return done;
        },
        column.key,
        t,
      );
      enterSurface(choices);
      editor.style.opacity = '0';
      editor.style.pointerEvents = 'none';
      editor.tabIndex = -1;
      editor.setAttribute('aria-hidden', 'true');
    }
    try {
      const cleanup = options.onEditorMount?.(Object.freeze({ ...selection, value }), editor);
      editorCleanup = typeof cleanup === 'function' ? cleanup : undefined;
    } catch (error) {
      finishEdit(false);
      actionError.textContent = error instanceof Error ? t(error.message) : t('Unable to mount custom editor.');
      actionError.style.display = 'block';
    }
  }

  const getSelection = engine.getSelection;
  const getSelectionRange = engine.getSelectionRange;
  const getSelectionRanges = engine.getSelectionRanges;

  function select(rowIndex: number, columnIndex: number, extend = false, reveal = true, add = false): void {
    if (destroyed || rowCount === 0 || columns.length === 0) return;
    axisAnchor = null;
    const previous = engine.getSelection();
    const changed = previous?.rowIndex !== rowIndex || previous?.columnIndex !== columnIndex;
    const previousRange = JSON.stringify(getSelectionRange());
    const previousRanges = JSON.stringify(getSelectionRanges());
    if (!(add ? engine.addSelection(rowIndex, columnIndex) : engine.select(rowIndex, columnIndex, extend))) return;
    const selection = engine.getSelection()!;
    if (add) addNextSelection = false;
    announceSelection();
    const rangeChanged = previousRange !== JSON.stringify(getSelectionRange());
    if (reveal) {
      const view = viewport();
      const left = columnAxis.position(columnIndex);
      const top = rowAxis.position(rowIndex);
      if (columnIndex >= engine.frozenColumns && view.width > view.frozenWidth) {
        if (left < view.scrollLeft + view.frozenWidth || columnAxis.size(columnIndex) > view.width - view.frozenWidth)
          scroller.scrollLeft = left - view.frozenWidth;
        else if (left + columnAxis.size(columnIndex) > view.scrollLeft + view.width)
          scroller.scrollLeft = left + columnAxis.size(columnIndex) - view.width;
      }
      if (rowIndex >= engine.frozenRows && view.height > view.frozenHeight) {
        if (top < view.scrollTop + view.frozenHeight || rowAxis.size(rowIndex) > view.height - view.frozenHeight)
          scroller.scrollTop = top - view.frozenHeight;
        else if (top + rowAxis.size(rowIndex) > view.scrollTop + view.height)
          scroller.scrollTop = top + rowAxis.size(rowIndex) - view.height;
      }
    }
    if (changed) options.onSelectionChange?.(getSelection());
    if (rangeChanged) options.onSelectionRangeChange?.(getSelectionRange());
    if (previousRanges !== JSON.stringify(getSelectionRanges()))
      options.onSelectionRangesChange?.(getSelectionRanges());
  }

  function selectScope(range: SelectionRange, mode: 'replace' | 'add' | 'extend' = 'replace'): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (!finishEdit(true)) return;
    const previous = engine.getSelection();
    if (!engine.selectRange(range, mode)) return;
    addNextSelection = false;
    announceSelection();
    const selection = engine.getSelection();
    if (previous?.rowIndex !== selection?.rowIndex || previous?.columnIndex !== selection?.columnIndex)
      options.onSelectionChange?.(selection);
    options.onSelectionRangeChange?.(getSelectionRange());
    options.onSelectionRangesChange?.(getSelectionRanges());
  }
  function selectColumn(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= columns.length)
      throw new RangeError('Invalid column index.');
    axisAnchor = { axis: 'column', index };
    if (rowCount) selectScope({ startRow: 0, endRow: rowCount - 1, startColumn: index, endColumn: index });
  }
  function selectRow(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= rowCount) throw new RangeError('Invalid row index.');
    axisAnchor = { axis: 'row', index };
    if (columns.length) selectScope({ startRow: index, endRow: index, startColumn: 0, endColumn: columns.length - 1 });
  }

  function selectAll(): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    axisAnchor = null;
    if (rowCount && columns.length)
      selectScope({ startRow: 0, endRow: rowCount - 1, startColumn: 0, endColumn: columns.length - 1 });
  }
  function axisRange(axis: 'row' | 'column', anchor: number, end: number): SelectionRange {
    return axis === 'row'
      ? {
          startRow: Math.min(anchor, end),
          endRow: Math.max(anchor, end),
          startColumn: 0,
          endColumn: columns.length - 1,
        }
      : { startRow: 0, endRow: rowCount - 1, startColumn: Math.min(anchor, end), endColumn: Math.max(anchor, end) };
  }
  function startAxisSelection(axis: 'row' | 'column', index: number, event: PointerEvent | KeyboardEvent): void {
    if (!rowCount || !columns.length) return;
    const active = engine.getSelection();
    const anchor = event.shiftKey
      ? axisAnchor?.axis === axis
        ? axisAnchor.index
        : axis === 'row'
          ? (active?.rowIndex ?? index)
          : (active?.columnIndex ?? index)
      : index;
    const range = axisRange(axis, anchor, index);
    if (
      !engine.getCellPermission(range.startRow, range.startColumn).selectable ||
      !engine.getCellPermission(range.endRow, range.endColumn).selectable
    )
      return;
    try {
      selectScope(
        range,
        event.shiftKey ? 'extend' : event.ctrlKey || event.metaKey || addNextSelection ? 'add' : 'replace',
      );
    } catch (error) {
      actionError.textContent = error instanceof Error ? t(error.message) : t('Unable to add selection.');
      actionError.style.display = 'block';
      return;
    }
    axisAnchor = { axis, index: anchor };
    scroller.focus({ preventScroll: true });
    if (event instanceof win.PointerEvent) {
      axisDrag = axisAnchor;
      dragPointer = event.pointerId;
      dragPosition = event;
      root.setPointerCapture(event.pointerId);
    }
  }

  function pointerCell(
    event: Pick<MouseEvent, 'clientX' | 'clientY'>,
    clamp = false,
  ): { row: number; col: number } | null {
    if (!rowCount || !columns.length) return null;
    const bounds = scroller.getBoundingClientRect();
    let x = event.clientX - bounds.left;
    let y = event.clientY - bounds.top;
    if (clamp) {
      x = Math.max(0, Math.min(scroller.clientWidth - 1, x));
      y = Math.max(0, Math.min(scroller.clientHeight - 1, y));
    }
    if (x < 0 || y < 0 || x >= scroller.clientWidth || y >= scroller.clientHeight) return null;
    const hit = viewport().hitTest(x, y);
    if (hit || !clamp) return hit;
    const view = viewport();
    const row = Math.min(rowCount - 1, rowAxis.indexAt(y + (y < view.frozenHeight ? 0 : view.scrollTop)));
    const col = Math.min(columns.length - 1, columnAxis.indexAt(x + (x < view.frozenWidth ? 0 : view.scrollLeft)));
    return { row, col };
  }

  function onLinkClick(event: MouseEvent): void {
    if (!event.altKey || event.target === editor) return;
    const cell = pointerCell(event);
    if (cell && cellLinks(cell.row, cell.col).length && finishEdit(true)) {
      event.preventDefault();
      select(cell.row, cell.col, false, false);
      openLinks(cell.row, cell.col, event.clientX, event.clientY);
    }
  }
  function onPointerDown(event: PointerEvent): void {
    if (event.defaultPrevented || event.target === editor || event.button !== 0) return;
    if (event.altKey) return;
    touchSelection = event.pointerType === 'touch';
    const cell = pointerCell(event);
    if (!cell) return;
    event.preventDefault();
    if (!finishEdit(true)) return;
    if (!engine.getCellPermission(cell.row, cell.col).selectable) return;
    scroller.focus({ preventScroll: true });
    if (event.clientX - scroller.getBoundingClientRect().left < 10) {
      selectRow(cell.row);
      return;
    }
    try {
      select(
        cell.row,
        cell.col,
        event.shiftKey,
        true,
        !event.shiftKey && (event.ctrlKey || event.metaKey || addNextSelection),
      );
    } catch (error) {
      actionError.textContent = error instanceof Error ? t(error.message) : t('Unable to add selection.');
      actionError.style.display = 'block';
      return;
    }
    const choice = columnEditors.get(columns[cell.col]!.key);
    if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      choice &&
      choice.type !== 'checkbox' &&
      engine.canEdit(cell.row, cell.col)
    ) {
      const rect = viewport().cellRect(cell.row, cell.col);
      if (event.clientX - scroller.getBoundingClientRect().left >= rect.x + rect.width - 24) {
        clearChoiceHover();
        beginEdit();
        return;
      }
    }
    if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      columnEditors.get(columns[cell.col]!.key)?.type === 'checkbox'
    ) {
      const rect = viewport().cellRect(cell.row, cell.col);
      const bounds = scroller.getBoundingClientRect();
      const x = event.clientX - bounds.left - rect.x;
      const y = event.clientY - bounds.top - rect.y;
      if (x >= 8 && x <= 28 && Math.abs(y - rect.height / 2) <= 10 && engine.canEdit(cell.row, cell.col)) {
        beginEdit();
        if (editor instanceof win.HTMLInputElement && editor.type === 'checkbox') {
          editor.checked = !editor.checked;
          if (finishEdit(true)) scroller.focus({ preventScroll: true });
        }
        return;
      }
    }
    if (event.pointerType !== 'touch') {
      dragPointer = event.pointerId;
      scroller.setPointerCapture(event.pointerId);
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
    if (dragPointer === null || !dragPosition || destroyed) return;
    const bounds = scroller.getBoundingClientRect();
    const view = viewport();
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
    const previousLeft = scroller.scrollLeft;
    const previousTop = scroller.scrollTop;
    scroller.scrollLeft += dx;
    scroller.scrollTop += dy;
    if (scroller.scrollLeft !== previousLeft || scroller.scrollTop !== previousTop) {
      extendDrag();
      dragFrame = win.requestAnimationFrame(dragScroll);
    }
  }
  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== dragPointer) return;
    dragPosition = event;
    extendDrag();
    if (dragFrame === undefined) dragFrame = win.requestAnimationFrame(dragScroll);
  }
  function onPointerEnd(): void {
    if (touchReorder) clearReorder();
    const pointer = dragPointer;
    dragPointer = null;
    axisDrag = null;
    handleAnchor = null;
    dragPosition = null;
    if (dragFrame !== undefined) win.cancelAnimationFrame(dragFrame);
    dragFrame = undefined;
    if (pointer !== null)
      for (const target of [root, scroller])
        if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer);
  }

  function onKeyDown(event: KeyboardEvent): void {
    const selection = engine.getSelection();
    if (
      (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) &&
      !selection &&
      rowCount &&
      columns.length &&
      (engine.getHiddenRows().length || engine.getHiddenColumns().length)
    ) {
      event.preventDefault();
      const bounds = scroller.getBoundingClientRect();
      openMenu(0, 0, bounds.left + 8, bounds.top + 8);
      return;
    }
    if ((event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) && selection) {
      event.preventDefault();
      const bounds = scroller.getBoundingClientRect();
      const rect = viewport().cellRect(selection.rowIndex, selection.columnIndex);
      openMenu(
        selection.rowIndex,
        selection.columnIndex,
        bounds.left + Math.max(rect.clip.x, rect.x),
        bounds.top + Math.min(rect.clip.y + rect.clip.height, rect.y + rect.height),
      );
      return;
    }
    if (event.altKey && event.key === 'Enter' && selection) {
      event.preventDefault();
      if (openMedia(selection.rowIndex, selection.columnIndex)) return;
      const rect = viewport().cellRect(selection.rowIndex, selection.columnIndex);
      const bounds = scroller.getBoundingClientRect();
      openLinks(selection.rowIndex, selection.columnIndex, bounds.left + rect.x, bounds.top + rect.y + rect.height);
      return;
    }
    if (event.isComposing || event.altKey) return;
    const control = event.ctrlKey || event.metaKey;
    if (control && selection && ['b', 'i'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      const key = event.key.toLowerCase() === 'b' ? 'fontWeight' : 'fontStyle';
      const current = engine.getFormat(selection.rowIndex, selection.columnIndex);
      const value = current[key] && current[key] !== 'normal' ? 'normal' : key === 'fontWeight' ? 'bold' : 'italic';
      try {
        format(
          getSelectionRanges().map((range) => ({ scope: 'range', range })),
          { [key]: value },
        );
      } catch (error) {
        actionError.textContent = error instanceof Error ? t(error.message) : t('Unable to format selection.');
        actionError.style.display = 'block';
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
      announceSelection();
      return;
    }
    if (control && (event.key.toLowerCase() === 'z' || (event.key.toLowerCase() === 'y' && !event.shiftKey))) {
      event.preventDefault();
      try {
        replay(event.shiftKey || event.key.toLowerCase() === 'y');
      } catch (error) {
        win.alert(error instanceof Error ? t(error.message) : t('Unable to replay history.'));
      }
      return;
    }
    if (event.shiftKey && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
      return;
    if (control && event.key !== 'Home' && event.key !== 'End') return;
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      beginEdit();
      if (event.key === 'Enter' && editor instanceof win.HTMLInputElement && editor.type === 'checkbox') {
        editor.checked = !editor.checked;
        if (finishEdit(true)) scroller.focus({ preventScroll: true });
      }
      return;
    }
    if (event.key === 'Escape') {
      cancelCut();
      onPointerEnd();
      axisAnchor = null;
      addNextSelection = false;
      if (selection) {
        event.preventDefault();
        engine.clearSelection();
        scroller.setAttribute('aria-label', viewportLabel);
        options.onSelectionChange?.(null);
        options.onSelectionRangeChange?.(null);
        options.onSelectionRangesChange?.([]);
      }
      announceSelection();
      return;
    }
    if (
      !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) ||
      !rowCount ||
      !columns.length
    )
      return;
    event.preventDefault();
    let row = selection?.rowIndex ?? 0;
    let col = selection?.columnIndex ?? 0;
    if (selection) {
      if (event.key === 'ArrowUp') row--;
      if (event.key === 'ArrowDown') row = (engine.getMerge(row, col)?.endRow ?? row) + 1;
      if (event.key === 'ArrowLeft') col--;
      if (event.key === 'ArrowRight') col = (engine.getMerge(row, col)?.endColumn ?? col) + 1;
      if (event.key === 'Home') {
        col = 0;
        if (control) row = 0;
      }
      if (event.key === 'End') {
        col = columns.length - 1;
        if (control) row = rowCount - 1;
      }
    }
    if (!selection && event.key === 'End') {
      col = columns.length - 1;
      if (control) row = rowCount - 1;
    }
    row = Math.max(0, Math.min(rowCount - 1, row));
    col = Math.max(0, Math.min(columns.length - 1, col));
    if (rowAxis.size(row) === 0)
      row = rowAxis.indexAt(rowAxis.position(row) + (event.key === 'ArrowUp' || event.key === 'End' ? -0.001 : 0));
    if (columnAxis.size(col) === 0)
      col = columnAxis.indexAt(
        columnAxis.position(col) + (event.key === 'ArrowLeft' || event.key === 'End' ? -0.001 : 0),
      );
    if (row >= rowCount || col >= columns.length || rowAxis.size(row) === 0 || columnAxis.size(col) === 0) return;
    try {
      select(
        Math.max(0, Math.min(rowCount - 1, row)),
        Math.max(0, Math.min(columns.length - 1, col)),
        event.shiftKey,
        true,
        addNextSelection && !event.shiftKey,
      );
    } catch (error) {
      actionError.textContent = error instanceof Error ? t(error.message) : t('Unable to add selection.');
      actionError.style.display = 'block';
    }
  }

  function stateLabels(row: number | null, col: number): string[] {
    const labels: string[] = [];
    if (engine.isLocked({ scope: 'table' })) labels.push('Table locked');
    if (engine.isLocked({ scope: 'column', columnIndex: col })) labels.push('Column locked');
    if (col < engine.frozenColumns) labels.push('Column frozen');
    if (row === null) {
      const sort = currentView?.sorts?.find((item) => item.columnKey === columns[col]!.key) ?? currentView?.sort;
      if (sort?.columnKey === columns[col]!.key)
        labels.push(t('Sorted {0}', t(sort.direction === 'asc' ? 'ascending' : 'descending')));
      const filter = currentView?.filters?.find((filter) => filter.columnKey === columns[col]!.key);
      if (filter)
        labels.push(
          t(
            'Filtered: {0} {1}',
            t(
              { contains: 'Contains text', equals: 'Equals text', 'not-empty': 'Has a value', empty: 'Is empty' }[
                filter.operator ?? 'contains'
              ],
            ),
            filter.query,
          ).trim(),
        );
      const policy = columns[col]!.permissions;
      if (
        [indicatorPolicy, policy].some(
          (scope) => scope?.writable === false || scope?.selectable === false || scope?.editable === false,
        )
      )
        labels.push('Column disabled by permissions');
    } else {
      if (rowValueLocked(row)) labels.push('Row locked');
      if (engine.isLocked({ scope: 'cell', rowIndex: row, columnIndex: col })) labels.push('Cell locked');
      if (row < engine.frozenRows) labels.push('Row frozen');
      const permission = engine.getCellPermission(row, col);
      if (
        !permission.selectable ||
        (!permission.writable && !labels.some((label) => label.endsWith('locked'))) ||
        (columns[col]!.editable && !permission.editable && permission.writable)
      )
        labels.push('Cell disabled by permissions');
    }
    return labels;
  }

  function cellLinks(row: number, col: number) {
    return linksForValue(
      engine.getValue(row, columns[col]!.key),
      columns[col]!.key,
      engine.getFormat(row, col).contentFormat,
    );
  }
  function linksForValue(value: unknown, key: string, contentFormat?: CellFormat['contentFormat']) {
    if (options.detectLinks === false || mediaColumn(key)) return [];
    const rich = richText(value, key, contentFormat);
    if (!rich) return detectLinks(value);
    const links = detectLinks(rich.text);
    let offset = 0;
    for (const run of rich.runs) {
      if (run.href) links.push({ text: run.text, href: run.href, start: offset, end: offset + run.text.length });
      offset += run.text.length;
    }
    return links.filter(
      (link, index) => links.findIndex((other) => other.href === link.href && other.start === link.start) === index,
    );
  }

  function validationMessage(value: unknown, columnIndex: number): string | undefined {
    return columns[columnIndex]?.validate?.(value);
  }
  const rowLockCache = new Map<number, boolean>();
  function rowValueLocked(row: number): boolean {
    const cached = rowLockCache.get(row);
    if (cached !== undefined) return cached;
    const locked =
      engine.isLocked({ scope: 'row', rowIndex: row }) ||
      (columns.length > 0 &&
        columns.every(
          (_, columnIndex) =>
            engine.isLocked({ scope: 'cell', rowIndex: row, columnIndex }) ||
            engine.isLocked({ scope: 'column', columnIndex }),
        ));
    rowLockCache.set(row, locked);
    return locked;
  }
  function cell(
    value: unknown,
    x: number,
    y: number,
    width: number,
    height: number,
    header: boolean,
    rowIndex = 0,
    columnIndex = 0,
  ): void {
    paintCell(value, x, y, width, height, header, rowIndex, columnIndex);
    const labels = stateLabels(header ? null : rowIndex, columnIndex);
    const ctx = context!;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    if (!header && rowValueLocked(rowIndex)) {
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = theme.textColor;
      ctx.fillRect(x, y, width, height);
      ctx.globalAlpha = 1;
    }
    const range = getSelectionRanges().find(
      (range) =>
        rowIndex >= range.startRow &&
        rowIndex <= range.endRow &&
        columnIndex >= range.startColumn &&
        columnIndex <= range.endColumn,
    );
    if (
      !header &&
      range &&
      rowIndex >= range.startRow &&
      rowIndex <= range.endRow &&
      columnIndex >= range.startColumn &&
      columnIndex <= range.endColumn
    ) {
      ctx.globalAlpha = rangeTintOpacity;
      ctx.fillStyle = theme.selectionColor;
      ctx.fillRect(x, y, width, height);
      ctx.globalAlpha = 1;
    }
    if (header) {
      const sort =
        currentView?.sorts?.find((item) => item.columnKey === columns[columnIndex]!.key) ?? currentView?.sort;
      if (sort?.columnKey === columns[columnIndex]!.key) {
        stateIcon(sort.direction === 'asc' ? 'arrow-up' : 'arrow-down', x + width - 36, y + (height - 16) / 2);
      }
      if (currentView?.filters?.some((filter) => filter.columnKey === columns[columnIndex]!.key)) {
        stateIcon('funnel', x + width - 54, y + (height - 16) / 2);
      }
    }
    if (labels.some((label) => label.includes('disabled'))) {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = theme.background;
      ctx.fillRect(x, y, width, height);
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = '#64748b';
      ctx.fillRect(x, y, width, height);
      ctx.globalAlpha = 1;
    }
    const leading = columnIndex === 0 || (x <= 0 && x + width > 0);
    const locked = header
      ? labels.some((label) => label.endsWith('locked'))
      : (!rowValueLocked(rowIndex) && engine.isLocked({ scope: 'cell', rowIndex, columnIndex })) ||
        (!indexWidth && rowValueLocked(rowIndex));
    if (locked && width >= 24 && height >= 20) {
      const left = x + width - 18;
      const top = y + 4;
      stateIcon('lock', left, top);
    }
    if (!header && validationMessage(value, columnIndex)) {
      ctx.fillStyle = columns[columnIndex]?.invalidInput === 'allow' ? '#d97706' : '#ef4444';
      ctx.beginPath();
      ctx.moveTo(x + width - 8, y + 1);
      ctx.lineTo(x + width - 1, y + 1);
      ctx.lineTo(x + width - 1, y + 8);
      ctx.closePath();
      ctx.fill();
    }
    if (
      !header &&
      hoveredChoice?.row === rowIndex &&
      hoveredChoice.col === columnIndex &&
      width >= 28 &&
      height >= 20 &&
      engine.canEdit(rowIndex, columnIndex)
    )
      stateIcon('chevron-down', x + width - 22, y + (height - 16) / 2);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = theme.gridLineColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + width - 0.5, y);
    ctx.lineTo(x + width - 0.5, y + height - 0.5);
    ctx.lineTo(x, y + height - 0.5);
    ctx.stroke();
    ctx.restore();
  }

  function paintCell(
    value: unknown,
    x: number,
    y: number,
    width: number,
    height: number,
    header: boolean,
    rowIndex = 0,
    columnIndex = 0,
  ): void {
    const selection = engine.getSelection();
    const ctx = context!;
    ctx.clearRect(x, y, width, height);
    const format = header ? null : engine.getFormat(rowIndex, columnIndex);
    const cellFont =
      format?.fontStyle || format?.fontWeight
        ? `${format?.fontStyle === 'italic' ? 'italic ' : ''}${format?.fontWeight === 'bold' ? '700 ' : ''}${theme.font.replace(/\b(?:italic|oblique|normal|[1-9]00|bold)\s+/g, '')}`
        : theme.font;
    const background = format?.background ?? theme.background;
    const textColor = format?.textColor ?? theme.textColor;
    ctx.fillStyle = header ? theme.headerBackground : background;
    ctx.fillRect(x, y, width, height);
    const range = getSelectionRange();
    const wholeColumn = getSelectionRanges().some(
      (range) =>
        range.startRow === 0 &&
        range.endRow === rowCount - 1 &&
        columnIndex >= range.startColumn &&
        columnIndex <= range.endColumn,
    );
    if (header && engine.isLocked({ scope: 'column', columnIndex })) {
      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = theme.headerTextColor;
      ctx.fillRect(x, y, width, height);
      ctx.restore();
    }
    if (header && (wholeColumn || engine.getSelection()?.columnIndex === columnIndex)) {
      ctx.save();
      ctx.globalAlpha = headerTintOpacity;
      ctx.fillStyle = theme.selectionColor;
      ctx.fillRect(x, y, width, height);
      ctx.restore();
    }
    if (!header && options.renderCell) {
      ctx.font = cellFont;
      let handled = false;
      ctx.save();
      try {
        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.clip();
        handled = options.renderCell(
          ctx,
          Object.freeze({
            value,
            format: format!,
            rowIndex,
            rowId: engine.getRowId(rowIndex),
            columnIndex,
            columnKey: columns[columnIndex]!.key,
            x,
            y,
            width,
            height,
          }),
        );
      } catch (error) {
        win.console.error(t('Cell renderer failed.'), error);
      } finally {
        ctx.restore();
        ctx.beginPath();
      }
      if (handled) {
        highlightSearch(x, y, width, height, rowIndex, columnIndex);
        return;
      }
      ctx.clearRect(x, y, width, height);
      ctx.fillStyle = background;
      ctx.fillRect(x, y, width, height);
    }
    if (!header && mediaColumn(columns[columnIndex]!.key)) {
      if (avatarColumns.has(columns[columnIndex]!.key) || Array.isArray(value))
        mediaCell(value, x, y, width, height, textColor, avatarColumns.has(columns[columnIndex]!.key));
      else imageCell(value, x, y, width, height, textColor);
      highlightSearch(x, y, width, height, rowIndex, columnIndex);
      return;
    }
    if (!header && columnEditors.get(columns[columnIndex]!.key)?.type === 'checkbox' && typeof value === 'boolean') {
      const size = Math.max(0, Math.min(16, width - 20, height - 8));
      const left = x + 10;
      const top = y + (height - size) / 2;
      ctx.save();
      ctx.strokeStyle = textColor;
      ctx.lineWidth = 1;
      if (size > 0) {
        ctx.strokeRect(left + 0.5, top + 0.5, size - 1, size - 1);
        if (value) {
          ctx.beginPath();
          ctx.moveTo(left + size * 0.2, top + size * 0.5);
          ctx.lineTo(left + size * 0.45, top + size * 0.75);
          ctx.lineTo(left + size * 0.8, top + size * 0.25);
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      ctx.restore();
      highlightSearch(x, y, width, height, rowIndex, columnIndex);
      return;
    }
    const rich = !header ? richText(value, columns[columnIndex]!.key, format?.contentFormat) : undefined;
    if (rich) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 8, y, Math.max(0, width - 16), height);
      ctx.clip();
      ctx.font = cellFont;
      const metrics = ctx.measureText('M');
      const lineHeight = Math.ceil(metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) || 18;
      const layout = layoutRichText(
        ctx,
        rich,
        cellFont,
        Math.max(0, width - 20),
        !!options.wrapText,
        Math.max(1, Math.floor((height - 4) / lineHeight)),
      );
      ctx.textBaseline = 'top';
      for (const piece of layout.pieces) {
        const top =
          y +
          (options.wrapText || layout.lines > 1 ? 4 : (height - layout.lineHeight) / 2) +
          piece.line * layout.lineHeight;
        if (top + layout.lineHeight > y + height) break;
        ctx.font = piece.font;
        ctx.fillStyle =
          piece.run.href && options.detectLinks !== false ? (format?.textColor ?? theme.linkColor) : textColor;
        ctx.fillText(piece.text, x + 10 + piece.x, top);
        if (piece.run.underline || (piece.run.href && options.detectLinks !== false))
          ctx.fillRect(x + 10 + piece.x, top + layout.lineHeight - 1, piece.width, 1);
      }
      ctx.restore();
      highlightSearch(x, y, width, height, rowIndex, columnIndex);
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 8, y, Math.max(0, width - 16), height);
    ctx.clip();
    ctx.fillStyle = header ? theme.headerTextColor : textColor;
    ctx.font = header ? theme.headerFont : cellFont;
    ctx.textBaseline = 'middle';
    const text = header ? String(value ?? '') : numberText(value, format?.numberFormat);
    const links = !header && options.detectLinks !== false ? detectLinks(value) : [];
    const paintText = (line: string, offset: number, top: number, lineHeight = 0) => {
      let left = x + 10;
      let position = 0;
      for (const link of links) {
        const start = Math.max(0, link.start - offset);
        const end = Math.min(line.length, link.end - offset);
        if (end <= start || start >= line.length) continue;
        const plain = line.slice(position, start);
        ctx.fillStyle = textColor;
        ctx.fillText(plain, left, top);
        left += ctx.measureText(plain).width;
        const part = line.slice(start, end);
        ctx.fillStyle = format?.textColor ?? theme.linkColor;
        ctx.fillText(part, left, top);
        const w = ctx.measureText(part).width;
        ctx.fillRect(left, top + (lineHeight ? lineHeight - 1 : 8), w, 1);
        left += w;
        position = end;
      }
      ctx.fillStyle = header ? theme.headerTextColor : textColor;
      ctx.fillText(line.slice(position), left, top);
    };
    if (!header && options.wrapText) {
      ctx.textBaseline = 'top';
      const metrics = ctx.measureText('M');
      const lineHeight = Math.ceil(metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) || 18;
      if (!text.includes('\n') && ctx.measureText(text).width <= Math.max(0, width - 20)) {
        if (y + 4 + lineHeight <= y + height) paintText(text, 0, y + 4, lineHeight);
        ctx.restore();
        highlightSearch(x, y, width, height, rowIndex, columnIndex);
        return;
      }
      let line = '';
      let top = y + 4;
      let offset = 0;
      for (const character of text) {
        if (top + lineHeight > y + height) break;
        if (character === '\n' || (line && ctx.measureText(line + character).width > Math.max(0, width - 20))) {
          paintText(line, offset, top, lineHeight);
          offset += line.length + (character === '\n' ? 1 : 0);
          top += lineHeight;
          line = '';
        }
        if (character !== '\n') line += character;
      }
      if (top + lineHeight <= y + height) paintText(line, offset, top, lineHeight);
    } else if (header && headers.levels > 1) {
      ctx.textAlign = 'center';
      ctx.fillText(text, x + width / 2, y + height / 2);
    } else paintText(text, 0, y + height / 2);
    ctx.restore();
    if (!header) highlightSearch(x, y, width, height, rowIndex, columnIndex);
  }

  function imageCell(
    value: unknown,
    x: number,
    y: number,
    width: number,
    height: number,
    textColor: string,
    shape?: 'avatar' | 'thumbnail',
    label = '',
  ): void {
    if (!shape && (value == null || value === '')) return;
    let item: { image: HTMLImageElement; state: 'loading' | 'ready' | 'error' } | undefined;
    try {
      if (typeof value !== 'string') throw new TypeError('Image URL must be a string.');
      const url = new win.URL(value, doc.baseURI);
      if (
        url.username ||
        url.password ||
        !['http:', 'https:', 'blob:', 'data:'].includes(url.protocol) ||
        (url.protocol === 'data:' && !/^data:image\//i.test(value))
      )
        throw new TypeError('Unsupported image URL.');
      const src = url.href;
      mediaController.visibleImages.add(src);
      item = mediaController.imageCache.get(src);
      if (!item) {
        const image = doc.createElement('img');
        const record = { image, state: 'loading' as 'loading' | 'ready' | 'error' };
        mediaController.imageCache.set(src, record);
        item = record;
        image.crossOrigin = 'anonymous';
        image.referrerPolicy = 'no-referrer';
        image.decoding = 'async';
        const loaded = (state: 'ready' | 'error') => {
          if (destroyed || mediaController.imageCache.get(src) !== record) return;
          record.state = state;
          fullDraw = true;
          schedule();
        };
        image.onload = () => loaded(image.naturalWidth && image.naturalHeight ? 'ready' : 'error');
        image.onerror = () => loaded('error');
        image.src = src;
      }
    } catch {
      /* Invalid URLs use the same unavailable state as failed image loads. */
    }
    const ctx = context!;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
    ctx.clip();
    if (shape) {
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, width - 2, height - 2, shape === 'avatar' ? width / 2 : 6);
      ctx.clip();
      ctx.fillStyle = theme.headerBackground;
      ctx.fillRect(x, y, width, height);
    }
    if (item?.state === 'ready') {
      const image = item.image;
      const ratio = shape
        ? Math.max(width / image.naturalWidth, height / image.naturalHeight)
        : Math.max(0, Math.min(1, (width - 16) / image.naturalWidth, (height - 8) / image.naturalHeight));
      const w = image.naturalWidth * ratio;
      const h = image.naturalHeight * ratio;
      if (ratio > 0) {
        ctx.save();
        if (!shape) {
          ctx.beginPath();
          ctx.roundRect(x + (width - w) / 2, y + (height - h) / 2, w, h, 6);
          ctx.clip();
        }
        ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
        ctx.restore();
      }
    } else {
      ctx.font = theme.font;
      ctx.fillStyle = textColor;
      ctx.textBaseline = 'middle';
      if (shape) {
        ctx.textAlign = 'center';
        ctx.fillText(
          shape === 'avatar'
            ? label
                .trim()
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join('')
                .toLocaleUpperCase() || '?'
            : item?.state === 'loading'
              ? '…'
              : '—',
          x + width / 2,
          y + height / 2,
        );
      } else ctx.fillText(item?.state === 'loading' ? t('Loading…') : t('Image unavailable'), x + 8, y + height / 2);
    }
    ctx.restore();
    ctx.beginPath();
    if (shape) {
      ctx.save();
      ctx.strokeStyle = theme.background;
      ctx.lineWidth = 2;
      ctx.roundRect(x + 1, y + 1, width - 2, height - 2, shape === 'avatar' ? width / 2 : 6);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
    }
  }

  function mediaCell(
    value: unknown,
    x: number,
    y: number,
    width: number,
    height: number,
    textColor: string,
    avatars: boolean,
  ): void {
    const items = mediaItems(value);
    if (!items.length) return;
    const size = Math.max(0, Math.min(mediaSize, height - 8, width - 16));
    if (size < 12) return;
    const step = avatars ? size * 0.76 : size + 6,
      available = Math.max(0, width - 16);
    let count = Math.min(mediaLimit, items.length, Math.max(1, Math.floor((available - size) / step) + 1));
    if (count < items.length && count * step + size > available) count = Math.max(0, count - 1);
    for (let i = 0; i < count; i++) {
      const item = items[i]!;
      imageCell(
        item.src,
        x + 8 + i * step,
        y + (height - size) / 2,
        size,
        size,
        textColor,
        avatars ? 'avatar' : 'thumbnail',
        item.name ?? item.alt ?? '',
      );
    }
    if (count < items.length) {
      const ctx = context!;
      ctx.save();
      ctx.fillStyle = theme.headerBackground;
      ctx.beginPath();
      ctx.roundRect(x + 8 + count * step, y + (height - size) / 2, size, size, avatars ? size / 2 : 6);
      ctx.fill();
      ctx.fillStyle = textColor;
      ctx.font = theme.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+' + (items.length - count), x + 8 + count * step + size / 2, y + height / 2);
      ctx.restore();
      ctx.beginPath();
    }
  }

  function viewport() {
    return engine.getViewport({
      width: scroller.clientWidth,
      height: scroller.clientHeight,
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
    });
  }

  function positionRichEditor(maxHeight: number): void {
    if (!richEditor || !editor) return;
    for (const property of ['left', 'top', 'width'] as const) richEditor.style[property] = editor.style[property];
    richEditor.style.height = '0px';
    richEditor.style.height = `${Math.min(maxHeight, Math.max(parseFloat(editor.style.height), richEditor.scrollHeight + 4))}px`;
    editor.style.height = richEditor.style.height;
    if (editor.hasAttribute('aria-invalid')) richEditor.setAttribute('aria-invalid', 'true');
    else richEditor.removeAttribute('aria-invalid');
  }
  function positionEditor(): void {
    const selection = engine.getSelection();
    if (!editor || !selection) return;
    const rect = viewport().cellRect(selection.rowIndex, selection.columnIndex);
    if (options.editorOptions?.pinned) {
      const bounds = root.getBoundingClientRect();
      editorAnchor ??= {
        left: bounds.left + indexWidth + rect.x,
        top: bounds.top + headerHeight + rect.y,
        width: rect.width,
        height: rect.height,
      };
      const left = Math.max(
        8,
        Math.min(editorAnchor.left, win.innerWidth - Math.min(editorAnchor.width, win.innerWidth - 16) - 8),
      );
      const top = Math.max(
        32,
        Math.min(editorAnchor.top, win.innerHeight - Math.min(editorAnchor.height, win.innerHeight - 48) - 16),
      );
      editorPane.style.position = 'fixed';
      editorPane.style.overflow = 'visible';
      editorPane.style.zIndex = '9';
      editorPane.style.clipPath = '';
      editorPane.style.left = `${left}px`;
      editorPane.style.top = `${top}px`;
      editorPane.style.width = `${Math.min(editorAnchor.width, win.innerWidth - left - 8)}px`;
      editorPane.style.height = `${Math.min(editorAnchor.height, win.innerHeight - top - 16)}px`;
      editor.style.left = '0px';
      editor.style.top = '0px';
      editor.style.width = editorPane.style.width;
      editor.style.height = editorPane.style.height;
      if (editor instanceof win.HTMLTextAreaElement && !richEditor) {
        editor.style.height = '0px';
        editor.style.height = `${Math.min(Math.max(editorAnchor.height, editor.scrollHeight + 4), win.innerHeight - top - 16)}px`;
      }
      positionRichEditor(win.innerHeight - top - 16);
      const displaced =
        Math.abs(bounds.left + indexWidth + rect.x - editorAnchor.left) > 0.5 ||
        Math.abs(bounds.top + headerHeight + rect.y - editorAnchor.top) > 0.5;
      editorLabel.hidden =
        options.editorOptions.showLabel === false || (options.editorOptions.showLabel === 'scroll' && !displaced);
      if (choices && editor instanceof win.HTMLSelectElement) {
        choices.hidden = false;
        positionChoicePanel(choices, editor);
      }
      if (editorError.style.display !== 'none') {
        editorError.style.position = 'fixed';
        editorError.style.left = `${left}px`;
        editorError.style.top = `${Math.min(top + editor.offsetHeight + 4, win.innerHeight - editorError.offsetHeight - 8)}px`;
        editorError.style.maxWidth = `${win.innerWidth - left - 8}px`;
        editorError.style.visibility = 'visible';
      }
      return;
    }
    const clip = rect.clip;
    editorPane.style.left = `${indexWidth + clip.x}px`;
    editorPane.style.top = `${headerHeight + clip.y}px`;
    editorPane.style.width = `${clip.width}px`;
    editorPane.style.height = `${clip.height}px`;
    editor.style.left = `${rect.x - clip.x}px`;
    editor.style.top = `${rect.y - clip.y}px`;
    editor.style.width = `${rect.width}px`;
    editor.style.height = `${editor instanceof win.HTMLSelectElement && editor.multiple && !options.choiceEditor ? Math.min(220, Math.max(rect.height, editor.size * 24 + 8), Math.max(1, clip.height - Math.max(0, rect.y - clip.y))) : rect.height}px`;
    const hidden =
      rect.x + rect.width <= clip.x ||
      rect.x >= clip.x + clip.width ||
      rect.y + rect.height <= clip.y ||
      rect.y >= clip.y + clip.height;
    editorPane.style.clipPath = hidden ? 'inset(100%)' : '';
    if (choices && editor instanceof win.HTMLSelectElement) {
      choices.hidden = hidden;
      positionChoicePanel(choices, editor);
    }
    if (editor instanceof win.HTMLTextAreaElement && !richEditor) {
      context!.save();
      context!.font = theme.font;
      let width = rect.width;
      for (const line of editor.value.split('\n')) width = Math.max(width, context!.measureText(line).width + 24);
      context!.restore();
      editor.style.width = `${Math.min(width, Math.max(1, clip.width - Math.max(0, rect.x - clip.x)))}px`;
      editor.style.height = '0px';
      editor.style.height = `${Math.min(Math.max(rect.height, editor.scrollHeight + 4), Math.max(1, clip.height - Math.max(0, rect.y - clip.y)))}px`;
    }
    positionRichEditor(Math.max(1, clip.height - Math.max(0, rect.y - clip.y)));
    if (editorError.style.display !== 'none') {
      editorError.style.maxWidth = `${clip.width}px`;
      editorError.style.visibility = hidden ? 'hidden' : 'visible';
      editorError.style.left = `${indexWidth + Math.max(clip.x, Math.min(rect.x, clip.x + clip.width - editorError.offsetWidth))}px`;
      editorError.style.top = `${headerHeight + Math.max(clip.y, Math.min(rect.y + editor.offsetHeight + 4, clip.y + clip.height - editorError.offsetHeight))}px`;
    }
  }

  function clipRegion(region: ViewportRegion): void {
    const clip = region.clip;
    context!.beginPath();
    context!.rect(clip.x, headerHeight + clip.y, clip.width, clip.height);
    context!.clip();
  }

  function accessibleText(row: number, col: number, value: unknown): string {
    const column = columns[col]!;
    const label = options.getCellLabel?.(row, column.key, value);
    if (label !== undefined) return label;
    if (mediaColumn(column.key)) {
      const items = mediaItems(value);
      return t(
        '{0}: {1} {2}{3}. Alt+Enter opens details.',
        column.title,
        items.length,
        avatarColumns.has(column.key) ? t('people') : t('images'),
        items.length
          ? '; ' +
              items
                .map(
                  (item, i) =>
                    item.name ?? item.alt ?? (avatarColumns.has(column.key) ? t('Person ') : t('Image ')) + (i + 1),
                )
                .join(', ')
          : '',
      );
    }
    return `${column.title}: ${typeof value === 'number' ? numberText(value, engine.getFormat(row, col).numberFormat) : displayedText(value, column.key, engine.getFormat(row, col).contentFormat)}`;
  }
  function accessibleCell(row: number, col: number, value: unknown): HTMLElement {
    const key = `${row}:${col}`;
    let node = accessibleCells.get(key);
    if (!node) {
      node = doc.createElement('div');
      node.id = `acheron-visible-${instanceId}-${row}-${col}`;
      node.setAttribute('role', 'gridcell');
      accessibleCells.set(key, node);
    }
    node.setAttribute('aria-colindex', String(col + 1));
    const span = engine.getMerge(row, col);
    node.setAttribute('aria-rowspan', String(span ? span.endRow - span.startRow + 1 : 1));
    node.setAttribute('aria-colspan', String(span ? span.endColumn - span.startColumn + 1 : 1));
    const invalid = validationMessage(value, col);
    node.setAttribute('aria-invalid', String(!!invalid));
    node.setAttribute('aria-readonly', String(!engine.canEdit(row, col)));
    node.setAttribute(
      'aria-selected',
      String(
        getSelectionRanges().some(
          (range) => row >= range.startRow && row <= range.endRow && col >= range.startColumn && col <= range.endColumn,
        ),
      ),
    );
    node.setAttribute(
      'aria-description',
      [
        ...stateLabels(row, col).map((label) => t(label)),
        ...(invalid ? [invalid] : []),
        ...(linksForValue(value, columns[col]!.key, engine.getFormat(row, col).contentFormat).length
          ? [t('Contains links. Alt+Enter opens links.')]
          : []),
      ].join('; '),
    );
    node.textContent = accessibleText(row, col, value);
    return node;
  }
  function draw(): void {
    rowLockCache.clear();
    frame = undefined;
    if (destroyed) return;
    if (options.autoRowHeight && !editor && !resizing)
      for (const row of visibleIndices('row')) {
        if (engine.isRowHeightManual(row) || measuredRows.has(row)) continue;
        const height = measureRowHeight(row, true);
        measuredRows.add(row);
        if (height !== rowAxis.size(row)) engine.measureRowHeight(row, height);
      }
    const view = viewport();
    if (!fullDraw) {
      for (const change of dirty.values()) {
        const col = columns.findIndex((column) => column.key === change.columnKey);
        const rect = view.cellRect(change.rowIndex, col);
        const clip = rect.clip;
        if (
          rect.x >= clip.x + clip.width ||
          rect.x + rect.width <= clip.x ||
          rect.y >= clip.y + clip.height ||
          rect.y + rect.height <= clip.y ||
          clip.width <= 0 ||
          clip.height <= 0
        )
          continue;
        context!.save();
        context!.beginPath();
        context!.rect(clip.x, headerHeight + clip.y, clip.width, clip.height);
        context!.clip();
        context!.beginPath();
        context!.rect(rect.x, headerHeight + rect.y, rect.width, rect.height);
        context!.clip();
        const value = engine.getValue(change.rowIndex, change.columnKey);
        if (viewportAccessibility) accessibleCell(change.rowIndex, col, value);
        cell(value, rect.x, headerHeight + rect.y, rect.width, rect.height, false, change.rowIndex, col);
        drawSelection(view.regions);
        context!.restore();
      }
      dirty.clear();
      return;
    }
    fullDraw = false;
    const pendingAccessible: { row: number; col: number; value: unknown }[] = [];
    const accessibleRows = new Map<number, HTMLElement>();
    const seenCells = new Set<string>();
    const headerNodes: HTMLElement[] = [];
    mediaController.visibleImages.clear();
    dirty.clear();
    const ratio = win.devicePixelRatio || 1;
    const height = Math.min(root.clientHeight, view.height + headerHeight);
    const pixelWidth = Math.max(0, Math.round(view.width * ratio));
    const pixelHeight = Math.max(0, Math.round(height * ratio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    canvas.style.width = `${view.width}px`;
    canvas.style.height = `${height}px`;
    context!.setTransform(ratio, 0, 0, ratio, 0, 0);
    context!.clearRect(0, 0, view.width, height);
    for (const region of view.regions) {
      context!.save();
      clipRegion(region);
      const painted = new Set<string>();
      for (let row = region.rows.start; row < region.rows.end; row++) {
        if (rowAxis.size(row) === 0) {
          row = rowAxis.indexAt(rowAxis.position(row));
          if (row >= region.rows.end) break;
        }
        for (let col = region.columns.start; col < region.columns.end; col++) {
          if (columnAxis.size(col) === 0) {
            col = columnAxis.indexAt(columnAxis.position(col));
            if (col >= region.columns.end) break;
          }
          const span = engine.getMerge(row, col),
            paintRow = span?.startRow ?? row,
            paintCol = span?.startColumn ?? col;
          const key = `${paintRow}:${paintCol}`;
          if (painted.has(key)) continue;
          painted.add(key);
          const rect = view.cellRect(paintRow, paintCol);
          const value = engine.getValue(paintRow, columns[paintCol]!.key);
          if (viewportAccessibility) pendingAccessible.push({ row: paintRow, col: paintCol, value });
          cell(value, rect.x, headerHeight + rect.y, rect.width, rect.height, false, paintRow, paintCol);
        }
      }
      context!.restore();
    }
    drawSelection(view.regions);
    const fixed = columnAxis.range(0, view.frozenWidth);
    const moving = columnAxis.range(
      columnAxis.position(engine.frozenColumns) + view.scrollLeft,
      view.width - view.frozenWidth,
    );
    for (const band of [
      { start: 0, end: Math.min(engine.frozenColumns, fixed.end), x: 0, width: view.frozenWidth, offset: 0 },
      {
        start: Math.max(engine.frozenColumns, moving.start),
        end: moving.end,
        x: view.frozenWidth,
        width: view.width - view.frozenWidth,
        offset: -view.scrollLeft,
      },
    ]) {
      if (band.width <= 0) continue;
      context!.save();
      context!.beginPath();
      context!.rect(band.x, 0, band.width, headerHeight);
      context!.clip();
      for (let col = band.start; col < band.end; col++) {
        if (columnAxis.size(col) === 0) {
          col = columnAxis.indexAt(columnAxis.position(col));
          if (col >= band.end) break;
        }
        const layout = leafHeaders[col]!;
        cell(
          columns[col]!.title,
          columnAxis.position(col) + band.offset,
          layout.level * headerRowHeight,
          columnAxis.size(col),
          layout.rowSpan * headerRowHeight,
          true,
          0,
          col,
        );
        const header = doc.createElement('div');
        header.dataset.gridHeaderCell = String(col);
        header.tabIndex = 0;
        header.setAttribute('role', viewportAccessibility ? 'columnheader' : 'button');
        header.setAttribute(
          'aria-label',
          viewportAccessibility ? columns[col]!.title : t('Select column {0}', columns[col]!.title),
        );
        header.addEventListener('keydown', (event) => {
          if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
            event.preventDefault();
            const bounds = header.getBoundingClientRect();
            openMenu(0, col, bounds.left, bounds.bottom, true);
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (rowCount && finishEdit(true)) {
              startAxisSelection('column', col, event);
              scroller.focus({ preventScroll: true });
            }
          }
        });
        header.style.cssText = `position:absolute;left:${Math.max(band.x, columnAxis.position(col) + band.offset)}px;top:${layout.level * headerRowHeight}px;width:${Math.max(0, Math.min(band.x + band.width, columnAxis.position(col + 1) + band.offset) - Math.max(band.x, columnAxis.position(col) + band.offset))}px;height:${layout.rowSpan * headerRowHeight}px`;
        header.dataset.headerLevel = String(layout.level);
        header.setAttribute('aria-rowspan', String(layout.rowSpan));
        if (viewportAccessibility) {
          header.setAttribute('role', 'columnheader');
          header.setAttribute('aria-colindex', String(col + 1));
          header.setAttribute('aria-label', columns[col]!.title);
          header.setAttribute(
            'aria-description',
            stateLabels(null, col)
              .map((label) => t(label))
              .join('; '),
          );
          const sort = currentView?.sorts?.[0] ?? currentView?.sort;
          header.setAttribute(
            'aria-sort',
            sort?.columnKey === columns[col]!.key
              ? (currentView?.sorts?.length ?? 0) > 1
                ? 'other'
                : sort.direction === 'asc'
                  ? 'ascending'
                  : 'descending'
              : 'none',
          );
        }
        reorderHandle(header, 'column', col);
        headerNodes.push(header);
      }
      for (const group of headers.cells.filter(
        (cell) => !cell.leaf && cell.start < band.end && cell.end > band.start,
      )) {
        const x = columnAxis.position(group.start) + band.offset;
        const width = columnAxis.position(group.end) - columnAxis.position(group.start);
        const y = group.level * headerRowHeight;
        context!.fillStyle = theme.headerBackground;
        context!.fillRect(x, y, width, headerRowHeight);
        const activeColumn = engine.getSelection()?.columnIndex;
        if (
          (activeColumn !== undefined && activeColumn >= group.start && activeColumn < group.end) ||
          getSelectionRanges().some(
            (range) =>
              range.startRow === 0 &&
              range.endRow === rowCount - 1 &&
              range.startColumn < group.end &&
              range.endColumn >= group.start,
          )
        ) {
          context!.save();
          context!.globalAlpha = headerTintOpacity;
          context!.fillStyle = theme.selectionColor;
          context!.fillRect(x, y, width, headerRowHeight);
          context!.restore();
        }
        context!.strokeStyle = theme.gridLineColor;
        context!.lineWidth = 1;
        context!.beginPath();
        context!.moveTo(x + width - 0.5, y);
        context!.lineTo(x + width - 0.5, y + headerRowHeight - 0.5);
        context!.lineTo(x, y + headerRowHeight - 0.5);
        context!.stroke();
        context!.save();
        context!.beginPath();
        context!.rect(x + 6, y, Math.max(0, width - 12), headerRowHeight);
        context!.clip();
        context!.font = theme.headerFont;
        context!.fillStyle = theme.headerTextColor;
        context!.textAlign = 'center';
        context!.textBaseline = 'middle';
        context!.fillText(
          group.title,
          (Math.max(band.x, x) + Math.min(band.x + band.width, x + width)) / 2,
          y + headerRowHeight / 2,
        );
        context!.restore();
        const node = doc.createElement('div');
        node.dataset.gridHeaderGroup = group.title;
        node.dataset.headerLevel = String(group.level);
        node.setAttribute('role', 'columnheader');
        node.setAttribute('aria-label', group.title);
        node.setAttribute('aria-colindex', String(group.start + 1));
        node.setAttribute('aria-colspan', String(group.end - group.start));
        node.style.cssText = `position:absolute;left:${Math.max(band.x, x)}px;top:${y}px;width:${Math.max(0, Math.min(band.x + band.width, x + width) - Math.max(band.x, x))}px;height:${headerRowHeight}px`;
        node.tabIndex = 0;
        node.dataset.groupStart = String(group.start);
        node.dataset.groupEnd = String(group.end - 1);
        node.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectHeaderGroup(group.start, group.end - 1, event);
          }
        });
        reorderHandle(node, 'column', group.start, group.end - 1);
        headerNodes.push(node);
      }
      context!.restore();
    }
    const focusedHeader = headerSurface.contains(doc.activeElement)
      ? (doc.activeElement as HTMLElement).dataset.gridHeaderCell
      : undefined;
    const focusedGroup = headerSurface.contains(doc.activeElement)
      ? (doc.activeElement as HTMLElement).dataset.gridHeaderGroup
      : undefined;
    const focusedGroupStart = headerSurface.contains(doc.activeElement)
      ? (doc.activeElement as HTMLElement).dataset.groupStart
      : undefined;
    if (viewportAccessibility && headers.levels > 1) {
      const rows = Array.from({ length: headers.levels }, (_, level) => {
        const row = doc.createElement('div');
        row.setAttribute('role', 'row');
        row.setAttribute('aria-rowindex', String(level + 1));
        row.append(...headerNodes.filter((node) => Number(node.dataset.headerLevel) === level));
        return row;
      });
      headerSurface.replaceChildren(...rows);
    } else headerSurface.replaceChildren(...headerNodes);
    if (focusedHeader !== undefined)
      headerNodes.find((node) => node.dataset.gridHeaderCell === focusedHeader)?.focus({ preventScroll: true });
    else if (focusedGroup !== undefined)
      headerNodes
        .find((node) => node.dataset.gridHeaderGroup === focusedGroup && node.dataset.groupStart === focusedGroupStart)
        ?.focus({ preventScroll: true });
    for (const { row, col, value } of pendingAccessible) {
      let rowNode = accessibleRows.get(row);
      if (!rowNode) {
        rowNode = doc.createElement('div');
        rowNode.setAttribute('role', 'row');
        rowNode.setAttribute('aria-rowindex', String(row + headers.levels + 1));
        accessibleRows.set(row, rowNode);
      }
      seenCells.add(`${row}:${col}`);
      rowNode.append(accessibleCell(row, col, value));
    }
    if (viewportAccessibility) {
      for (const key of accessibleCells.keys()) if (!seenCells.has(key)) accessibleCells.delete(key);
      accessibleBody.replaceChildren(...[...accessibleRows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row));
      const selection = engine.getSelection();
      const node = selection && accessibleCells.get(`${selection.rowIndex}:${selection.columnIndex}`);
      if (node) {
        activeRow.hidden = true;
        scroller.setAttribute('aria-activedescendant', node.id);
      } else if (selection) {
        activeRow.hidden = false;
        scroller.setAttribute('aria-activedescendant', activeCell.id);
      }
    }
    drawIndex();
    releaseUnusedImages();
  }

  function indexRow(event: MouseEvent): number | null {
    if (!indexWidth || !columns.length) return null;
    const bounds = root.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top - headerHeight;
    const view = viewport();
    if (x < 0 || x >= indexWidth || y < 0 || y >= view.height) return null;
    const row = rowAxis.indexAt(y + (y < view.frozenHeight ? 0 : view.scrollTop));
    return row < rowCount ? row : null;
  }

  function rowLabels(row: number): string[] {
    const labels: string[] = [];
    if (engine.isLocked({ scope: 'table' })) labels.push(t('Table locked'));
    if (rowValueLocked(row)) labels.push(t('Row locked'));
    if (row < engine.frozenRows) labels.push(t('Row frozen'));
    return labels;
  }

  function drawIndex(): void {
    if (!indexWidth) return;
    const outline = engine.getRowGroups();
    const depths = new Map(
      outline.map((group) => [
        group.id,
        outline.filter(
          (other) => other.id !== group.id && other.startRow <= group.startRow && other.endRow >= group.endRow,
        ).length,
      ]),
    );
    const levels = outline.reduce((max, group) => Math.max(max, depths.get(group.id)! + 1), 0);
    const view = viewport();
    const range = getSelectionRange();
    indexGutter.style.height = `${headerHeight + view.height}px`;
    const corner = doc.createElement('button');
    corner.type = 'button';
    corner.tabIndex = -1;
    corner.textContent = '#';
    corner.title = t('Select all cells');
    corner.setAttribute('aria-label', t('Select all cells'));
    corner.disabled = !rowCount || !columns.length;
    corner.setAttribute(
      'aria-pressed',
      String(
        !!range &&
          range.startRow === 0 &&
          range.endRow === rowCount - 1 &&
          range.startColumn === 0 &&
          range.endColumn === columns.length - 1,
      ),
    );
    corner.addEventListener('click', (event) => {
      if (event.detail === 0) {
        selectAll();
        scroller.focus({ preventScroll: true });
      }
    });
    corner.style.cssText = `width:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;height:${headerHeight}px;display:flex;align-items:center;justify-content:center;border-bottom:1px solid var(--acheron-grid-line-color);border-right:1px solid var(--acheron-grid-line-color);box-sizing:border-box`;
    const children: HTMLElement[] = [corner];
    const fixed = rowAxis.range(0, view.frozenHeight);
    const moving = rowAxis.range(rowAxis.position(engine.frozenRows) + view.scrollTop, view.height - view.frozenHeight);
    for (const band of [
      { start: 0, end: Math.min(engine.frozenRows, fixed.end), y: 0, height: view.frozenHeight, offset: 0 },
      {
        start: Math.max(engine.frozenRows, moving.start),
        end: moving.end,
        y: view.frozenHeight,
        height: view.height - view.frozenHeight,
        offset: -view.scrollTop,
      },
    ]) {
      if (band.height <= 0) continue;
      const pane = doc.createElement('div');
      pane.style.cssText = `position:absolute;left:0;top:${headerHeight + band.y}px;width:100%;height:${band.height}px;overflow:hidden`;
      for (let row = band.start; row < band.end; row++) {
        if (rowAxis.size(row) === 0) {
          row = rowAxis.indexAt(rowAxis.position(row));
          if (row >= band.end) break;
        }
        const button = doc.createElement('button');
        button.type = 'button';
        button.tabIndex = -1;
        const sourceIndex = engine.getRowSourceIndex(row);
        button.textContent = String(sourceIndex + 1);
        button.setAttribute('aria-label', t('Select row {0}', sourceIndex + 1));
        const labels = rowLabels(row);
        const locked = labels.includes(t('Row locked'));
        button.title = [t('Select row {0}', sourceIndex + 1), ...labels].join('; ');
        button.setAttribute('aria-description', labels.map((label) => t(label)).join('; '));
        if (locked) {
          const icon = rowLockSvg.cloneNode(true) as Element;
          icon.setAttribute('width', '12');
          icon.setAttribute('height', '12');
          icon.setAttribute('aria-hidden', 'true');
          icon.setAttribute(
            'style',
            'position:absolute;right:3px;top:4px;pointer-events:none;color:var(--acheron-icon-color)',
          );
          button.append(doc.importNode(icon, true));
        }
        const selected = getSelectionRanges().some(
          (range) =>
            range.startColumn === 0 &&
            range.endColumn === columns.length - 1 &&
            row >= range.startRow &&
            row <= range.endRow,
        );
        button.setAttribute('aria-pressed', String(selected));
        button.style.cssText = `position:absolute;left:0;top:${rowAxis.position(row) + band.offset - band.y}px;width:100%;height:${rowAxis.size(row)}px;box-sizing:border-box;border:0;border-right:1px solid var(--acheron-grid-line-color);border-bottom:1px solid var(--acheron-grid-line-color);background:var(--acheron-header-background);color:inherit;font:inherit;cursor:pointer;${selected || engine.getSelection()?.rowIndex === row ? 'box-shadow:inset 0 0 0 9999px color-mix(in srgb,var(--acheron-selection-color) 16%,transparent)' : ''}`;
        if (locked) {
          button.style.background =
            'color-mix(in srgb,var(--acheron-header-text-color) 12%,var(--acheron-header-background))';
          button.style.padding = '0 16px 0 2px';
        }
        button.addEventListener('click', (event) => {
          if (event.detail === 0 && finishEdit(true)) {
            selectRow(row);
            scroller.focus({ preventScroll: true });
          }
        });
        const resizeHandle = doc.createElement('span');
        resizeHandle.dataset.gridRowResize = String(row);
        resizeHandle.setAttribute('aria-hidden', 'true');
        resizeHandle.title = 'Drag to resize row; double-click to fit';
        resizeHandle.style.cssText = 'position:absolute;bottom:0;left:0;width:100%;height:5px;cursor:row-resize';
        button.append(resizeHandle);
        reorderHandle(button, 'row', row);
        pane.append(button);
        if (outline.length) button.style.paddingLeft = `${levels * 24}px`;
        for (const group of outline.filter(
          (group) => !group.collapsed && group.startRow <= sourceIndex && group.endRow >= sourceIndex,
        )) {
          const depth = depths.get(group.id)!;
          const line = doc.createElement('span');
          line.setAttribute('aria-hidden', 'true');
          line.style.cssText = `position:absolute;left:${depth * 24 + 12}px;top:${rowAxis.position(row) + band.offset - band.y + (group.startRow === sourceIndex ? rowAxis.size(row) / 2 + 10 : 0)}px;width:6px;height:${group.startRow === sourceIndex ? Math.max(0, rowAxis.size(row) / 2 - 10) : group.endRow === sourceIndex ? rowAxis.size(row) / 2 : rowAxis.size(row)}px;box-sizing:border-box;border-left:1px solid color-mix(in srgb,var(--acheron-icon-color) 35%,var(--acheron-grid-line-color));${group.endRow === sourceIndex ? 'border-bottom:1px solid var(--acheron-grid-line-color);border-bottom-left-radius:4px;' : ''}pointer-events:none;transform-origin:top`;
          pane.append(line);
          if (enteringGroups.has(group.id) && motionEnabled())
            line.animate(
              [
                { opacity: 0, transform: 'scaleY(.6)' },
                { opacity: 1, transform: 'scaleY(1)' },
              ],
              { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)' },
            );
        }
        for (const group of outline
          .filter((group) => group.startRow === sourceIndex)
          .sort((a, b) => b.endRow - a.endRow)) {
          const depth = depths.get(group.id)!;
          const toggle = doc.createElement('button');
          toggle.type = 'button';
          toggle.dataset.gridRowGroup = group.id;
          toggle.setAttribute(
            'aria-label',
            t('{0} rows {1}–{2}', group.collapsed ? t('Expand') : t('Collapse'), group.startRow + 1, group.endRow + 1),
          );
          toggle.setAttribute('aria-expanded', String(!group.collapsed));
          toggle.disabled = !engine.canChangeLayout({ kind: group.collapsed ? 'expand' : 'collapse', group });
          toggle.title = toggle.getAttribute('aria-label')! + ' · ' + t('{0} rows', group.endRow - group.startRow + 1);
          const glyph = svgIcon('chevron-down');
          if (group.collapsed) glyph.setAttribute('style', 'transform:rotate(-90deg)');
          glyph.setAttribute('width', '12');
          glyph.setAttribute('height', '12');
          toggle.append(glyph);
          toggle.style.cssText = `position:absolute;left:${depth * 24 + 3}px;top:${rowAxis.position(row) + band.offset - band.y + Math.max(0, (rowAxis.size(row) - 20) / 2)}px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;padding:2px;border:0;border-radius:6px;background:color-mix(in srgb,var(--acheron-icon-color) 7%,var(--acheron-header-background));color:var(--acheron-header-text-color);cursor:pointer`;
          if (enteringGroups.has(group.id) && motionEnabled())
            toggle.animate(
              [
                { opacity: 0, transform: 'scale(.8)' },
                { opacity: 1, transform: 'scale(1)' },
              ],
              { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)' },
            );
          toggle.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
          });
          toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            try {
              structureAction(() => engine.setGroupCollapsed(group.id, !group.collapsed), 'row');
            } catch (error) {
              actionError.textContent = error instanceof Error ? t(error.message) : t('Unable to toggle row group.');
              actionError.style.display = 'block';
            }
          });
          pane.append(toggle);
        }
      }
      children.push(pane);
    }
    indexGutter.replaceChildren(...children);
    enteringGroups.clear();
  }

  let reorderDrag: { axis: 'row' | 'column'; indices: number[] } | null = null;
  let touchReorder: { pointerId: number; startX: number; startY: number; moved: boolean; beforeIndex: number } | null =
    null;
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
  function clearReorder(): void {
    const pointer = touchReorder?.pointerId;
    touchReorder = null;
    if (pointer !== undefined) {
      dragPointer = null;
      dragPosition = null;
      if (dragFrame !== undefined) win.cancelAnimationFrame(dragFrame);
      dragFrame = undefined;
      if (root.hasPointerCapture(pointer)) root.releasePointerCapture(pointer);
    }
    reorderDrag = null;
    reorderGuide.style.display = reorderBadge.style.display = 'none';
    root.style.cursor = '';
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
    reorderBadge.style.display = 'block';
    const request = Object.freeze({ axis, indices: Object.freeze([...reorderDrag!.indices]), beforeIndex });
    let allowed = false;
    try {
      allowed = options.canReorder?.(request) !== false;
    } catch {
      allowed = false;
    }
    const origin = root.getBoundingClientRect();
    const after = beforeIndex === last + 1;
    const edge =
      axis === 'row'
        ? (after ? bounds.bottom : bounds.top) - origin.top
        : (after ? bounds.right : bounds.left) - origin.left;
    reorderGuide.style.display = allowed ? 'block' : 'none';
    reorderGuide.style.left = axis === 'row' ? '0px' : `${Math.max(0, Math.min(root.clientWidth - 2, edge - 1))}px`;
    reorderGuide.style.top = axis === 'column' ? '0px' : `${Math.max(0, Math.min(root.clientHeight - 2, edge - 1))}px`;
    reorderGuide.style.width = axis === 'row' ? `${root.clientWidth}px` : '2px';
    reorderGuide.style.height = axis === 'column' ? `${root.clientHeight}px` : '2px';
    reorderBadge.textContent = allowed
      ? t(
          'Move {0} {1}{2} · {3} {4}',
          reorderDrag!.indices.length,
          t(axis),
          reorderDrag!.indices.length > 1 ? 's' : '',
          after ? t('after') : t('before'),
          last === first ? first + 1 : `${first + 1}–${last + 1}`,
        )
      : t('Moving here is disabled');
    reorderBadge.style.left = `${Math.max(4, Math.min(root.clientWidth - reorderBadge.offsetWidth - 4, event.clientX - origin.left + 14))}px`;
    reorderBadge.style.top = `${Math.max(4, Math.min(root.clientHeight - reorderBadge.offsetHeight - 4, event.clientY - origin.top + 14))}px`;
    reorderBadge.style.display = 'block';
    return { beforeIndex, allowed };
  }
  function startTouchReorder(event: PointerEvent, node: HTMLElement): void {
    if (!finishEdit(true)) return;
    event.preventDefault();
    event.stopPropagation();
    onPointerEnd();
    closeMenu();
    clearChoiceHover();
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
    root.setPointerCapture(event.pointerId);
    scroller.focus({ preventScroll: true });
    root.style.cursor = 'grabbing';
  }
  function updateTouchReorder(position: Pick<MouseEvent, 'clientX' | 'clientY'>): void {
    if (!touchReorder || !reorderDrag) return;
    if (
      !touchReorder.moved &&
      Math.hypot(position.clientX - touchReorder.startX, position.clientY - touchReorder.startY) < 6
    )
      return;
    touchReorder.moved = true;
    const bounds = scroller.getBoundingClientRect(),
      view = viewport();
    const hit = view.hitTest(
      Math.max(0, Math.min(view.width - 0.1, position.clientX - bounds.left)),
      Math.max(0, Math.min(view.height - 0.1, position.clientY - bounds.top)),
    );
    if (!hit) return;
    const rect = view.cellRect(hit.row, hit.col),
      index = reorderDrag.axis === 'row' ? hit.row : hit.col;
    touchReorder.beforeIndex = previewReorder(
      position,
      reorderDrag.axis,
      index,
      index,
      new win.DOMRect(bounds.left + rect.x, bounds.top + rect.y, rect.width, rect.height),
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
      if (options.canReorder?.(request) !== false) options.onReorder?.(request);
    } catch (error) {
      actionError.textContent = error instanceof Error ? t(error.message) : t('Unable to move items.');
      actionError.style.display = 'block';
    }
  }

  function reorderHandle(node: HTMLElement, axis: 'row' | 'column', first: number, last = first): void {
    if (!options.onReorder) return;
    const handle = node;
    handle.dataset.gridReorder = axis;
    handle.dataset.reorderFirst = String(first);
    handle.dataset.reorderLast = String(last);
    const selectedAxis = getSelectionRanges().some((range) =>
      axis === 'row'
        ? range.startColumn === 0 &&
          range.endColumn === columns.length - 1 &&
          first >= range.startRow &&
          last <= range.endRow
        : range.startRow === 0 &&
          range.endRow === rowCount - 1 &&
          first >= range.startColumn &&
          last <= range.endColumn,
    );
    handle.draggable = selectedAxis;
    if (selectedAxis) {
      handle.style.cursor = 'grab';
      handle.title = 'Drag selected items to move; Alt+arrow moves one position';
    }
    handle.addEventListener('dragstart', (event) => {
      if (!selectedAxis || !finishEdit(true)) {
        event.preventDefault();
        return;
      }
      const indices =
        first === last
          ? selectedAxisIndices(axis, first)
          : Array.from({ length: last - first + 1 }, (_, i) => first + i);
      reorderDrag = { axis, indices };
      reorderBadge.textContent = t('Move {0} {1}{2}', indices.length, t(axis), indices.length > 1 ? 's' : '');
      reorderBadge.style.display = 'block';
      reorderBadge.style.left = '8px';
      reorderBadge.style.top = '8px';
      root.style.cursor = 'grabbing';
      if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', t('Move {0}', t(axis)));
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setDragImage(reorderBadge, 16, 14);
      }
    });
    handle.addEventListener('keydown', (event) => {
      const backward = axis === 'row' ? 'ArrowUp' : 'ArrowLeft';
      const forward = axis === 'row' ? 'ArrowDown' : 'ArrowRight';
      if (!selectedAxis || !event.altKey || (event.key !== backward && event.key !== forward)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!finishEdit(true)) return;
      const beforeIndex =
        event.key === backward
          ? Math.max(0, first - 1)
          : Math.min(axis === 'row' ? rowCount : columns.length, last + 2);
      const request = Object.freeze({
        axis,
        indices: Object.freeze(Array.from({ length: last - first + 1 }, (_, i) => first + i)),
        beforeIndex,
      });
      try {
        if (options.canReorder?.(request) !== false) options.onReorder?.(request);
      } catch (error) {
        actionError.textContent = error instanceof Error ? t(error.message) : t('Unable to move items.');
        actionError.style.display = 'block';
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
      if (!(event.relatedTarget instanceof win.Node) || !node.contains(event.relatedTarget))
        reorderGuide.style.display = 'none';
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
        if (options.canReorder?.(request) === false) return;
        options.onReorder?.(request);
      } catch (error) {
        actionError.textContent = error instanceof Error ? t(error.message) : t('Unable to move items.');
        actionError.style.display = 'block';
      }
    });
  }

  function drawSelection(regions: readonly ViewportRegion[]): void {
    const selection = engine.getSelection();
    const original = getSelectionRanges();
    const ranges: SelectionRange[] = [];
    for (const axis of ['row', 'column'] as const) {
      const full = (range: SelectionRange) =>
        axis === 'row'
          ? range.startColumn === 0 && range.endColumn === columns.length - 1
          : range.startRow === 0 &&
            range.endRow === rowCount - 1 &&
            !(range.startColumn === 0 && range.endColumn === columns.length - 1);
      const start = axis === 'row' ? 'startRow' : 'startColumn';
      const end = axis === 'row' ? 'endRow' : 'endColumn';
      const merged: SelectionRange[] = [];
      for (const range of original
        .filter(full)
        .map((range) => ({ ...range }))
        .sort((a, b) => a[start] - b[start])) {
        const previous = merged.at(-1);
        if (previous && range[start] <= previous[end] + 1) previous[end] = Math.max(previous[end], range[end]);
        else merged.push(range);
      }
      ranges.push(...merged);
    }
    ranges.push(
      ...original.filter(
        (range) =>
          !(range.startColumn === 0 && range.endColumn === columns.length - 1) &&
          !(range.startRow === 0 && range.endRow === rowCount - 1),
      ),
    );
    if (!selection || !ranges.length) return;
    const activeScope = original.some(
      (range) =>
        selection.rowIndex >= range.startRow &&
        selection.rowIndex <= range.endRow &&
        selection.columnIndex >= range.startColumn &&
        selection.columnIndex <= range.endColumn &&
        ((range.startColumn === 0 && range.endColumn === columns.length - 1) ||
          (range.startRow === 0 && range.endRow === rowCount - 1)),
    );
    for (const region of regions) {
      context!.save();
      clipRegion(region);
      context!.strokeStyle = theme.selectionColor;
      context!.lineWidth = rangeBorderWidth;
      for (const range of ranges) {
        if (
          !activeScope &&
          range.startRow === range.endRow &&
          range.startColumn === range.endColumn &&
          range.startRow === selection.rowIndex &&
          range.startColumn === selection.columnIndex
        )
          continue;
        context!.strokeRect(
          columnAxis.position(range.startColumn) + region.offsetX + rangeBorderWidth / 2,
          headerHeight + rowAxis.position(range.startRow) + region.offsetY + rangeBorderWidth / 2,
          Math.max(
            0,
            columnAxis.position(range.endColumn + 1) - columnAxis.position(range.startColumn) - rangeBorderWidth,
          ),
          Math.max(0, rowAxis.position(range.endRow + 1) - rowAxis.position(range.startRow) - rangeBorderWidth),
        );
      }
      // Draw the active cell once in its own pane, above semantic cell colors.
      if (
        !activeScope &&
        (options.selectionStyle?.activeCellBorderInRange ||
          !getSelectionRanges().some(
            (range) =>
              (range.startRow !== range.endRow || range.startColumn !== range.endColumn) &&
              selection.rowIndex >= range.startRow &&
              selection.rowIndex <= range.endRow &&
              selection.columnIndex >= range.startColumn &&
              selection.columnIndex <= range.endColumn,
          )) &&
        !engine.getMerge(selection.rowIndex, selection.columnIndex) &&
        selection.rowIndex >= region.rows.start &&
        selection.rowIndex < region.rows.end &&
        selection.columnIndex >= region.columns.start &&
        selection.columnIndex < region.columns.end
      ) {
        const x = columnAxis.position(selection.columnIndex) + region.offsetX;
        const y = headerHeight + rowAxis.position(selection.rowIndex) + region.offsetY;
        const width = columnAxis.size(selection.columnIndex);
        const height = rowAxis.size(selection.rowIndex);
        context!.strokeStyle = theme.selectionColor;
        context!.lineWidth = activeBorderWidth;
        context!.strokeRect(
          x + activeBorderWidth / 2,
          y + activeBorderWidth / 2,
          Math.max(0, width - activeBorderWidth),
          Math.max(0, height - activeBorderWidth),
        );
      }
      context!.restore();
    }
  }

  function syncAccessibleCell(): void {
    const selection = engine.getSelection();
    activeRow.hidden = !selection;
    if (!selection) {
      activeCell.textContent = '';
      activeRow.removeAttribute('aria-rowindex');
      activeCell.removeAttribute('aria-colindex');
      activeCell.removeAttribute('aria-readonly');
      scroller.removeAttribute('aria-activedescendant');
      scroller.setAttribute('aria-label', viewportLabel);
      return;
    }
    const value = engine.getValue(selection.rowIndex, selection.columnKey);
    activeRow.setAttribute(
      'aria-rowindex',
      String(selection.rowIndex + (viewportAccessibility ? headers.levels + 1 : 1)),
    );
    activeCell.setAttribute('aria-colindex', String(selection.columnIndex + 1));
    const span = engine.getMerge(selection.rowIndex, selection.columnIndex);
    activeCell.setAttribute('aria-rowspan', String(span ? span.endRow - span.startRow + 1 : 1));
    activeCell.setAttribute('aria-colspan', String(span ? span.endColumn - span.startColumn + 1 : 1));
    activeCell.setAttribute('aria-readonly', String(!engine.canEdit(selection.rowIndex, selection.columnIndex)));
    const content = accessibleText(selection.rowIndex, selection.columnIndex, value);
    activeCell.setAttribute(
      'aria-description',
      [
        ...stateLabels(selection.rowIndex, selection.columnIndex).map((label) => t(label)),
        ...(linksForValue(
          value,
          selection.columnKey,
          engine.getFormat(selection.rowIndex, selection.columnIndex).contentFormat,
        ).length
          ? [t('Contains links. Alt+Enter opens links.')]
          : []),
      ].join('; '),
    );
    if (activeCell.textContent !== content) activeCell.textContent = content;
    scroller.setAttribute('aria-activedescendant', activeCell.id);
    scroller.setAttribute('aria-label', t('{0}: row {1}, {2}', viewportLabel, selection.rowIndex + 1, content));
    if (viewportAccessibility && accessibleCells.has(`${selection.rowIndex}:${selection.columnIndex}`)) {
      const node = accessibleCell(selection.rowIndex, selection.columnIndex, value);
      activeRow.hidden = true;
      scroller.setAttribute('aria-activedescendant', node.id);
    }
  }

  function render(): void {
    if (destroyed) return;
    syncAccessibleCell();
    const view = viewport();
    freezeVertical.hidden = !engine.frozenColumns || view.frozenWidth >= view.width;
    freezeVertical.style.left = `${indexWidth + Math.max(0, view.frozenWidth - 1)}px`;
    freezeVertical.style.top = '0px';
    freezeVertical.style.width = '2px';
    freezeVertical.style.height = `${headerHeight + view.height}px`;
    freezeHorizontal.hidden = !engine.frozenRows || view.frozenHeight >= view.height;
    freezeHorizontal.style.top = `${headerHeight + Math.max(0, view.frozenHeight - 1)}px`;
    freezeHorizontal.style.left = '0px';
    freezeHorizontal.style.height = '2px';
    freezeHorizontal.style.width = `${indexWidth + view.width}px`;
    // Show selected boundaries above the frozen seam without breaking the rest of the separator.
    for (const [line, axis, seam, offset] of [
      [freezeVertical, 'column', engine.frozenColumns, headerHeight],
      [freezeHorizontal, 'row', engine.frozenRows, indexWidth],
    ] as const) {
      const segments: string[] = [];
      for (const range of getSelectionRanges()) {
        const first = axis === 'column' ? range.startColumn : range.startRow,
          last = axis === 'column' ? range.endColumn : range.endRow;
        if (first !== seam && last + 1 !== seam) continue;
        for (const region of view.regions) {
          const start =
            axis === 'column'
              ? Math.max(range.startRow, region.rows.start)
              : Math.max(range.startColumn, region.columns.start);
          const end =
            axis === 'column'
              ? Math.min(range.endRow + 1, region.rows.end)
              : Math.min(range.endColumn + 1, region.columns.end);
          if (start >= end) continue;
          const layout = axis === 'column' ? rowAxis : columnAxis,
            shift = axis === 'column' ? region.offsetY : region.offsetX;
          const clipStart = axis === 'column' ? region.clip.y : region.clip.x,
            clipEnd = clipStart + (axis === 'column' ? region.clip.height : region.clip.width);
          const from = offset + Math.max(clipStart, layout.position(start) + shift),
            to = offset + Math.min(clipEnd, layout.position(end) + shift);
          if (to > from)
            segments.push(
              `linear-gradient(${axis === 'column' ? 'to bottom' : 'to right'},transparent ${from}px,var(--acheron-selection-color) ${from}px,var(--acheron-selection-color) ${to}px,transparent ${to}px)`,
            );
        }
      }
      line.style.background = segments.length
        ? segments.join(',') + ',var(--acheron-freeze-color)'
        : 'var(--acheron-freeze-color)';
    }
    endResize();
    positionEditor();
    const range = getSelectionRange();
    selectionHandles.forEach((button, i) => {
      button.hidden = (!touchSelection && i === 0) || !range || !!editor;
      if (button.hidden || !range) return;
      const size = touchSelection ? 20 : 10;
      const half = size / 2;
      button.style.width = button.style.height = `${size}px`;
      button.style.borderRadius = touchSelection ? '50%' : '0';
      button.style.borderWidth = touchSelection ? '3px' : '2px';
      const rect = view.cellRect(
        i === 0 ? range.startRow : range.endRow,
        i === 0 ? range.startColumn : range.endColumn,
      );
      const x = rect.x + (i ? rect.width : 0);
      const y = rect.y + (i ? rect.height : 0);
      button.hidden =
        x < rect.clip.x || x > rect.clip.x + rect.clip.width || y < rect.clip.y || y > rect.clip.y + rect.clip.height;
      button.style.left = `${indexWidth + Math.max(half, Math.min(view.width - half, x)) - half}px`;
      button.style.top = `${headerHeight + Math.max(half, Math.min(view.height - half, y)) - half}px`;
    });
    closeMenu();
    fullDraw = true;
    schedule();
  }
  function schedule(): void {
    if (!destroyed && frame === undefined) frame = win.requestAnimationFrame(draw);
  }
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
  function onDoubleClick(event: MouseEvent): void {
    const cell = pointerCell(event);
    if (cell && openMedia(cell.row, cell.col)) return;
    const selection = engine.getSelection();
    if (cell && columnEditors.get(columns[cell.col]!.key)?.type === 'checkbox') return;
    if (
      event.target !== editor &&
      cell &&
      selection?.rowIndex === cell.row &&
      selection.columnIndex === cell.col &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    )
      beginEdit();
  }
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
      return frame;
    },
    set frame(value) {
      frame = value;
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
    if (editor || destroyed) throw new Error('Save or cancel the editor before changing structure.');
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
      if (editor) throw new Error('Finish editing before restoring state.');
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
      if (editor && engine.getSelection()?.columnKey === key) finishEdit(false);
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
      measuredRows.clear();
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
      if (choices) {
        disposeChoicePanel(choices);
        choices.remove();
      }
      choices = null;
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
      dirty.clear();
      const input = editor;
      editor = null;
      richEditor?.remove();
      richEditor = null;
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
      if (frame !== undefined) win.cancelAnimationFrame(frame);
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

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
          measuredRows.clear();
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
      return measuredRows;
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
      return rowLockCache;
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
    if (editors.editor) throw new Error('Finish editing before updating cells.');
    engine.updateCells(updates);
  }

  function replay(redo: boolean): boolean {
    if (destroyed || editors.editor) return false;
    return redo ? engine.redo() : engine.undo();
  }

  const getSelection = engine.getSelection;
  const getSelectionRange = engine.getSelectionRange;
  const getSelectionRanges = engine.getSelectionRanges;

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
      editors.hoveredChoice?.row === rowIndex &&
      editors.hoveredChoice.col === columnIndex &&
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

  function clipRegion(region: ViewportRegion): void {
    const clip = region.clip;
    context!.beginPath();
    context!.rect(clip.x, headerHeight + clip.y, clip.width, clip.height);
    context!.clip();
  }

  function draw(): void {
    rowLockCache.clear();
    frame = undefined;
    if (destroyed) return;
    if (options.autoRowHeight && !editors.editor && !interaction.resizing)
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
      for (const key of accessibility.accessibleCells.keys())
        if (!seenCells.has(key)) accessibility.accessibleCells.delete(key);
      accessibleBody.replaceChildren(...[...accessibleRows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row));
      const selection = engine.getSelection();
      const node = selection && accessibility.accessibleCells.get(`${selection.rowIndex}:${selection.columnIndex}`);
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
      button.hidden = (!interaction.touchSelection && i === 0) || !range || !!editors.editor;
      if (button.hidden || !range) return;
      const size = interaction.touchSelection ? 20 : 10;
      const half = size / 2;
      button.style.width = button.style.height = `${size}px`;
      button.style.borderRadius = interaction.touchSelection ? '50%' : '0';
      button.style.borderWidth = interaction.touchSelection ? '3px' : '2px';
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
      dirty.clear();
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

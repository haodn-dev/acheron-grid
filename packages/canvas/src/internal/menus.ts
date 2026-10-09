import type {
  CellFormatPatch,
  CellFormatTarget,
  CellLockTarget,
  ClipboardBlock,
  GridEngine,
  LocalViewOptions,
  NumberFormat,
  PasteOptions,
  SelectionRange,
} from '@acheron-grid/core';
import { encodeBlocks } from '@acheron-grid/core';
import type { ColumnEditor, ColumnType } from '../grid.js';
import { icons } from '../icons.js';
import type { CellLink } from '../links.js';
import type { RowChangeRequest } from '../reorder.js';
import { validateColumnEditor } from './editor-config.js';
import { createEditors } from './editors.js';
import type { GridContext } from './grid-context.js';
import { createInteraction } from './interaction.js';
import { createOverlay } from './overlay.js';

interface MenusContext
  extends
    Readonly<Pick<GridContext['layout'], 'columns' | 'headerHeight' | 'indexWidth' | 'rowCount'>>,
    Pick<GridContext['layout'], 'currentView'>,
    Readonly<Pick<GridContext['runtime'], 'destroyed'>>,
    Pick<GridContext['env'], 'doc' | 't' | 'win'>,
    Pick<GridContext, 'engine' | 'options'> {
  readonly actionError: HTMLDivElement;
  readonly animateLayout: <T>(run: () => T, axis: 'row' | 'column' | 'auto') => T;
  readonly autoFitColumn: (index: number) => void;
  readonly autoFitRow: (index: number) => void;
  readonly beginEdit: () => void;
  readonly cellLinks: (row: number, col: number) => CellLink[];
  readonly closeMenu: (focus?: boolean) => void;
  readonly columnAxis: GridEngine['columnsLayout'];
  readonly columnEditors: Map<string, ColumnEditor>;
  readonly creationTypes: readonly ColumnType[];
  readonly editors: ReturnType<typeof createEditors>;
  readonly enterSurface: (node: HTMLElement) => void;
  readonly finishEdit: (commit: boolean) => boolean;
  readonly freezeHorizontal: HTMLDivElement;
  readonly freezeVertical: HTMLDivElement;
  readonly getSelectionRange: () => SelectionRange | null;
  readonly getSelectionRanges: () => SelectionRange[];
  readonly groupRows: (start: number, end: number) => string;
  readonly headerColumn: (event: MouseEvent) => number | null;
  readonly htmlClipboardBlocks: (html: string) => ClipboardBlock[];
  readonly indexRow: (event: MouseEvent) => number | null;
  readonly interaction: ReturnType<typeof createInteraction>;
  readonly lockNotice: HTMLDivElement;
  lockNoticeTimer: number | undefined;
  readonly managesView: boolean;
  readonly motionDuration: number;
  readonly motionEnabled: () => boolean;
  readonly openLinks: (row: number, col: number, x: number, y: number, focus?: boolean) => void;
  readonly overlay: ReturnType<typeof createOverlay>;
  readonly paste: (text: string, pasteOptions?: PasteOptions) => void;
  readonly pasteSelectionBlocks: (text: string, pasteOptions?: PasteOptions) => void;
  readonly pointerCell: (
    event: Pick<MouseEvent, 'clientX' | 'clientY'>,
    clamp?: boolean,
  ) => { row: number; col: number } | null;
  readonly render: () => void;
  readonly replay: (redo: boolean) => boolean;
  readonly resizeAxis: (
    axis: Readonly<{
      size: (i: number) => number;
      position: (i: number) => number;
      indexAt: (offset: number) => number;
      range: (offset: number, extent: number) => { start: number; end: number };
    }>,
    index: number,
    size: number,
  ) => void;
  readonly root: HTMLDivElement;
  readonly rowAxis: GridEngine['rows'];
  readonly rowLockCache: Map<number, boolean>;
  readonly scroller: HTMLDivElement;
  readonly select: (rowIndex: number, columnIndex: number, extend?: boolean, reveal?: boolean, add?: boolean) => void;
  readonly selectColumn: (index: number) => void;
  readonly selectRow: (index: number) => void;
  readonly selectedAxisIndices: (axis: 'row' | 'column', index: number) => number[];
  readonly structureAction: <T>(run: () => T, axis?: 'row' | 'column') => T;
  readonly svgIcon: (name: keyof typeof icons, size?: number) => Element;
  readonly writeClipboard: (cut?: boolean) => Promise<void>;
}

export function createMenus(context: MenusContext) {
  let suggestionsEnabled = context.options.contextMenuSuggestions ?? false;
  let createdColumn = 0;
  function openSizeDialog(
    label: string,
    current: number,
    apply: (size: number) => void,
    units: string | null = 'px',
  ): void {
    const dialog = context.doc.createElement('dialog');
    context.overlay.activeDialog?.remove();
    context.overlay.activeDialog = dialog;
    dialog.setAttribute('aria-label', label);
    dialog.dataset.gridDialog = '';
    const form = context.doc.createElement('form');
    const fieldLabel = context.doc.createElement('label');
    fieldLabel.textContent = `${label}${units ? ` (${units})` : ''} `;
    const input = context.doc.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = units ? 'any' : '1';
    input.required = true;
    input.value = String(current);

    fieldLabel.append(input);
    const save = context.doc.createElement('button');
    save.type = 'submit';
    save.textContent = context.t('Apply');
    const cancel = context.doc.createElement('button');
    cancel.type = 'button';
    cancel.textContent = context.t('Cancel');

    cancel.addEventListener('click', () => dialog.close());
    input.addEventListener('input', () => input.setCustomValidity(''));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        apply(input.valueAsNumber);
        dialog.close();
      } catch (error) {
        input.setCustomValidity(error instanceof Error ? context.t(error.message) : context.t('Invalid size.'));
        input.reportValidity();
      }
    });
    const actions = context.doc.createElement('div');
    actions.dataset.dialogActions = '';
    actions.append(save, cancel);
    form.append(fieldLabel, actions);
    dialog.append(form);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (context.overlay.activeDialog === dialog) context.overlay.activeDialog = null;
      if (!context.destroyed && !context.editors.editor) context.scroller.focus({ preventScroll: true });
    });
    context.root.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  }

  function format(targets: readonly CellFormatTarget[], patch: CellFormatPatch | null): void {
    if (context.destroyed) throw new Error('Grid is destroyed.');
    if (context.editors.editor) throw new Error('Finish editing before changing formatting.');
    context.engine.format(targets, patch);
  }

  function openFormatDialog(row: number, col: number): void {
    const ranges = context.getSelectionRanges();
    const dialog = context.doc.createElement('dialog');
    context.overlay.activeDialog?.remove();
    context.overlay.activeDialog = dialog;
    dialog.setAttribute('aria-label', context.t('Format cells'));
    dialog.dataset.gridDialog = '';
    const form = context.doc.createElement('form');
    const scopeLabel = context.doc.createElement('label');
    scopeLabel.textContent = context.t('Apply to ');
    const scope = context.doc.createElement('select');
    for (const [value, label] of [
      ['selection', context.t('Selected cells')],
      ['row', context.t('This row')],
      ['column', context.t('This column')],
      ['table', context.t('Whole table')],
    ]) {
      const option = context.doc.createElement('option');
      option.value = value!;
      option.textContent = label!;
      scope.append(option);
    }
    scopeLabel.append(scope);
    form.append(scopeLabel);
    function field(label: string, value: string, checked: boolean) {
      const line = context.doc.createElement('div');
      line.style.cssText = 'display:flex;gap:12px;align-items:center;margin:16px 0';
      const apply = context.doc.createElement('input');
      apply.type = 'checkbox';
      apply.checked = checked;
      const applyLabel = context.doc.createElement('label');
      applyLabel.append(apply, context.t(' Change {0}', label.toLowerCase()));
      const color = context.doc.createElement('input');
      color.type = 'color';
      color.value = value;
      color.setAttribute('aria-label', label);
      line.append(applyLabel, color);
      form.append(line);
      return { apply, color };
    }
    const background = field(context.t('Background color'), '#fff4b3', true);
    const text = field(context.t('Text color'), '#0f172a', false);
    const numberApply = context.doc.createElement('input');
    numberApply.type = 'checkbox';
    const numberSelect = context.doc.createElement('select');
    numberSelect.setAttribute('aria-label', context.t('Number format'));
    for (const [value, label] of [
      ['decimal', context.t('Decimal')],
      ['integer', context.t('Integer')],
      ['percent', context.t('Percent')],
      ['currency', context.t('Currency')],
    ]) {
      const option = context.doc.createElement('option');
      option.value = value!;
      option.textContent = label!;
      numberSelect.append(option);
    }
    const numberLabel = context.doc.createElement('label');
    numberLabel.append(numberApply, context.t(' Change number format '), numberSelect);
    form.append(numberLabel);
    const error = context.doc.createElement('div');
    error.setAttribute('role', 'alert');
    error.style.cssText = 'color:#9f1239;margin-bottom:12px';
    error.hidden = true;
    const save = context.doc.createElement('button');
    save.type = 'submit';
    save.textContent = context.t('Apply');
    const clear = context.doc.createElement('button');
    clear.type = 'button';
    clear.textContent = context.t('Clear formatting');
    const cancel = context.doc.createElement('button');
    cancel.type = 'button';
    cancel.textContent = context.t('Cancel');

    function targets(): CellFormatTarget[] {
      if (scope.value === 'row') return [{ scope: 'row', rowIndex: row }];
      if (scope.value === 'column') return [{ scope: 'column', columnIndex: col }];
      if (scope.value === 'table') return [{ scope: 'table' }];
      return ranges.map((range) => ({ scope: 'range', range }));
    }
    function checkPermission(): void {
      const allowed = context.engine.canFormat(targets());
      save.disabled = clear.disabled = !allowed;
      error.hidden = allowed;
      error.textContent = allowed ? '' : context.t('Formatting is not allowed for this selection.');
    }
    function apply(patch: CellFormatPatch): void {
      try {
        format(targets(), patch);
        dialog.close();
      } catch (failure) {
        error.textContent = failure instanceof Error ? context.t(failure.message) : context.t('Formatting failed.');
        error.hidden = false;
      }
    }
    scope.addEventListener('change', checkPermission);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!background.apply.checked && !text.apply.checked && !numberApply.checked) {
        error.textContent = context.t('Choose a format to change.');
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
      if (context.overlay.activeDialog === dialog) context.overlay.activeDialog = null;
      if (!context.destroyed && !context.editors.editor) context.scroller.focus({ preventScroll: true });
    });
    const actions = context.doc.createElement('div');
    actions.dataset.dialogActions = '';
    actions.append(save, clear, cancel);
    form.append(error, actions);
    dialog.append(form);
    context.root.append(dialog);
    checkPermission();
    dialog.showModal();
    scope.focus();
  }

  function setLocked(target: CellLockTarget, locked: boolean): void {
    if (context.destroyed) throw new Error('Grid is destroyed.');
    if (context.editors.editor) throw new Error('Finish editing before changing locks.');
    const wasLocked = context.engine.isLocked(target);
    context.engine.setLocked(target, locked);
    context.rowLockCache.clear();
    if (target.scope === 'table') {
      context.win.clearTimeout(context.lockNoticeTimer);
      context.lockNotice.getAnimations().forEach((animation) => animation.cancel());
      context.lockNotice.hidden = true;
      if (locked && !wasLocked && context.options.tableLockNotice !== false) {
        context.lockNotice.hidden = false;
        if (context.motionEnabled())
          context.lockNotice.animate(
            [
              { opacity: 0, transform: 'translateY(2px)' },
              { opacity: 1, transform: 'translateY(0)', offset: 0.045 },
              { opacity: 1, offset: 0.95 },
              { opacity: 0 },
            ],
            { duration: 4000, easing: 'ease-out' },
          );
        context.lockNoticeTimer = context.win.setTimeout(() => {
          context.lockNotice.hidden = true;
        }, 4000);
      }
    }
  }

  function setFrozen(rows: number, columns: number): void {
    if (context.destroyed) throw new Error('Grid is destroyed.');
    if (context.editors.editor) throw new Error('Finish editing before changing frozen panes.');
    const axis = rows !== context.engine.frozenRows ? 'row' : 'column';
    context.animateLayout(() => context.engine.setFrozen(rows, columns), axis);
    if (context.motionEnabled())
      for (const [line, scale] of [
        [context.freezeVertical, 'scaleY'],
        [context.freezeHorizontal, 'scaleX'],
      ] as const)
        if (!line.hidden) {
          line.style.transformOrigin = 'top left';
          line.animate(
            [
              { opacity: 0, transform: `${scale}(0)` },
              { opacity: 1, transform: `${scale}(1)` },
            ],
            { duration: context.motionDuration, easing: 'cubic-bezier(.22,1,.36,1)' },
          );
        }
  }

  function changeRows(request: Readonly<RowChangeRequest>): void {
    if (!context.finishEdit(true)) return;
    if (context.options.canRowChange?.(request) === false) throw new Error('Changing rows is disabled.');
    context.options.onRowChange?.(request);
  }

  function openMenu(row: number, col: number, x: number, y: number, header = false): void {
    context.closeMenu();
    const range = context.getSelectionRange();
    if (
      context.rowCount &&
      !context
        .getSelectionRanges()
        .some(
          (range) => row >= range.startRow && row <= range.endRow && col >= range.startColumn && col <= range.endColumn,
        )
    )
      context.select(row, col, false, false);
    if (context.destroyed || (context.rowCount > 0 && !context.engine.getCellPermission(row, col).selectable)) return;
    header ||=
      context.interaction.axisAnchor?.axis === 'column' &&
      context
        .getSelectionRanges()
        .some(
          (range) =>
            range.startRow === 0 &&
            range.endRow === context.rowCount - 1 &&
            col >= range.startColumn &&
            col <= range.endColumn,
        );
    const selection =
      context.engine.getSelection() ??
      (header || (!context.rowCount && context.options.onRowChange)
        ? { rowIndex: 0, columnIndex: col, columnKey: context.columns[col]!.key, rowId: 0 }
        : null);
    if (!selection) return;
    const popup = context.doc.createElement('div');
    context.overlay.menu = popup;
    popup.dataset.gridMenuRow = String(row);
    popup.dataset.gridMenuColumn = String(col);
    popup.dataset.gridMenuHeader = String(header);
    popup.popover = 'auto';
    popup.setAttribute('role', 'menu');
    popup.setAttribute('aria-label', header ? context.t('Column actions') : context.t('Cell actions'));
    popup.className = 'acheron-context-menu';
    popup.style.cssText =
      'position:fixed;margin:0;padding:6px;min-width:200px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;border:1px solid var(--acheron-grid-line-color);border-radius:10px;box-shadow:0 12px 32px #0003;background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font)';
    const style = context.doc.createElement('style');
    style.textContent =
      '.acheron-context-menu [hidden]{display:none!important}.acheron-context-menu button{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:4px;background:transparent;text-align:left;color:inherit;font:inherit;cursor:pointer;outline:none}.acheron-context-menu button:hover:not(:disabled),.acheron-context-menu button:focus-visible{background:var(--acheron-header-background)}.acheron-context-menu button:focus-visible{box-shadow:inset 0 0 0 2px var(--acheron-selection-color)}.acheron-context-menu button:disabled{opacity:.45;cursor:default}.acheron-context-menu svg{flex:none;color:var(--acheron-icon-color)}.acheron-context-menu [role=separator]{height:1px;background:var(--acheron-grid-line-color);margin:5px 4px}';
    popup.append(style);
    style.textContent +=
      '.acheron-context-menu:popover-open{display:grid;gap:2px}.acheron-context-menu:not(:popover-open){display:none}';
    popup.addEventListener('toggle', () => {
      if (!popup.matches(':popover-open') && context.overlay.menu === popup) context.closeMenu();
    });
    const filter = context.doc.createElement('input');
    filter.type = 'search';
    filter.hidden = true;
    filter.placeholder = context.t('Filter actions…');
    filter.setAttribute('aria-label', context.t('Filter actions'));
    filter.style.cssText =
      'position:sticky;top:0;width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--acheron-grid-line-color);border-radius:4px;background:var(--acheron-background);color:inherit;font:inherit;outline:none';
    popup.append(filter);
    const empty = context.doc.createElement('div');
    empty.textContent = context.t('No matching actions');
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
        : context.interaction.axisAnchor?.axis === 'row'
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
        if (child instanceof context.win.HTMLButtonElement && !child.hidden) {
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
        popup.style.left = `${Math.max(8, Math.min(x, context.win.innerWidth - popup.offsetWidth - 8))}px`;
        popup.style.top = `${Math.max(8, Math.min(y, context.win.innerHeight - popup.offsetHeight - 8))}px`;
      }
    }
    filter.addEventListener('input', filterActions);
    const fingerprint = JSON.stringify(context.getSelectionRanges());
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
      const button = context.doc.createElement('button');
      button.type = 'button';
      const [, name, group] = menuIcons.find(([prefix]) => label.startsWith(prefix)) ?? ['', 'square-pen', 'editing'];
      if (previousGroup && group !== previousGroup) {
        const separator = context.doc.createElement('div');
        separator.setAttribute('role', 'separator');
        popup.append(separator);
      }
      previousGroup = group;
      button.dataset.group = group;
      button.append(context.svgIcon(name), context.doc.createTextNode(context.t(label)));
      button.dataset.action = label;
      button.setAttribute('role', 'menuitem');
      button.disabled = !enabled;
      button.addEventListener('click', async () => {
        context.closeMenu(true);
        context.actionError.style.display = 'none';
        try {
          await action();
        } catch (error) {
          if (!context.destroyed) {
            context.actionError.textContent = `${error instanceof Error ? context.t(error.message) : context.t('Action failed.')}${label === 'Copy' || label === 'Cut' || label.startsWith('Paste') ? context.t(' Use Ctrl/Cmd+C or Ctrl/Cmd+V if the browser blocks menu clipboard access.') : ''}`;
            context.actionError.style.display = 'block';
          }
        }
      });
      popup.append(button);
    }
    item(
      'Copy',
      context.rowCount > 0 &&
        context.getSelectionRanges().length > 0 &&
        context.engine.getCellPermission(selection.rowIndex, selection.columnIndex).copyable &&
        !!context.win.navigator.clipboard?.writeText,
      context.writeClipboard,
    );
    item(
      'Cut',
      context.rowCount > 0 &&
        context.getSelectionRanges().length > 0 &&
        context.engine.canEdit(selection.rowIndex, selection.columnIndex) &&
        !!context.win.navigator.clipboard?.writeText,
      () => context.writeClipboard(true),
    );
    const readClipboard = async (pasteOptions?: PasteOptions) => {
      let text = '',
        html = '';
      if (context.win.navigator.clipboard.read) {
        const items = await context.win.navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
          if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
        }
      } else text = await context.win.navigator.clipboard.readText();
      if (context.destroyed || fingerprint !== JSON.stringify(context.getSelectionRanges()))
        throw new Error('Selection changed before paste. Try again.');
      if (html) context.pasteSelectionBlocks(encodeBlocks(context.htmlClipboardBlocks(html)), pasteOptions);
      else context.paste(text, pasteOptions);
    };
    item('Paste', !!context.win.navigator.clipboard?.readText && context.engine.canPaste(), () => readClipboard());
    item('Paste values only', !!context.win.navigator.clipboard?.readText && context.engine.canPaste(), () =>
      readClipboard({ mode: 'values' }),
    );
    item(
      'Paste formats only',
      !!context.win.navigator.clipboard?.readText &&
        context.engine.canFormat(context.getSelectionRanges().map((range) => ({ scope: 'range' as const, range }))),
      () => readClipboard({ mode: 'formats' }),
    );
    item('Paste transposed', !!context.win.navigator.clipboard?.readText && context.engine.canPaste(), () =>
      readClipboard({ transpose: true }),
    );
    item('Paste skipping empty cells', !!context.win.navigator.clipboard?.readText && context.engine.canPaste(), () =>
      readClipboard({ skipEmpty: true }),
    );
    if (header) {
      item('Select column', true, () => context.selectColumn(col));
      item('Sort ascending…', context.managesView || !!context.options.onViewChange, () => openViewDialog(col, 'asc'));
      item('Sort descending…', context.managesView || !!context.options.onViewChange, () =>
        openViewDialog(col, 'desc'),
      );
      item('Filter column…', context.managesView || !!context.options.onViewChange, () => openViewDialog(col));
      item('Clear sort and filters…', context.managesView || !!context.options.onViewChange, () =>
        openViewDialog(col, 'clear'),
      );
    } else {
      item('Select row', context.rowCount > 0, () => context.selectRow(row));
      item('Select column', true, () => context.selectColumn(col));
    }
    item(header ? 'Hide selected columns' : 'Hide selected rows', !context.engine.isLocked({ scope: 'table' }), () => {
      if (header)
        context.structureAction(
          () => context.engine.setColumnsHidden(context.selectedAxisIndices('column', col), true),
          'column',
        );
      else
        context.structureAction(
          () => context.engine.setRowsHidden(context.selectedAxisIndices('row', row), true),
          'row',
        );
    });
    item('Show all hidden rows', context.engine.getHiddenRows().length > 0, () =>
      context.structureAction(() => context.engine.setRowsHidden(context.engine.getHiddenRows(), false), 'row'),
    );
    item(
      'Show all hidden columns',
      context.columns.some((_, i) => context.engine.isColumnHidden(i)),
      () =>
        context.structureAction(
          () => context.engine.setColumnsHidden(context.engine.getHiddenColumns(), false),
          'column',
        ),
    );
    const indices = context.selectedAxisIndices(header ? 'column' : 'row', header ? col : row);
    if (!header && context.rowCount) {
      const selected = context.getSelectionRanges(),
        span = selected.length === 1 ? selected[0] : undefined;
      item('Merge cells', !!span && context.engine.canMerge(span), () => {
        if (span) context.structureAction(() => context.engine.mergeCells(span));
      });
      const affected = span
        ? context.engine
            .getMergedCells()
            .filter(
              (merge) =>
                merge.startRow <= context.engine.getRowSourceIndex(span.endRow) &&
                merge.endRow >= context.engine.getRowSourceIndex(span.startRow) &&
                merge.startColumn <= span.endColumn &&
                merge.endColumn >= span.startColumn,
            )
        : [];
      item(
        'Unmerge cells',
        affected.length > 0 && affected.every((range) => context.engine.canChangeLayout({ kind: 'unmerge', range })),
        () => {
          if (span) context.structureAction(() => context.engine.unmergeCells(span));
        },
      );
      const wholeRows =
        !!span &&
        span.startColumn === 0 &&
        span.endColumn === context.columns.length - 1 &&
        span.endRow > span.startRow;
      item(
        'Group selected rows',
        wholeRows &&
          !context.engine.getRowGroups().some((group) => group.collapsed) &&
          !context.engine.view.sort &&
          !context.engine.view.sorts?.length &&
          !context.engine.view.filters?.length &&
          !!span &&
          context.engine.canChangeLayout({
            kind: 'group',
            group: { id: '', startRow: span.startRow, endRow: span.endRow, collapsed: false },
          }),
        () => {
          if (span) context.groupRows(span.startRow, span.endRow);
        },
      );
      const sourceRow = context.engine.getRowSourceIndex(row),
        rowGroups = context.engine
          .getRowGroups()
          .filter((group) => sourceRow >= group.startRow && sourceRow <= group.endRow)
          .sort((a, b) => a.endRow - a.startRow - (b.endRow - b.startRow));
      const group = rowGroups[0];
      if (group) {
        item(
          group.collapsed ? 'Expand row group' : 'Collapse row group',
          context.engine.canChangeLayout({ kind: group.collapsed ? 'expand' : 'collapse', group }),
          () => context.structureAction(() => context.engine.setGroupCollapsed(group.id, !group.collapsed), 'row'),
        );
        item('Ungroup rows', context.engine.canChangeLayout({ kind: 'ungroup', group }), () =>
          context.structureAction(() => context.engine.ungroupRows(group.id)),
        );
      }
    }
    if (!header && context.options.onRowChange) {
      const above = Object.freeze({ kind: 'insert' as const, beforeIndex: indices[0]!, count: 1 });
      const below = Object.freeze({
        kind: 'insert' as const,
        beforeIndex: context.rowCount ? indices[indices.length - 1]! + 1 : 0,
        count: 1,
      });
      const deletion = Object.freeze({ kind: 'delete' as const, indices: Object.freeze(indices) });
      item('Insert row above', context.options.canRowChange?.(above) !== false, () => changeRows(above));
      item('Insert row below', context.options.canRowChange?.(below) !== false, () => changeRows(below));
      item('Insert rows…', context.options.canRowChange?.(above) !== false, () =>
        openSizeDialog(
          context.t('Number of rows'),
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
        context.rowCount > 0 && context.options.canRowChange?.(deletion) !== false,
        () => changeRows(deletion),
      );
    }
    if (header && context.options.allowColumnChanges) {
      const request = {
        axis: 'column' as const,
        kind: 'insert' as const,
        indices: [],
        beforeIndex: indices[0]!,
        count: 1,
      };
      item('Insert column left…', context.engine.canChangeStructure(request), () => openColumnDialog(indices[0]!));
      item(
        'Insert column right…',
        context.engine.canChangeStructure({ ...request, beforeIndex: indices.at(-1)! + 1 }),
        () => openColumnDialog(indices.at(-1)! + 1),
      );
      item(
        indices.length > 1 ? 'Delete ' + indices.length + ' selected columns' : 'Delete column',
        indices.length < context.columns.length &&
          context.engine.canChangeStructure({
            axis: 'column',
            kind: 'delete',
            indices,
            beforeIndex: indices[0]!,
            count: indices.length,
          }),
        () => context.engine.deleteColumns(indices),
      );
    }
    if (context.options.onReorder)
      item(
        header ? 'Move columns to…' : 'Move rows to…',
        (header || context.rowCount > 0) &&
          context.options.canReorder?.({ axis: header ? 'column' : 'row', indices, beforeIndex: indices[0]! }) !==
            false,
        () => {
          const axis = header ? 'column' : 'row';
          const count = header ? context.columns.length : context.rowCount;
          openSizeDialog(
            header ? context.t('Destination column') : context.t('Destination row'),
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
              if (context.options.canReorder?.(request) === false) throw new Error('Moving items is disabled.');
              context.options.onReorder?.(request);
            },
            null,
          );
        },
      );
    if (!header && context.rowCount && context.cellLinks(row, col).length)
      item('Open links…', context.options.allowOpenLinks !== false, () => context.openLinks(row, col, x, y));
    item(
      'Edit cell',
      context.rowCount > 0 && context.engine.canEdit(selection.rowIndex, selection.columnIndex),
      context.beginEdit,
    );
    item('Undo', context.engine.canUndo(), () => {
      context.replay(false);
    });
    item('Redo', context.engine.canRedo(), () => {
      context.replay(true);
    });
    item(
      'Format cells…',
      context.rowCount > 0 &&
        context.engine.canFormat(context.getSelectionRanges().map((range) => ({ scope: 'range', range }))),
      () => openFormatDialog(row, col),
    );
    const lockRanges = context.getSelectionRanges();
    const selectedCellsLocked = lockRanges.every((range) => {
      for (let r = range.startRow; r <= range.endRow; r++)
        for (let c = range.startColumn; c <= range.endColumn; c++)
          if (!context.engine.isLocked({ scope: 'cell', rowIndex: r, columnIndex: c })) return false;
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
      ['row', context.selectedAxisIndices('row', row).map((rowIndex) => ({ scope: 'row', rowIndex }))],
      ['column', context.selectedAxisIndices('column', col).map((columnIndex) => ({ scope: 'column', columnIndex }))],
      ['table', [{ scope: 'table' }]],
    ];
    for (const [label, targets] of lockTargets) {
      if (!targets.length || (!context.rowCount && (label === 'row' || label.includes('cell')))) continue;
      const locked = label.includes('cell')
        ? selectedCellsLocked
        : targets.every((target) => context.engine.isLocked(target));
      const name =
        targets.length > 1 && (label === 'row' || label === 'column')
          ? context.t('{0} selected {1}s', targets.length, context.t(label))
          : context.t(label);
      item(`${locked ? 'Unlock' : 'Lock'} ${name}`, context.engine.canManageLocks(), () => {
        if (label.includes('cell')) {
          for (const range of lockRanges)
            for (let r = range.startRow; r <= range.endRow; r++)
              for (let c = range.startColumn; c <= range.endColumn; c++)
                setLocked({ scope: 'cell', rowIndex: r, columnIndex: c }, !locked);
        } else for (const target of targets) setLocked(target, !locked);
      });
    }
    if (context.rowCount > 0 && !context.engine.getCellPermission(row, col).writable)
      item('Cell is read-only', false, () => {});
    const rowsFit = context.rowCount > 0 && context.rowAxis.position(row + 1) < context.scroller.clientHeight;
    const columnsFit = context.columnAxis.position(col + 1) < context.scroller.clientWidth;
    item('Freeze rows through this row', rowsFit && context.engine.frozenRows !== row + 1, () =>
      setFrozen(row + 1, context.engine.frozenColumns),
    );
    item('Freeze columns through this column', columnsFit && context.engine.frozenColumns !== col + 1, () =>
      setFrozen(context.engine.frozenRows, col + 1),
    );
    item(
      'Freeze through this cell',
      rowsFit && columnsFit && (context.engine.frozenRows !== row + 1 || context.engine.frozenColumns !== col + 1),
      () => setFrozen(row + 1, col + 1),
    );
    item('Unfreeze rows', context.engine.frozenRows > 0, () => setFrozen(0, context.engine.frozenColumns));
    item('Unfreeze columns', context.engine.frozenColumns > 0, () => setFrozen(context.engine.frozenRows, 0));
    item('Unfreeze table', context.engine.frozenRows > 0 || context.engine.frozenColumns > 0, () => setFrozen(0, 0));
    item('Auto-fit column', true, () => context.autoFitColumn(col));
    item('Auto-fit row', context.rowCount > 0, () => context.autoFitRow(row));
    item('Resize column…', true, () =>
      openSizeDialog(context.t('Column width'), context.columnAxis.size(col), (size) =>
        context.resizeAxis(context.columnAxis, col, size),
      ),
    );
    item('Resize row…', context.rowCount > 0, () =>
      openSizeDialog(context.t('Row height'), context.rowAxis.size(row), (size) =>
        context.resizeAxis(context.rowAxis, row, size),
      ),
    );
    const mode = context.doc.createElement('button');
    mode.type = 'button';
    mode.setAttribute('role', 'menuitemcheckbox');
    mode.textContent = context.t('Suggested actions');
    mode.setAttribute('aria-checked', String(suggestionsEnabled));
    mode.setAttribute('aria-label', context.t('Suggested actions'));
    mode.textContent = context.t('Suggested actions: ') + (suggestionsEnabled ? context.t('On') : context.t('Off'));
    mode.addEventListener('click', () => {
      mode.focus();
      suggestionsEnabled = !suggestionsEnabled;
      showAll = !suggestionsEnabled;
      mode.setAttribute('aria-checked', String(suggestionsEnabled));
      mode.textContent = context.t('Suggested actions: ') + (suggestionsEnabled ? context.t('On') : context.t('Off'));
      all.hidden = showAll;
      filterActions();
    });
    const all = context.doc.createElement('button');
    all.type = 'button';
    all.textContent = context.t('Show all actions');
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
      const index = buttons.indexOf(context.doc.activeElement as HTMLButtonElement);
      if (event.key === 'Escape' && filter.value) {
        event.preventDefault();
        filter.value = '';
        filterActions();
        filter.hidden = true;
        buttons[0]?.focus();
      } else if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        context.closeMenu(true);
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
    context.root.append(popup);
    popup.showPopover();
    popup.style.left = `${Math.max(8, Math.min(x, context.win.innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(y, context.win.innerHeight - popup.offsetHeight - 8))}px`;
    context.enterSurface(popup);
    popup.querySelector<HTMLButtonElement>('button[data-action]:not(:disabled):not([hidden])')?.focus();
  }

  function onHeaderContextMenu(event: MouseEvent): void {
    if (event.target instanceof context.win.Node && context.overlay.menu?.contains(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const bounds = context.root.getBoundingClientRect();
    if (
      context.indexWidth &&
      event.clientX >= bounds.left &&
      event.clientX < bounds.left + context.indexWidth &&
      event.clientY >= bounds.top + context.headerHeight
    ) {
      event.preventDefault();
      event.stopPropagation();
      const row = context.indexRow(event);
      if (row !== null && context.finishEdit(true)) {
        if (
          !context
            .getSelectionRanges()
            .some(
              (range) =>
                range.startColumn === 0 &&
                range.endColumn === context.columns.length - 1 &&
                row >= range.startRow &&
                row <= range.endRow,
            )
        )
          context.selectRow(row);
        openMenu(row, 0, event.clientX, event.clientY);
      }
      return;
    }
    if (event.clientY < bounds.top || event.clientY >= bounds.top + context.headerHeight) return;
    event.preventDefault();
    event.stopPropagation();
    const col = context.headerColumn(event);
    if (col === null || !context.finishEdit(true)) return;
    if (
      !context
        .getSelectionRanges()
        .some(
          (range) =>
            range.startRow === 0 &&
            range.endRow === context.rowCount - 1 &&
            col >= range.startColumn &&
            col <= range.endColumn,
        )
    )
      context.selectColumn(col);
    const selection = context.engine.getSelection();
    if (!context.rowCount || selection) openMenu(selection?.rowIndex ?? 0, col, event.clientX, event.clientY, true);
  }

  function openColumnDialog(beforeIndex: number): void {
    if (!context.options.allowColumnChanges || context.overlay.activeDialog?.open) return;
    const dialog = context.doc.createElement('dialog');
    dialog.dataset.gridDialog = '';
    dialog.setAttribute('aria-label', context.t('Insert column'));
    context.overlay.activeDialog = dialog;
    const heading = context.doc.createElement('p');
    heading.textContent = context.t('Insert column');
    const key = context.doc.createElement('input'),
      title = context.doc.createElement('input'),
      type = context.doc.createElement('select'),
      initial = context.doc.createElement('input');
    do {
      key.value = 'column_' + ++createdColumn;
    } while (context.columns.some((column) => column.key === key.value));
    key.required = title.required = true;
    for (const item of context.creationTypes) {
      const option = context.doc.createElement('option');
      option.value = item.key;
      option.textContent = item.label;
      type.append(option);
    }
    const field = (name: string, input: HTMLElement) => {
      const label = context.doc.createElement('label');
      label.textContent = name;
      input.setAttribute('aria-label', name);
      label.append(input);
      return label;
    };
    const status = context.doc.createElement('p');
    status.setAttribute('role', 'alert');
    const apply = context.doc.createElement('button');
    apply.type = 'button';
    apply.textContent = context.t('Insert column');
    const cancel = context.doc.createElement('button');
    cancel.type = 'button';
    cancel.textContent = context.t('Cancel');
    cancel.onclick = () => dialog.close();
    apply.onclick = () => {
      if (!key.reportValidity() || !title.reportValidity()) return;
      try {
        if (!key.value.trim() || !title.value.trim()) throw new Error('Key and title are required.');
        const definition = context.creationTypes
          .find((item) => item.key === type.value)!
          .create(Object.freeze({ key: key.value.trim(), title: title.value.trim(), defaultText: initial.value }));
        if (definition.column.key !== key.value.trim()) throw new Error('Column factory must retain the supplied key.');
        const editorConfig = definition.editor ? validateColumnEditor(definition.column, definition.editor) : undefined;
        context.engine.insertColumns(beforeIndex, [definition.column]);
        if (editorConfig) context.columnEditors.set(definition.column.key, editorConfig);
        dialog.close();
        context.render();
      } catch (error) {
        status.textContent = error instanceof Error ? context.t(error.message) : context.t('Unable to insert column.');
      }
    };
    const actions = context.doc.createElement('div');
    actions.dataset.dialogActions = '';
    actions.append(apply, cancel);
    dialog.append(
      heading,
      field(context.t('Column key'), key),
      field(context.t('Column title'), title),
      field(context.t('Column type'), type),
      field(context.t('Default value'), initial),
      status,
      actions,
    );
    context.root.append(dialog);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (context.overlay.activeDialog === dialog) context.overlay.activeDialog = null;
      if (!context.destroyed) context.scroller.focus({ preventScroll: true });
    });
    dialog.showModal();
    title.focus();
  }

  function openViewDialog(col: number, sort?: 'asc' | 'desc' | 'clear'): void {
    if ((!context.managesView && !context.options.onViewChange) || context.overlay.activeDialog?.open) return;
    const dialog = context.doc.createElement('dialog');
    context.overlay.activeDialog = dialog;
    dialog.setAttribute('aria-label', sort ? context.t('Change row view') : context.t('Filter column'));
    dialog.dataset.gridDialog = '';
    const title = context.doc.createElement('p');
    title.textContent =
      sort === 'clear'
        ? context.t('Show all rows in source order')
        : `${sort ? context.t('Sort {0}', sort === 'asc' ? context.t('ascending') : context.t('descending')) : context.t('Filter')}: ${context.columns[col]!.title}`;
    const note = context.doc.createElement('p');
    note.textContent = context.managesView
      ? context.t(
          'Selection, undo history, colors, locks and sizes follow their records. Edits update this view automatically. Columns can be reordered; clear the view before changing rows or adding/removing columns.',
        )
      : context.t('The host applies this row view. State retention depends on its handler.');
    const input = context.doc.createElement('input');
    input.type = 'search';
    input.setAttribute('aria-label', context.t('Contains text'));
    input.placeholder = context.t('Contains text (empty removes this filter)');
    input.style.width = '100%';
    input.value =
      context.currentView?.filters?.find((filter) => filter.columnKey === context.columns[col]!.key)?.query ?? '';
    const condition = context.doc.createElement('select');
    condition.setAttribute('aria-label', context.t('Filter condition'));
    for (const [value, label] of [
      ['contains', context.t('Contains text')],
      ['equals', context.t('Equals text')],
      ['not-empty', context.t('Has a value')],
      ['empty', context.t('Is empty')],
    ]) {
      const option = context.doc.createElement('option');
      option.value = value!;
      option.textContent = label!;
      condition.append(option);
    }
    condition.value =
      context.currentView?.filters?.find((filter) => filter.columnKey === context.columns[col]!.key)?.operator ??
      'contains';
    const updateInput = () => {
      input.disabled = condition.value === 'empty' || condition.value === 'not-empty';
    };
    condition.addEventListener('change', updateInput);
    updateInput();
    const status = context.doc.createElement('p');
    status.setAttribute('role', 'alert');
    const apply = context.doc.createElement('button');
    apply.type = 'button';
    apply.textContent = context.t('Apply view');
    const cancel = context.doc.createElement('button');
    cancel.type = 'button';
    cancel.textContent = context.t('Cancel');
    cancel.addEventListener('click', () => dialog.close());
    const commit = () => {
      const key = context.columns[col]!.key;
      const filters = (context.currentView?.filters ?? []).filter((filter) => filter.columnKey !== key);
      if (!sort && (input.value || condition.value === 'empty' || condition.value === 'not-empty')) {
        const operator = condition.value as 'contains' | 'equals' | 'not-empty' | 'empty';
        filters.push({ columnKey: key, query: input.value, operator });
      }
      const view: LocalViewOptions =
        sort === 'clear'
          ? {}
          : sort
            ? {
                ...(context.currentView?.filters ? { filters: context.currentView.filters } : {}),
                sort: { columnKey: key, direction: sort },
              }
            : { ...context.currentView, filters };
      try {
        if (context.managesView)
          context.animateLayout(() => {
            context.engine.setView(view);
            context.currentView = context.engine.view;
          }, 'row');
        else context.currentView = view;
        context.options.onViewChange?.(view);
        if (dialog.isConnected) dialog.close();
      } catch (error) {
        status.textContent = error instanceof Error ? context.t(error.message) : context.t('Unable to change view.');
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
    const actions = context.doc.createElement('div');
    actions.dataset.dialogActions = '';
    actions.append(apply, cancel);
    dialog.append(status, actions);
    context.root.append(dialog);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (context.overlay.activeDialog === dialog) context.overlay.activeDialog = null;
      if (!context.destroyed && !context.editors.editor) context.scroller.focus({ preventScroll: true });
    });
    dialog.showModal();
    (sort ? apply : input).focus();
  }

  function onContextMenu(event: MouseEvent): void {
    if (event.target === context.editors.editor) return;
    const cell = context.pointerCell(event);
    if (!cell) {
      if (
        context.columns.length &&
        ((!context.rowCount && context.options.onRowChange) ||
          context.engine.getHiddenRows().length ||
          context.engine.getHiddenColumns().length)
      ) {
        event.preventDefault();
        if (context.finishEdit(true)) openMenu(0, 0, event.clientX, event.clientY);
      }
      return;
    }
    event.preventDefault();
    if (!context.finishEdit(true)) return;
    openMenu(cell.row, cell.col, event.clientX, event.clientY);
  }
  return { openViewDialog, format, setFrozen, setLocked, openMenu, onHeaderContextMenu, onContextMenu };
}

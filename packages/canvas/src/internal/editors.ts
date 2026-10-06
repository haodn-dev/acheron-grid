import type { CellFormat, GridEngine } from '@acheron-grid/core';
import type { ChoiceEditorOptions } from '../choices.js';
import { choicePanel, choiceValue, disposeChoicePanel, positionChoicePanel } from '../choices.js';
import type { CellEditor, ColumnEditor } from '../grid.js';
import { createMediaEditor } from '../media-editor.js';
import type { RichText, RichTextFormat } from '../rich-text.js';
import { readHtml, richTextHtml, richTextSource } from '../rich-text.js';
import type { GridContext } from './grid-context.js';
import { createOverlay } from './overlay.js';

interface EditorsContext
  extends
    Readonly<Pick<GridContext['layout'], 'columns' | 'headerHeight' | 'indexWidth' | 'rowCount'>>,
    Readonly<Pick<GridContext['runtime'], 'destroyed'>>,
    Pick<GridContext['env'], 'doc' | 't' | 'win'>,
    Pick<GridContext, 'engine' | 'options'>,
    Readonly<Pick<GridContext['appearance'], 'theme'>> {
  readonly actionError: HTMLDivElement;
  readonly avatarColumns: ReadonlySet<string>;
  readonly columnEditors: Map<string, ColumnEditor>;
  readonly context: CanvasRenderingContext2D | null;
  readonly editorError: HTMLDivElement;
  readonly editorLabel: HTMLDivElement;
  readonly editorPane: HTMLDivElement;
  readonly enterSurface: (node: HTMLElement) => void;
  readonly exitSurface: (node: HTMLElement) => void;
  readonly invalidate: (changes: readonly { rowIndex: number; columnKey: string }[]) => void;
  readonly mediaColumn: (key: string) => boolean;
  readonly overlay: ReturnType<typeof createOverlay>;
  readonly richText: (value: unknown, key: string, contentFormat?: CellFormat['contentFormat']) => RichText | undefined;
  readonly richTextColumns: Map<string, RichTextFormat>;
  readonly root: HTMLDivElement;
  readonly scroller: HTMLDivElement;
  readonly select: (rowIndex: number, columnIndex: number, extend?: boolean, reveal?: boolean, add?: boolean) => void;
  readonly viewport: () => ReturnType<GridEngine['getViewport']>;
}

export function createEditors(context: EditorsContext) {
  let hoveredChoice: { row: number; col: number } | null = null;
  let editor: CellEditor | null = null;
  let editorCleanup: (() => void) | undefined;
  let richEditor: HTMLDivElement | null = null;
  let choices: HTMLElement | null = null;
  let editorAnchor: { left: number; top: number; width: number; height: number } | null = null;
  function choiceOptionsFor(key: string): ChoiceEditorOptions | false | undefined {
    const config = context.columnEditors.get(key),
      local = config && config.type !== 'checkbox' ? config.choiceEditor : undefined;
    return local === false
      ? false
      : local
        ? { ...(context.options.choiceEditor || {}), ...local }
        : context.options.choiceEditor;
  }

  function clearChoiceHover(): void {
    if (!hoveredChoice) return;
    const old = hoveredChoice;
    hoveredChoice = null;
    if (old.row < context.rowCount && old.col < context.columns.length)
      context.invalidate([{ rowIndex: old.row, columnKey: context.columns[old.col]!.key }]);
  }

  function disposeEditorIntegration(): void {
    const cleanup = editorCleanup;
    editorCleanup = undefined;
    try {
      cleanup?.();
    } catch (error) {
      try {
        context.options.onObserverError?.(error);
      } catch {}
    }
  }

  function guardEditNavigation(event: BeforeUnloadEvent): void {
    if (editor) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  function finishEdit(commit: boolean): boolean {
    const selection = context.engine.getSelection();
    if (!editor || !selection) return true;
    if (commit) {
      try {
        if (!editor.checkValidity()) throw new Error(editor.validationMessage);
        context.engine.editCell(
          selection.rowIndex,
          selection.columnIndex,
          editor instanceof context.win.HTMLInputElement && editor.type === 'checkbox'
            ? String(editor.checked)
            : editor instanceof context.win.HTMLSelectElement && editor.multiple
              ? choiceValue(editor)
              : editor.value,
        );
      } catch (error) {
        context.editorError.dataset.severity = 'error';
        editor.setCustomValidity(error instanceof Error ? context.t(error.message) : context.t('Unable to save cell.'));
        editor.setAttribute('aria-invalid', 'true');
        context.editorError.textContent =
          error instanceof Error ? context.t(error.message) : context.t('Unable to save cell.');
        context.editorError.style.display = 'block';
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
      context.exitSurface(choices);
    }
    choices = null;
    disposeEditorIntegration();
    input.remove();
    editorAnchor = null;
    context.editorLabel.hidden = true;
    context.win.removeEventListener('beforeunload', guardEditNavigation);
    context.editorError.style.position = 'absolute';
    context.editorError.style.display = 'none';
    context.editorError.textContent = '';
    context.editorPane.style.width = context.editorPane.style.height = '0px';
    context.select(selection.rowIndex, selection.columnIndex, true);
    return true;
  }

  function beginEdit(): void {
    const selection = context.engine.getSelection();
    if (context.destroyed || editor || !selection || !context.engine.canEdit(selection.rowIndex, selection.columnIndex))
      return;
    const column = context.columns[selection.columnIndex]!;
    const value = context.engine.getValue(selection.rowIndex, column.key);
    const preview = context.richText(
      value,
      column.key,
      context.engine.getFormat(selection.rowIndex, selection.columnIndex).contentFormat,
    );
    if (preview?.unavailable) {
      context.actionError.textContent = context.t('Rich text cannot be edited until it can be displayed.');
      context.actionError.style.display = 'block';
      return;
    }
    try {
      const custom = context.options.createEditor?.(Object.freeze({ ...selection, value }), context.doc) ?? null;
      if (
        custom &&
        (custom.ownerDocument !== context.doc ||
          custom.parentNode ||
          !['INPUT', 'SELECT', 'TEXTAREA'].includes(custom.tagName))
      ) {
        throw new Error('Cell editor must be a detached input, select or textarea from the grid document.');
      }
      if (!custom && context.mediaColumn(column.key)) {
        if (context.overlay.activeDialog?.open) return;
        const dialog = createMediaEditor(
          context.doc,
          value,
          context.avatarColumns.has(column.key),
          (next) => {
            if (
              context.destroyed ||
              context.engine.getRowId(selection.rowIndex) !== selection.rowId ||
              context.columns[selection.columnIndex]?.key !== column.key ||
              !Object.is(context.engine.getValue(selection.rowIndex, column.key), value)
            )
              throw new Error('This cell changed. Cancel and reopen the editor.');
            context.engine.editCell(selection.rowIndex, selection.columnIndex, JSON.stringify(next));
          },
          context.t,
        );
        context.overlay.activeDialog = dialog;
        context.root.append(dialog);
        dialog.addEventListener('close', () => {
          dialog.remove();
          if (context.overlay.activeDialog === dialog) context.overlay.activeDialog = null;
          if (!context.destroyed) context.scroller.focus({ preventScroll: true });
        });
        dialog.showModal();
        return;
      }
      const configured = context.columnEditors.get(column.key);
      if (!custom && (configured?.type === 'select' || configured?.type === 'multiselect')) {
        const select = context.doc.createElement('select');
        for (const value of configured.values) {
          const definition = typeof value === 'string' ? { value } : value;
          const option = context.doc.createElement('option');
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
        const checkbox = context.doc.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = value;
        editor = checkbox;
      } else editor = custom ?? context.doc.createElement(context.options.multilineEditor ? 'textarea' : 'input');
      if (!custom) {
        if (editor instanceof context.win.HTMLSelectElement && editor.multiple) {
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
              : context.mediaColumn(column.key) && Array.isArray(value)
                ? JSON.stringify(value)
                : String(value);
      }
    } catch (error) {
      context.actionError.textContent =
        error instanceof Error ? context.t(error.message) : context.t('Unable to create cell editor.');
      context.actionError.style.display = 'block';
      return;
    }
    context.actionError.style.display = 'none';
    editor.setAttribute(
      'aria-label',
      context.t('Edit row {0}, {1}', context.engine.getRowSourceIndex(selection.rowIndex) + 1, column.title),
    );
    editor.setAttribute('aria-errormessage', context.editorError.id);
    editor.style.cssText =
      'position:absolute;box-sizing:border-box;pointer-events:auto;outline:none;border:1px solid var(--acheron-selection-color);background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font);padding:0 8px';
    const cellFormat = context.engine.getFormat(selection.rowIndex, selection.columnIndex);
    if (cellFormat.background) editor.style.background = cellFormat.background;
    if (cellFormat.textColor) editor.style.color = cellFormat.textColor;
    if (cellFormat.fontWeight) editor.style.fontWeight = cellFormat.fontWeight;
    if (cellFormat.fontStyle) editor.style.fontStyle = cellFormat.fontStyle;
    if (editor instanceof context.win.HTMLTextAreaElement) editor.style.resize = 'none';
    if (editor instanceof context.win.HTMLInputElement && editor.type === 'checkbox') {
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
      context.editorError.style.display = 'none';
      context.editorError.dataset.severity = column.invalidInput === 'allow' ? 'warning' : 'error';
      if (editor) {
        try {
          const text =
            editor instanceof context.win.HTMLInputElement && editor.type === 'checkbox'
              ? String(editor.checked)
              : editor instanceof context.win.HTMLSelectElement && editor.multiple
                ? choiceValue(editor)
                : editor.value;
          const message = column.validate?.(column.parse ? column.parse(text) : text);
          if (message) {
            editor.setAttribute('aria-invalid', 'true');
            context.editorError.textContent =
              message +
              (column.invalidInput === 'allow' ? ' You can save this value.' : ' Correct this before saving.');
            context.editorError.style.display = 'block';
          }
        } catch (error) {
          context.editorError.dataset.severity = 'error';
          editor.setAttribute('aria-invalid', 'true');
          context.editorError.textContent =
            error instanceof Error ? context.t(error.message) : context.t('Invalid value.');
          context.editorError.style.display = 'block';
        }
      }
      positionEditor();
    };
    editor.addEventListener('input', clearValidation);
    editor.addEventListener('change', clearValidation);
    clearValidation();
    editor.addEventListener('keydown', (event) => {
      if (!(event instanceof context.win.KeyboardEvent)) return;
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if (
        editor instanceof context.win.HTMLTextAreaElement &&
        event.key === 'Enter' &&
        (event.altKey || event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        editor.setRangeText('\n', editor.selectionStart, editor.selectionEnd, 'end');
        editor.dispatchEvent(new context.win.Event('input', { bubbles: true }));
        return;
      }
      if (editor instanceof context.win.HTMLTextAreaElement && event.key === 'Tab') {
        event.preventDefault();
        const current = context.engine.getSelection()!;
        if (finishEdit(true)) {
          const position = Math.max(
            0,
            Math.min(
              context.rowCount * context.columns.length - 1,
              current.rowIndex * context.columns.length + current.columnIndex + (event.shiftKey ? -1 : 1),
            ),
          );
          context.select(Math.floor(position / context.columns.length), position % context.columns.length);
          context.scroller.focus({ preventScroll: true });
        }
        return;
      }
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        if (finishEdit(event.key === 'Enter')) context.scroller.focus({ preventScroll: true });
      } else if (event.key === 'Tab' && !finishEdit(true)) event.preventDefault();
    });
    editor.addEventListener('blur', () => {
      if (
        !context.options.editorOptions?.pinned &&
        !choices &&
        !(
          editor instanceof context.win.HTMLSelectElement &&
          editor.dataset.gridChoiceEditor !== undefined &&
          choiceOptionsFor(column.key)
        )
      )
        finishEdit(true);
    });
    context.editorPane.append(editor);
    const contentFormat = cellFormat.contentFormat ?? context.richTextColumns.get(column.key);
    if (
      contentFormat &&
      contentFormat !== 'plain' &&
      !context.options.createEditor &&
      !context.columnEditors.has(column.key)
    ) {
      const backing = editor;
      const surface = context.doc.createElement('div');
      richEditor = surface;
      surface.contentEditable = 'true';
      surface.setAttribute('role', 'textbox');
      surface.setAttribute('aria-multiline', 'true');
      surface.setAttribute('aria-label', backing.getAttribute('aria-label')!);
      surface.setAttribute('aria-errormessage', context.editorError.id);
      surface.style.cssText =
        backing.style.cssText +
        ';white-space:pre-wrap;overflow:auto;overflow-wrap:anywhere;padding:4px 8px;line-height:normal';
      surface.innerHTML = richTextHtml(
        context.richText(value, column.key, contentFormat) ?? {
          text: String(value ?? ''),
          runs: [{ text: String(value ?? '') }],
        },
        context.doc,
      );
      backing.setAttribute('aria-hidden', 'true');
      backing.tabIndex = -1;
      backing.style.visibility = 'hidden';
      backing.style.pointerEvents = 'none';
      const sync = () => {
        backing.value = richTextSource(readHtml(surface.innerHTML, context.doc, true), contentFormat, context.doc);
        backing.dispatchEvent(new context.win.Event('input', { bubbles: true }));
      };
      const insert = (rich: RichText) => {
        const selection = context.win.getSelection();
        if (!selection?.rangeCount || !surface.contains(selection.anchorNode)) return;
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const template = context.doc.createElement('template');
        template.innerHTML = richTextHtml(rich, context.doc);
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
        const rich = html ? readHtml(html, context.doc) : { text, runs: [{ text }] };
        insert(
          context.engine.getCellPermission(selection.rowIndex, selection.columnIndex).formatting
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
            !context.engine.getCellPermission(selection.rowIndex, selection.columnIndex).formatting ||
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
          backing.dispatchEvent(new context.win.KeyboardEvent('keydown', { key: event.key, shiftKey: event.shiftKey }));
        }
      });
      surface.addEventListener('blur', () => {
        if (!context.options.editorOptions?.pinned) finishEdit(true);
      });
      context.editorPane.append(surface);
    }
    if (context.options.editorOptions?.guardNavigation !== false)
      context.win.addEventListener('beforeunload', guardEditNavigation);
    context.editorLabel.textContent = context.t(
      '{0} · Row {1} · {2}',
      column.title,
      context.engine.getRowSourceIndex(selection.rowIndex) + 1,
      String(context.engine.getRowId(selection.rowIndex)),
    );
    positionEditor();
    (richEditor ?? editor).focus({ preventScroll: true });
    if (richEditor) {
      const range = context.doc.createRange();
      range.selectNodeContents(richEditor);
      const selection = context.win.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else if (editor.tagName !== 'SELECT' && 'select' in editor) editor.select();
    const choiceOptions = choiceOptionsFor(column.key);
    if (
      editor instanceof context.win.HTMLSelectElement &&
      editor.dataset.gridChoiceEditor !== undefined &&
      choiceOptions
    ) {
      choices = choicePanel(
        editor,
        context.root,
        choiceOptions,
        (commit) => {
          const done = finishEdit(commit);
          if (done) context.scroller.focus({ preventScroll: true });
          return done;
        },
        column.key,
        context.t,
      );
      context.enterSurface(choices);
      editor.style.opacity = '0';
      editor.style.pointerEvents = 'none';
      editor.tabIndex = -1;
      editor.setAttribute('aria-hidden', 'true');
    }
    try {
      const cleanup = context.options.onEditorMount?.(Object.freeze({ ...selection, value }), editor);
      editorCleanup = typeof cleanup === 'function' ? cleanup : undefined;
    } catch (error) {
      finishEdit(false);
      context.actionError.textContent =
        error instanceof Error ? context.t(error.message) : context.t('Unable to mount custom editor.');
      context.actionError.style.display = 'block';
    }
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
    const selection = context.engine.getSelection();
    if (!editor || !selection) return;
    const rect = context.viewport().cellRect(selection.rowIndex, selection.columnIndex);
    if (context.options.editorOptions?.pinned) {
      const bounds = context.root.getBoundingClientRect();
      editorAnchor ??= {
        left: bounds.left + context.indexWidth + rect.x,
        top: bounds.top + context.headerHeight + rect.y,
        width: rect.width,
        height: rect.height,
      };
      const left = Math.max(
        8,
        Math.min(
          editorAnchor.left,
          context.win.innerWidth - Math.min(editorAnchor.width, context.win.innerWidth - 16) - 8,
        ),
      );
      const top = Math.max(
        32,
        Math.min(
          editorAnchor.top,
          context.win.innerHeight - Math.min(editorAnchor.height, context.win.innerHeight - 48) - 16,
        ),
      );
      context.editorPane.style.position = 'fixed';
      context.editorPane.style.overflow = 'visible';
      context.editorPane.style.zIndex = '9';
      context.editorPane.style.clipPath = '';
      context.editorPane.style.left = `${left}px`;
      context.editorPane.style.top = `${top}px`;
      context.editorPane.style.width = `${Math.min(editorAnchor.width, context.win.innerWidth - left - 8)}px`;
      context.editorPane.style.height = `${Math.min(editorAnchor.height, context.win.innerHeight - top - 16)}px`;
      editor.style.left = '0px';
      editor.style.top = '0px';
      editor.style.width = context.editorPane.style.width;
      editor.style.height = context.editorPane.style.height;
      if (editor instanceof context.win.HTMLTextAreaElement && !richEditor) {
        editor.style.height = '0px';
        editor.style.height = `${Math.min(Math.max(editorAnchor.height, editor.scrollHeight + 4), context.win.innerHeight - top - 16)}px`;
      }
      positionRichEditor(context.win.innerHeight - top - 16);
      const displaced =
        Math.abs(bounds.left + context.indexWidth + rect.x - editorAnchor.left) > 0.5 ||
        Math.abs(bounds.top + context.headerHeight + rect.y - editorAnchor.top) > 0.5;
      context.editorLabel.hidden =
        context.options.editorOptions.showLabel === false ||
        (context.options.editorOptions.showLabel === 'scroll' && !displaced);
      if (choices && editor instanceof context.win.HTMLSelectElement) {
        choices.hidden = false;
        positionChoicePanel(choices, editor);
      }
      if (context.editorError.style.display !== 'none') {
        context.editorError.style.position = 'fixed';
        context.editorError.style.left = `${left}px`;
        context.editorError.style.top = `${Math.min(top + editor.offsetHeight + 4, context.win.innerHeight - context.editorError.offsetHeight - 8)}px`;
        context.editorError.style.maxWidth = `${context.win.innerWidth - left - 8}px`;
        context.editorError.style.visibility = 'visible';
      }
      return;
    }
    const clip = rect.clip;
    context.editorPane.style.left = `${context.indexWidth + clip.x}px`;
    context.editorPane.style.top = `${context.headerHeight + clip.y}px`;
    context.editorPane.style.width = `${clip.width}px`;
    context.editorPane.style.height = `${clip.height}px`;
    editor.style.left = `${rect.x - clip.x}px`;
    editor.style.top = `${rect.y - clip.y}px`;
    editor.style.width = `${rect.width}px`;
    editor.style.height = `${editor instanceof context.win.HTMLSelectElement && editor.multiple && !context.options.choiceEditor ? Math.min(220, Math.max(rect.height, editor.size * 24 + 8), Math.max(1, clip.height - Math.max(0, rect.y - clip.y))) : rect.height}px`;
    const hidden =
      rect.x + rect.width <= clip.x ||
      rect.x >= clip.x + clip.width ||
      rect.y + rect.height <= clip.y ||
      rect.y >= clip.y + clip.height;
    context.editorPane.style.clipPath = hidden ? 'inset(100%)' : '';
    if (choices && editor instanceof context.win.HTMLSelectElement) {
      choices.hidden = hidden;
      positionChoicePanel(choices, editor);
    }
    if (editor instanceof context.win.HTMLTextAreaElement && !richEditor) {
      context.context!.save();
      context.context!.font = context.theme.font;
      let width = rect.width;
      for (const line of editor.value.split('\n'))
        width = Math.max(width, context.context!.measureText(line).width + 24);
      context.context!.restore();
      editor.style.width = `${Math.min(width, Math.max(1, clip.width - Math.max(0, rect.x - clip.x)))}px`;
      editor.style.height = '0px';
      editor.style.height = `${Math.min(Math.max(rect.height, editor.scrollHeight + 4), Math.max(1, clip.height - Math.max(0, rect.y - clip.y)))}px`;
    }
    positionRichEditor(Math.max(1, clip.height - Math.max(0, rect.y - clip.y)));
    if (context.editorError.style.display !== 'none') {
      context.editorError.style.maxWidth = `${clip.width}px`;
      context.editorError.style.visibility = hidden ? 'hidden' : 'visible';
      context.editorError.style.left = `${context.indexWidth + Math.max(clip.x, Math.min(rect.x, clip.x + clip.width - context.editorError.offsetWidth))}px`;
      context.editorError.style.top = `${context.headerHeight + Math.max(clip.y, Math.min(rect.y + editor.offsetHeight + 4, clip.y + clip.height - context.editorError.offsetHeight))}px`;
    }
  }
  return {
    clearChoiceHover,
    disposeEditorIntegration,
    guardEditNavigation,
    finishEdit,
    beginEdit,
    positionEditor,
    get hoveredChoice() {
      return hoveredChoice;
    },
    set hoveredChoice(value: { row: number; col: number } | null) {
      hoveredChoice = value;
    },
    get editor() {
      return editor;
    },
    set editor(value: CellEditor | null) {
      editor = value;
    },
    get choices() {
      return choices;
    },
    set choices(value: HTMLElement | null) {
      choices = value;
    },
    get richEditor() {
      return richEditor;
    },
    set richEditor(value: HTMLDivElement | null) {
      richEditor = value;
    },
  };
}

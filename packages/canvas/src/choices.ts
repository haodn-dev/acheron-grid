export interface ChoiceInfo { readonly value: string; readonly selected: boolean; readonly multiple: boolean; readonly columnKey?: string; }
export interface ChoiceEditorOptions {
  readonly placeholder?: string;
  readonly applyLabel?: string;
  readonly cancelLabel?: string;
  readonly emptyLabel?: string;
  readonly maxHeight?: number;
  readonly renderOption?: (option: Readonly<ChoiceInfo>, document: Document) => HTMLElement;
}
let choiceId=0;
export function choicePanel(select: HTMLSelectElement, root: HTMLElement, options: ChoiceEditorOptions, finish: (commit: boolean) => boolean, columnKey?: string): HTMLElement {
  if (options.maxHeight !== undefined && (!Number.isFinite(options.maxHeight) || options.maxHeight <= 0)) throw new RangeError('Choice maxHeight must be positive.');
  const doc = root.ownerDocument; const panel = doc.createElement('div'); panel.dataset.gridChoices = '';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', select.getAttribute('aria-label') ?? 'Choose values');
  panel.style.cssText = 'position:fixed;z-index:10;box-sizing:border-box;width:260px;padding:10px;border:1px solid var(--acheron-grid-line-color);border-radius:8px;background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font);box-shadow:0 8px 24px #0f172a25';
  const query = doc.createElement('input'); query.type = 'search'; query.placeholder = options.placeholder ?? 'Search options'; query.setAttribute('aria-label', 'Search options'); query.style.cssText = 'outline:none;box-shadow:none;width:100%;box-sizing:border-box;padding:7px;border:1px solid var(--acheron-grid-line-color);border-radius:4px;background:inherit;color:inherit;font:inherit';
  const list = doc.createElement('div'); list.id='acheron-choices-'+(++choiceId);list.setAttribute('role','group');list.setAttribute('aria-label','Available options');query.setAttribute('aria-controls',list.id);query.setAttribute('aria-keyshortcuts','ArrowUp ArrowDown'); list.style.cssText = `overflow:auto;max-height:${Math.min(options.maxHeight ?? 220, Math.max(80, doc.defaultView!.innerHeight - 180))}px;margin:8px 0;scrollbar-width:thin`;
  const styles=doc.createElement('style');styles.textContent='[data-grid-choices] label:focus-within{background:color-mix(in srgb,var(--acheron-selection-color) 12%,var(--acheron-background))}';panel.append(styles);
  query.setAttribute('aria-description','Up and Down navigate options. Enter applies. Escape cancels. Space toggles multiple selections.');
  const summary = doc.createElement('div'); summary.setAttribute('role', 'status'); summary.style.cssText = 'font-size:11px;opacity:.7;margin-bottom:8px';
  function draw(): void {
    list.replaceChildren(); summary.textContent = select.multiple ? `${select.selectedOptions.length} selected` : 'Choose one option';
    for (const option of Array.from(select.options)) {
      if (!option.text.toLowerCase().includes(query.value.toLowerCase())) continue;
      const label = doc.createElement('label'); label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px;border-radius:4px;cursor:pointer';
      const input = doc.createElement('input'); input.type = select.multiple ? 'checkbox' : 'radio'; input.disabled = option.disabled || option.parentElement instanceof doc.defaultView!.HTMLOptGroupElement && option.parentElement.disabled; input.dataset.optionIndex=String(option.index); input.checked = option.selected; input.setAttribute('aria-label', option.text || options.emptyLabel || 'Empty'); input.style.accentColor = 'var(--acheron-selection-color)';
      const custom = options.renderOption?.(Object.freeze({ value: option.value, selected: option.selected, multiple: select.multiple, ...(columnKey === undefined ? {} : { columnKey }) }), doc);
      if (custom && (custom.ownerDocument !== doc || custom.parentNode)) throw new TypeError('Choice option renderer must return a detached element from the grid document.');
      const text = custom ?? doc.createElement('span'); if (!custom) text.textContent = option.text || options.emptyLabel || 'Empty';
      input.addEventListener('change', () => { if (!select.multiple) select.value = option.value; else option.selected = input.checked; select.dispatchEvent(new doc.defaultView!.Event('change', { bubbles: true })); draw(); Array.from(list.querySelectorAll<HTMLInputElement>('input')).find(input => input.dataset.optionIndex === String(option.index))?.focus(); });
      label.append(input, text); list.append(label);
    }
    if (!list.childElementCount) list.textContent = 'No matching options';
  }
  query.addEventListener('input', () => { draw(); positionChoicePanel(panel, select); });
  const actions = doc.createElement('div'); actions.style.cssText = 'display:flex;justify-content:flex-end;gap:6px';
  for (const [text, commit] of [[options.cancelLabel ?? 'Cancel', false], [options.applyLabel ?? 'Apply', true]] as const) {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = text; button.style.cssText = 'padding:6px 10px;border:1px solid var(--acheron-grid-line-color);border-radius:4px;background:var(--acheron-header-background);color:inherit;font:inherit'; button.addEventListener('click', () => finish(commit)); actions.append(button);
  }
  panel.addEventListener('keydown', event => {
    event.stopPropagation();if(event.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();finish(false);return;}
    if(event.key==='Enter' && !(event.target instanceof doc.defaultView!.HTMLButtonElement)){event.preventDefault();finish(true);return;}
    if(event.key==='Tab'){
      const controls=Array.from(panel.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)'));
      const index=controls.indexOf(doc.activeElement as HTMLElement);
      if((event.shiftKey&&index===0)||(!event.shiftKey&&index===controls.length-1)){event.preventDefault();controls[event.shiftKey?controls.length-1:0]?.focus();}
      return;
    }
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey)return;
    if(event.target!==query && !(event.target instanceof doc.defaultView!.HTMLInputElement && list.contains(event.target)))return;
    if(event.target===query && (event.key==='Home'||event.key==='End'))return;
    const inputs=Array.from(list.querySelectorAll<HTMLInputElement>('input:not(:disabled)'));if(!inputs.length)return;
    event.preventDefault();
    let index=inputs.indexOf(doc.activeElement as HTMLInputElement);
    if(index<0)index=inputs.findIndex(input=>input.checked);
    const next=event.key==='Home'?0:event.key==='End'?inputs.length-1:index<0?(event.key==='ArrowUp'?inputs.length-1:0):(index+(event.key==='ArrowUp'?-1:1)+inputs.length)%inputs.length;
    const input=inputs[next]!;
    if(!select.multiple){select.selectedIndex=Number(input.dataset.optionIndex);select.dispatchEvent(new doc.defaultView!.Event('change',{bubbles:true}));draw();}
    const focused=select.multiple?input:list.querySelector<HTMLInputElement>('[data-option-index="'+input.dataset.optionIndex+'"]');
    focused?.focus({preventScroll:true});focused?.scrollIntoView({block:'nearest'});
  });
  panel.addEventListener('pointerdown', event => event.stopPropagation());
  panel.addEventListener('click', event => event.stopPropagation());
  panel.append(query, list, summary, actions); draw(); root.append(panel);
  positionChoicePanel(panel, select);
  query.focus(); return panel;
}
export function positionChoicePanel(panel: HTMLElement, select: HTMLSelectElement): void {
  const bounds = select.getBoundingClientRect(); const win = select.ownerDocument.defaultView!;
  panel.style.width = `${Math.min(300, Math.max(220, bounds.width), win.innerWidth - 16)}px`;
  panel.style.left = `${Math.max(8, Math.min(bounds.left, win.innerWidth - panel.offsetWidth - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(bounds.bottom + 4, win.innerHeight - panel.offsetHeight - 8))}px`;
}

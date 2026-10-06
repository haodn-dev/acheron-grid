import {createCanvasTranslator} from './locale.js';
import type {CanvasTranslator} from './locale.js';
export interface ChoiceInfo { readonly value: string; readonly label: string; readonly disabled: boolean; readonly selected: boolean; readonly multiple: boolean; readonly columnKey?: string; }
export interface ChoiceOption { readonly value: string; readonly label?: string; readonly disabled?: boolean; }
const choiceDisposers=new WeakMap<HTMLElement,()=>void>();
export function disposeChoicePanel(panel:HTMLElement):void {choiceDisposers.get(panel)?.();choiceDisposers.delete(panel);}
export interface ChoiceEditorOptions {
  readonly loadOptions?: (query:string, context:Readonly<{columnKey?:string;signal:AbortSignal}>)=>Promise<readonly ChoiceOption[]>;
  readonly searchDelay?: number;
  readonly loadingLabel?: string;
  readonly errorLabel?: string;
  readonly searchable?: boolean;
  readonly searchLabel?: string;
  readonly optionsLabel?: string;
  readonly noMatchLabel?: string;
  readonly selectedLabel?: (count: number, multiple: boolean) => string;
  readonly matches?: (query: string, option: Readonly<ChoiceInfo>) => boolean;
  readonly valueOrder?: 'input' | 'options';
  readonly placeholder?: string;
  readonly applyLabel?: string;
  readonly cancelLabel?: string;
  readonly emptyLabel?: string;
  readonly maxHeight?: number;
  readonly renderOption?: (option: Readonly<ChoiceInfo>, document: Document) => HTMLElement;
}
let choiceId=0;
export function choicePanel(select: HTMLSelectElement, root: HTMLElement, options: ChoiceEditorOptions, finish: (commit: boolean) => boolean, columnKey?: string,t:CanvasTranslator=createCanvasTranslator()): HTMLElement {
  if (options.maxHeight !== undefined && (!Number.isFinite(options.maxHeight) || options.maxHeight <= 0)) throw new RangeError('Choice maxHeight must be positive.');
  select.dataset.choiceValueOrder = options.valueOrder ?? 'input';
  const doc = root.ownerDocument; const panel = doc.createElement('div'); panel.dataset.gridChoices = '';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', select.getAttribute('aria-label') ?? t("Choose values"));
  panel.style.cssText = 'position:fixed;z-index:10;box-sizing:border-box;width:260px;padding:10px;border:1px solid var(--acheron-grid-line-color);border-radius:10px;background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font);box-shadow:0 12px 32px #0003';
  const query = doc.createElement('input'); query.type = 'search'; query.hidden=options.searchable===false; query.placeholder = options.placeholder ?? t("Search options"); query.setAttribute('aria-label', options.searchLabel ?? t("Search options")); query.style.cssText = 'outline:none;box-shadow:none;width:100%;box-sizing:border-box;padding:7px;border:1px solid var(--acheron-grid-line-color);border-radius:4px;background:inherit;color:inherit;font:inherit';
  const list = doc.createElement('div'); list.id='acheron-choices-'+(++choiceId);list.setAttribute('role','group');list.setAttribute('aria-label',options.optionsLabel ?? t("Available options"));query.setAttribute('aria-controls',list.id);query.setAttribute('aria-keyshortcuts','ArrowUp ArrowDown'); list.style.cssText = `overflow:auto;max-height:${Math.min(options.maxHeight ?? 220, Math.max(80, doc.defaultView!.innerHeight - 180))}px;margin:8px 0;scrollbar-width:thin`;
  const styles=doc.createElement('style');styles.textContent='[data-grid-choices] label:focus-within{background:color-mix(in srgb,var(--acheron-selection-color) 12%,var(--acheron-background))}[data-grid-choices] label:has(input:focus-visible){box-shadow:inset 0 0 0 1px var(--acheron-selection-color)}[data-grid-choices] input:is([type=radio],[type=checkbox]):focus-visible{outline:none}';panel.append(styles);
  query.setAttribute('aria-description',t("Up and Down navigate options. Enter applies. Escape cancels. Space toggles multiple selections."));
  const summary = doc.createElement('div'); summary.setAttribute('role', 'status'); summary.style.cssText = 'font-size:12px;color:var(--acheron-header-text-color);margin-bottom:8px';
  const remoteStatus=doc.createElement('div');remoteStatus.setAttribute('role','status');remoteStatus.style.cssText='font-size:12px;color:var(--acheron-header-text-color);margin:8px 0';remoteStatus.hidden=true;
  let remoteValues:Set<string>|undefined, request:AbortController|undefined, timer=0, disposed=false;
  const delay=options.searchDelay ?? 180;
  if(!Number.isFinite(delay)||delay<0)throw new RangeError('Choice searchDelay must be nonnegative.');
  choiceDisposers.set(panel,()=>{disposed=true;doc.defaultView!.clearTimeout(timer);request?.abort();});
  function search():void {
    draw();positionChoicePanel(panel,select);
    if(!options.loadOptions)return;
    doc.defaultView!.clearTimeout(timer);request?.abort();const controller=new doc.defaultView!.AbortController();request=controller;
    remoteStatus.hidden=false;remoteStatus.textContent=options.loadingLabel ?? t("Loading options...");
    timer=doc.defaultView!.setTimeout(()=>{
      void Promise.resolve().then(()=>options.loadOptions!(query.value,Object.freeze({signal:controller.signal,...(columnKey===undefined?{}:{columnKey})}))).then(values=>{
        if(disposed||controller.signal.aborted||!panel.isConnected)return;
        if(!Array.isArray(values)||values.some(value=>!value||typeof value.value!=='string'||value.label!==undefined&&typeof value.label!=='string'||value.disabled!==undefined&&typeof value.disabled!=='boolean'||select.multiple&&(!value.value||value.value.includes(',')))||new Set(values.map(value=>value.value)).size!==values.length)throw new TypeError('Invalid remote choice options.');
        const selected=Array.from(select.selectedOptions).map(option=>({value:option.value,label:option.text,disabled:option.disabled}));
        select.replaceChildren();remoteValues=new Set(values.map(value=>value.value));
        for(const value of [...values,...selected.filter(value=>!remoteValues!.has(value.value))]){const option=doc.createElement('option');option.value=value.value;option.textContent=value.label ?? value.value;option.disabled=value.disabled ?? false;option.selected=selected.some(item=>item.value===value.value);select.append(option);}
        remoteStatus.hidden=true;draw();positionChoicePanel(panel,select);
      }).catch(()=>{if(!disposed&&!controller.signal.aborted&&panel.isConnected){remoteStatus.hidden=false;remoteStatus.textContent=options.errorLabel ?? t("Unable to load options. Try searching again.");}});
    },delay);
  }
  function draw(): void {
    list.replaceChildren(); summary.textContent = options.selectedLabel?.(select.selectedOptions.length,select.multiple) ?? (select.multiple ? t("{0} selected",select.selectedOptions.length) : t("Choose one option"));
    for (const option of Array.from(select.options)) {
      const info=Object.freeze({value:option.value,label:option.text,disabled:option.disabled || option.parentElement instanceof doc.defaultView!.HTMLOptGroupElement && option.parentElement.disabled,selected:option.selected,multiple:select.multiple,...(columnKey===undefined?{}:{columnKey})});
      if(remoteValues && !remoteValues.has(option.value) && !option.selected)continue;
      if(!options.loadOptions&&options.searchable!==false && !(options.matches?.(query.value,info) ?? option.text.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))continue;
      const label = doc.createElement('label'); label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px;border-radius:4px;cursor:pointer';
      const input = doc.createElement('input'); input.type = select.multiple ? 'checkbox' : 'radio'; input.disabled = option.disabled || option.parentElement instanceof doc.defaultView!.HTMLOptGroupElement && option.parentElement.disabled; input.dataset.optionIndex=String(option.index); input.checked = option.selected; input.setAttribute('aria-label', option.text || options.emptyLabel || t("Empty")); input.style.accentColor = 'var(--acheron-selection-color)';
      if (input.disabled) { label.style.opacity='.45'; label.style.cursor='default'; }
      if (option.selected) label.style.background='color-mix(in srgb,var(--acheron-selection-color) 8%,var(--acheron-background))';
      const custom = options.renderOption?.(info, doc);
      if (custom && (custom.ownerDocument !== doc || custom.parentNode)) throw new TypeError('Choice option renderer must return a detached element from the grid document.');
      const text = custom ?? doc.createElement('span'); if (!custom) text.textContent = option.text || options.emptyLabel || t("Empty");
      input.addEventListener('change', () => { if (!select.multiple) select.value = option.value; else option.selected = input.checked; select.dispatchEvent(new doc.defaultView!.Event('change', { bubbles: true })); draw(); Array.from(list.querySelectorAll<HTMLInputElement>('input')).find(input => input.dataset.optionIndex === String(option.index))?.focus(); });
      label.append(input, text); list.append(label);
    }
    if (!list.childElementCount) list.textContent = options.noMatchLabel ?? t("No matching options");
  }
  query.addEventListener('input', search);
  const actions = doc.createElement('div'); actions.style.cssText = 'display:flex;justify-content:flex-end;gap:6px';
  for (const [text, commit] of [[options.cancelLabel ?? t("Cancel"), false], [options.applyLabel ?? t("Apply"), true]] as const) {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = text; button.style.cssText = 'padding:6px 10px;border:1px solid var(--acheron-grid-line-color);border-radius:4px;background:var(--acheron-header-background);color:inherit;font:inherit'; if (commit) { button.style.borderColor='var(--acheron-selection-color)'; button.style.background='color-mix(in srgb,var(--acheron-selection-color) 12%,var(--acheron-background))'; } button.addEventListener('click', () => finish(commit)); actions.append(button);
  }
  panel.addEventListener('keydown', event => {
    event.stopPropagation();if(event.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();finish(false);return;}
    if(event.key==='Enter' && !(event.target instanceof doc.defaultView!.HTMLButtonElement)){event.preventDefault();finish(true);return;}
    if (options.searchable!==false && event.target !== query && !event.ctrlKey && !event.metaKey && !event.altKey && ((event.key.length === 1 && event.key !== ' ') || event.key === 'Backspace')) {
      event.preventDefault();query.value = event.key === 'Backspace' ? query.value.slice(0,-1) : query.value + event.key;
      query.focus();search();return;
    }
    if(event.key==='Tab'){
      const controls=Array.from(panel.querySelectorAll<HTMLElement>('input:not(:disabled):not([hidden]),button:not(:disabled)'));
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
  panel.append(query, remoteStatus, list, summary, actions); draw(); root.append(panel);
  if(options.loadOptions)search();
  list.setAttribute('aria-label',options.optionsLabel ?? t("Available options"));
  positionChoicePanel(panel, select);
  if(query.hidden)panel.querySelector<HTMLElement>('input:not(:disabled):not([hidden]),button')?.focus();else query.focus(); return panel;
}
export function positionChoicePanel(panel: HTMLElement, select: HTMLSelectElement): void {
  const bounds = select.getBoundingClientRect(); const win = select.ownerDocument.defaultView!;
  panel.style.width = `${Math.min(300, Math.max(220, bounds.width), win.innerWidth - 16)}px`;
  panel.style.left = `${Math.max(8, Math.min(bounds.left, win.innerWidth - panel.offsetWidth - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(bounds.bottom + 4, win.innerHeight - panel.offsetHeight - 8))}px`;
}

/** Keep original selected values in input order; append new values in configured option order. */
export function choiceValue(select: HTMLSelectElement): string {
  const selected = Array.from(select.selectedOptions).map(option=>option.value);
  if (select.dataset.choiceValueOrder === 'options') return selected.join(', ');
  const original: string[] = JSON.parse(select.dataset.choiceOriginalValues ?? '[]');
  return [...original.filter(value=>selected.includes(value)), ...selected.filter(value=>!original.includes(value))].join(', ');
}

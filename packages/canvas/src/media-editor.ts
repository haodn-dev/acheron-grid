import {createCanvasTranslator} from './locale.js';
import type {CanvasTranslator} from './locale.js';
import { mediaItems, validateMediaValue } from './media.js';
import type { MediaItem, MediaValue } from './media.js';
import { icons } from './icons.js';

/** A local draft; only Apply invokes the engine-owned mutation callback. */
export function createMediaEditor(doc:Document, value:unknown, people:boolean, save:(value:MediaValue)=>void,t:CanvasTranslator=createCanvasTranslator()):HTMLDialogElement {
  const draft:MediaItem[]=mediaItems(value).map(item=>({...item}));
  const original=JSON.stringify(draft);
  const dialog=doc.createElement('dialog');dialog.dataset.gridDialog='';dialog.setAttribute('aria-label',people?t("Edit people"):t("Edit images"));
  dialog.style.cssText='width:min(580px,calc(100vw - 24px));max-height:80vh;padding:20px';
  const title=doc.createElement('h2');title.textContent=people?t("Edit people"):t("Edit images");
  const hint=doc.createElement('p');hint.textContent=t("Add a URL, update labels, or reorder items. Changes are saved together.");
  hint.style.cssText='opacity:.75;margin:0 0 16px';
  const form=doc.createElement('form'),list=doc.createElement('div'),error=doc.createElement('p');error.setAttribute('role','alert');error.style.color='var(--acheron-text-color)';
  function url(value:string):string {
    const parsed=new URL(value,doc.baseURI);
    if(parsed.username||parsed.password||!['http:','https:','blob:','data:'].includes(parsed.protocol)||parsed.protocol==='data:'&&!/^data:image\//i.test(value))throw new Error('Use an HTTP or HTTPS image URL.');
    return parsed.href;
  }
  function button(label:string,icon:keyof typeof icons,action:()=>void):HTMLButtonElement {
    const node=doc.createElement('button');node.type='button';node.title=label;node.setAttribute('aria-label',label);node.innerHTML=icons[icon];
    node.style.cssText='display:grid;place-items:center;width:32px;height:32px;padding:6px';node.querySelector('svg')?.setAttribute('width','16');node.querySelector('svg')?.setAttribute('height','16');node.onclick=action;return node;
  }
  function render(focusIndex?:number):void {
    list.replaceChildren();
    for(const [index,item] of draft.entries()) {
      const row=doc.createElement('div');row.style.cssText='display:grid;grid-template-columns:48px minmax(0,1fr);gap:12px;padding:12px 0;border-bottom:1px solid var(--acheron-grid-line-color)';
      const preview=doc.createElement('span');preview.style.cssText=`width:48px;height:48px;display:grid;place-items:center;overflow:hidden;border-radius:${people?'50%':'8px'};background:var(--acheron-header-background)`;
      preview.textContent=people?(item.name??'?').split(/\s+/).slice(0,2).map(word=>word[0]).join(''):String(index+1);
      if(item.src)try{const image=doc.createElement('img');image.alt='';image.style.cssText='width:100%;height:100%;object-fit:cover';image.referrerPolicy='no-referrer';image.onload=()=>preview.replaceChildren(image);image.src=url(item.src);}catch{/* The editable URL field remains available for repair. */}
      const fields=doc.createElement('div');fields.style.cssText='min-width:0;display:grid;gap:6px';
      const name=doc.createElement('input');name.setAttribute('aria-label',t(people?'Name {0}':'Description {0}',index+1));name.placeholder=people?t("Person name"):t("Image description");name.value=item.name??item.alt??'';
      name.oninput=()=>{draft[index]={...draft[index],...(people?{name:name.value}:{alt:name.value})};};
      const source=doc.createElement('input');source.setAttribute('aria-label',t("Image URL {0}",index+1));source.placeholder=item.src?.startsWith('data:')?t("Embedded image — enter URL to replace"):'https://…';source.value=item.src?.startsWith('data:')?'':item.src??'';
      source.oninput=()=>{source.setCustomValidity('');draft[index]={...draft[index],src:source.value.trim() || (item.src?.startsWith('data:')?item.src:'')};};
      const actions=doc.createElement('div');actions.style.cssText='display:flex;gap:4px';
      const up=button(t("Move item {0} up",index+1),'arrow-up',()=>{[draft[index-1],draft[index]]=[draft[index]!,draft[index-1]!];render(index-1);});up.disabled=index===0;
      const down=button(t("Move item {0} down",index+1),'arrow-down',()=>{[draft[index+1],draft[index]]=[draft[index]!,draft[index+1]!];render(index+1);});down.disabled=index===draft.length-1;
      const remove=button(t('Remove item {0}',index+1),'x',()=>{draft.splice(index,1);render(Math.min(index,draft.length-1));});
      actions.append(up,down,remove);fields.append(name,source,actions);row.append(preview,fields);list.append(row);
    }
    if(!draft.length){const empty=doc.createElement('p');empty.textContent=people?t("No people yet. Add the first person."):t("No images yet. Add the first image.");list.append(empty);}
    if(focusIndex!==undefined)(list.children[focusIndex]?.querySelector('input') ?? add).focus();
  }
  const add=doc.createElement('button');add.type='button';add.textContent=people?t("Add person"):t("Add image");add.onclick=()=>{if(draft.length>=100){error.textContent=t("Use at most 100 items.");return;}draft.push({name:people?t("New person"):'',src:''});render(draft.length-1);};
  const apply=doc.createElement('button');apply.type='submit';apply.textContent=t("Apply");
  const cancel=doc.createElement('button');cancel.type='button';cancel.textContent=t("Cancel");cancel.onclick=()=>dialog.close();
  const actions=doc.createElement('div');actions.dataset.dialogActions='';actions.append(cancel,apply);
  form.onsubmit=event=>{event.preventDefault();try{for(const item of draft)if(item.src)url(item.src);if(JSON.stringify(draft)!==original)save(validateMediaValue(draft));dialog.close();}catch(cause){error.textContent=cause instanceof Error?t(cause.message):t("Unable to save media.");}};
  render();form.append(list,add,error,actions);dialog.append(title,hint,form);return dialog;
}

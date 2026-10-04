export interface MediaItem { readonly src?: string; readonly name?: string; readonly alt?: string; readonly id?: string | number; }
export type MediaValue = string | readonly (string | MediaItem)[];

export function parseMediaValue(text: string): MediaValue {
  if (!text.trim()) return [];
  return text.trimStart().startsWith('[') ? validateMediaValue(JSON.parse(text)) : text;
}
export function validateMediaValue(value: unknown): MediaValue {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value) || value.length > 100) throw new TypeError('Use at most 100 images or people per cell.');
  return Object.freeze(value.map(item => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['src','name','alt','id'].includes(key)) ||
      ['src','name','alt'].some(key => item[key] !== undefined && typeof item[key] !== 'string') ||
      item.id !== undefined && typeof item.id !== 'string' && (typeof item.id !== 'number' || !Number.isFinite(item.id)) || !item.src && !item.name) throw new TypeError('Invalid image or person.');
    return Object.freeze({...item}) as MediaItem;
  }));
}
export function mediaItems(value: unknown): readonly MediaItem[] {
  try { const valid=validateMediaValue(value ?? []);return (typeof valid==='string' ? valid ? [valid] : [] : valid).map(item=>typeof item==='string'?{src:item}:item); }
  catch { return []; }
}

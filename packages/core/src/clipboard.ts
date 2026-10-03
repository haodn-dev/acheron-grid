import { clipboardCellLimit, clipboardTextLimit, encodeTsv } from './tsv.js';

export interface ClipboardBlock { readonly row:number; readonly column:number; readonly values:readonly (readonly string[])[]; }
export const gridClipboardType='application/x-acheron-grid+json';
export function encodeBlocks(blocks:readonly ClipboardBlock[]):string {
  const text=JSON.stringify({version:1,blocks});
  if(text.length>clipboardTextLimit)throw new RangeError('Clipboard text is too large.');
  return text;
}
export function decodeBlocks(text:string):ClipboardBlock[] {
  if(typeof text!=='string'||text.length>clipboardTextLimit)throw new RangeError('Clipboard text is too large.');
  const payload:unknown=JSON.parse(text);
  if(!payload||typeof payload!=='object'||!('version' in payload)||payload.version!==1||!('blocks' in payload)||!Array.isArray(payload.blocks)||!payload.blocks.length||payload.blocks.length>128)throw new TypeError('Invalid grid clipboard payload.');
  let cells=0;
  return payload.blocks.map((block:unknown)=>{
    if(!block||typeof block!=='object'||!('row' in block)||!('column' in block)||!Number.isSafeInteger(block.row)||!Number.isSafeInteger(block.column)||Number(block.row)<0||Number(block.column)<0||!('values' in block)||!Array.isArray(block.values)||!block.values.length)throw new TypeError('Invalid clipboard block.');
    const width=Array.isArray(block.values[0])?block.values[0].length:0;
    if(!width||block.values.some((row:unknown)=>!Array.isArray(row)||row.length!==width||row.some(value=>typeof value!=='string')))throw new TypeError('Invalid clipboard cells.');
    cells+=block.values.length*width;if(cells>clipboardCellLimit)throw new RangeError('Clipboard has too many cells.');
    return {row:Number(block.row),column:Number(block.column),values:block.values as string[][]};
  });
}
export function blocksToTsv(blocks:readonly ClipboardBlock[]):string {
  if(!blocks.length)return '';
  const aligned=blocks.every(block=>block.row===blocks[0]!.row&&block.values.length===blocks[0]!.values.length);
  let rows:string[][];
  if(aligned)rows=blocks[0]!.values.map((_,i)=>blocks.flatMap(block=>[...block.values[i]!]));
  else {
    const width=Math.max(...blocks.map(block=>block.values[0]!.length));
    if(blocks.reduce((sum,block)=>sum+block.values.length*width,0)>clipboardCellLimit)throw new RangeError('Packed clipboard has too many cells.');
    rows=blocks.flatMap(block=>block.values.map(row=>[...row,...Array<string>(width-row.length).fill('')]));
  }
  if(rows.length*rows[0]!.length>clipboardCellLimit)throw new RangeError('Clipboard has too many cells.');
  const text=encodeTsv(rows);if(text.length>clipboardTextLimit)throw new RangeError('Clipboard text is too large.');return text;
}

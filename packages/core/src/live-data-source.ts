import { LocalDataSource } from './data-source.js';
import type { DataSource, DataRow, RowId } from './data-source.js';

export interface LiveUpdate {
  readonly streamId: string;
  readonly sequence: number;
  readonly changes: readonly { readonly rowId: RowId; readonly columnKey: string; readonly value: unknown }[];
}
export interface LiveSnapshot { readonly streamId: string; readonly sequence: number; readonly rows: readonly DataRow[]; }

/** Read-only local live cache. Transport, scheduling and engine refresh belong to the host. */
export function createLiveDataSource(options: { readonly streamId: string; readonly columnKeys: readonly string[]; readonly maxRows?: number; readonly maxPendingCells?: number }) {
  const maxRows=options.maxRows ?? 10_000, maxPendingCells=options.maxPendingCells ?? 10_000;
  const keys=new Set(options.columnKeys);
  if(typeof options.streamId!=='string'||!options.streamId||![maxRows,maxPendingCells].every(n=>Number.isSafeInteger(n)&&n>0)||!Array.isArray(options.columnKeys)||!keys.size||keys.size!==options.columnKeys.length||[...keys].some(key=>typeof key!=='string'||!key))throw new TypeError('Invalid live source options.');
  let streamId=options.streamId, sequence=0, stale=true, destroyed=false;
  let source=new LocalDataSource<Record<string,unknown>>([],(_,i)=>i);
  let indices=new Map<RowId,number>();
  const pending=new Map<string,{rowIndex:number;columnKey:string;value:unknown}>();
  function alive():void {if(destroyed)throw new Error('Live source is destroyed.');}
  function invalidate():false {stale=true;pending.clear();return false;}
  const dataSource:DataSource={getRowCount:()=>{alive();return source.getRowCount();},getRowId:row=>{alive();return source.getRowId(row);},getValue:(row,key)=>{alive();return source.getValue(row,key);}};
  return Object.freeze({
    ...dataSource,
    get streamId(){return streamId;}, get sequence(){return sequence;}, get stale(){return stale;}, get pendingCellCount(){return pending.size;},
    reset(next:string):void {alive();if(typeof next!=='string'||!next)throw new TypeError('Invalid stream ID.');streamId=next;sequence=0;invalidate();},
    disconnect():void {alive();invalidate();},
    replaceSnapshot(snapshot:LiveSnapshot):boolean {
      alive();if(snapshot.streamId!==streamId)return false;
      if(!Number.isSafeInteger(snapshot.sequence)||snapshot.sequence<0||!Array.isArray(snapshot.rows)||snapshot.rows.length>maxRows)throw new TypeError('Invalid live snapshot.');
      if(snapshot.sequence<sequence)return false;
      const rows=Array.from(snapshot.rows,row=>{
        if(!row||!row.values||typeof row.values!=='object'||Array.isArray(row.values)||[...keys].some(key=>!Object.hasOwn(row.values,key)))throw new TypeError('Invalid live row.');
        return Object.fromEntries([...keys].map(key=>[key,row.values[key]]));
      });
      const next=new LocalDataSource(rows,(_,i)=>snapshot.rows[i]!.id);
      const nextIndices=new Map(snapshot.rows.map((row,i)=>[row.id,i]));
      source=next;indices=nextIndices;sequence=snapshot.sequence;stale=false;pending.clear();return true;
    },
    receive(message:LiveUpdate):boolean {
      alive();if(message.streamId!==streamId||stale)return false;
      if(!Number.isSafeInteger(message.sequence)||message.sequence<0)throw new TypeError('Invalid live sequence.');
      if(message.sequence<=sequence)return false;
      if(message.sequence!==sequence+1)return invalidate();
      if(!Array.isArray(message.changes)||message.changes.length>maxPendingCells)return invalidate();
      const staged=new Map<string,{rowIndex:number;columnKey:string;value:unknown}>();
      for(const change of Array.from(message.changes)) {
        if(!change||!keys.has(change.columnKey)||!indices.has(change.rowId))return invalidate();
        staged.set(JSON.stringify([change.rowId,change.columnKey]),{rowIndex:indices.get(change.rowId)!,columnKey:change.columnKey,value:change.value});
      }
      if(pending.size+[...staged.keys()].filter(key=>!pending.has(key)).length>maxPendingCells)return invalidate();
      for(const [key,value] of staged)pending.set(key,value);
      sequence=message.sequence;return true;
    },
    flush():number {alive();if(stale)return 0;const updates=[...pending.values()];source.setValues(updates);pending.clear();return updates.length;},
    destroy():void {if(destroyed)return;destroyed=true;pending.clear();indices.clear();source=new LocalDataSource([],(_,i)=>i);},
  });
}

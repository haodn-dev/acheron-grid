import type { DataSource, RowId } from './data-source.js';

export interface PageState { readonly offset: number; readonly status: 'loading' | 'ready' | 'error'; readonly error?: unknown; }
export interface AsyncDataSourceOptions<S> {
  readonly rowCount?: number;
  readonly pageSize?: number;
  readonly maxPages?: number;
  readonly createAbortController: () => { readonly signal: S; abort(): void };
  readonly load: (request: { readonly offset: number; readonly limit: number; readonly signal: S }) => Promise<{ readonly rows: readonly Readonly<Record<string, unknown>>[]; readonly total: number }>;
  /** Stable positional identity within one server query; reset() begins a new query. */
  readonly getRowId?: (index: number) => RowId;
}

/** Explicit asynchronous loading around a synchronous, read-only cache. No browser globals. */
export function createAsyncDataSource<S>(options: AsyncDataSourceOptions<S>) {
  const pageSize=options.pageSize ?? 100, maxPages=options.maxPages ?? 10;
  let count=options.rowCount ?? 0, destroyed=false, generation=0;
  if(![pageSize,maxPages].every(value=>Number.isSafeInteger(value)&&value>0)||!Number.isSafeInteger(count)||count<0)throw new RangeError('Invalid async source dimensions.');
  const pages=new Map<number,readonly Readonly<Record<string,unknown>>[]>();
  const states=new Map<number,PageState>();
  const pending=new Map<number,{controller:ReturnType<typeof options.createAbortController>;promise:Promise<void>}>();
  const listeners=new Set<(state:PageState)=>void>();
  const observerErrors:unknown[]=[];
  function emit(state:PageState):void {states.set(state.offset,Object.freeze(state));for(const listener of [...listeners])try{listener(state);}catch(error){observerErrors.push(error);if(observerErrors.length>10)observerErrors.shift();}}
  function alive():void {if(destroyed)throw new Error('Async data source is destroyed.');}
  function index(row:number):void {alive();if(!Number.isSafeInteger(row)||row<0||row>=count)throw new RangeError('Invalid async row index.');}
  function loadPage(offset:number):Promise<void> {
    alive();if(!Number.isSafeInteger(offset)||offset<0||offset%pageSize)throw new RangeError('Page offset must align with pageSize.');
    const existing=pending.get(offset);if(existing)return existing.promise;
    if(pages.has(offset)){const cached=pages.get(offset)!;pages.delete(offset);pages.set(offset,cached);return Promise.resolve();}
    const controller=options.createAbortController(), revision=generation;
    const promise=Promise.resolve().then(()=>{if(destroyed||revision!==generation||pending.get(offset)?.controller!==controller)throw new Error('Page load canceled.');return options.load({offset,limit:pageSize,signal:controller.signal});}).then(result=>{
      if(destroyed||revision!==generation||pending.get(offset)?.controller!==controller)return;
      if(!Number.isSafeInteger(result.total)||result.total<0||!Array.isArray(result.rows)||result.rows.length>pageSize||offset+result.rows.length>result.total||result.rows.length!==Math.max(0,Math.min(pageSize,result.total-offset)))throw new TypeError('Invalid page result.');
      const rows=result.rows.map(row=>{if(!row||typeof row!=='object'||Array.isArray(row))throw new TypeError('Invalid page row.');return Object.freeze({...row});});
      count=result.total;pages.set(offset,rows);
      while(pages.size>maxPages){const evicted=pages.keys().next().value!;pages.delete(evicted);states.delete(evicted);}
      emit({offset,status:'ready'});
    }).catch(error=>{if(destroyed||revision!==generation||pending.get(offset)?.controller!==controller)return;emit({offset,status:'error',error});throw error;}).finally(()=>{if(pending.get(offset)?.controller===controller)pending.delete(offset);});
    pending.set(offset,{controller,promise});emit({offset,status:'loading'});return promise;
  }
  function cancel():void {generation++;for(const item of pending.values())item.controller.abort();pending.clear();for(const [offset,state] of states)if(state.status==='loading')states.delete(offset);}
  const source:DataSource={getRowCount:()=>{alive();return count;},getRowId:row=>{index(row);return options.getRowId?.(row) ?? row;},getValue:(row,key)=>{index(row);return pages.get(Math.floor(row/pageSize)*pageSize)?.[row%pageSize]?.[key];}};
  return Object.freeze({
    ...source,
    pageSize,
    loadPage,
    loadRange:(start:number,end:number)=>{alive();if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||Math.floor(end/pageSize)-Math.floor(start/pageSize)+1>maxPages)throw new RangeError('Load range must fit the page cache.');return Promise.all(Array.from({length:Math.floor(end/pageSize)-Math.floor(start/pageSize)+1},(_,i)=>loadPage((Math.floor(start/pageSize)+i)*pageSize))).then(()=>{});},
    getPageState:(offset:number)=>states.get(offset) ?? null,
    subscribe:(listener:(state:PageState)=>void)=>{alive();listeners.add(listener);return()=>{listeners.delete(listener);};},
    takeObserverErrors:()=>observerErrors.splice(0),
    cancel,
    reset:(rowCount=0)=>{alive();if(!Number.isSafeInteger(rowCount)||rowCount<0)throw new RangeError('Invalid row count.');cancel();pages.clear();states.clear();count=rowCount;},
    destroy:()=>{if(destroyed)return;cancel();destroyed=true;pages.clear();states.clear();listeners.clear();observerErrors.length=0;},
  });
}

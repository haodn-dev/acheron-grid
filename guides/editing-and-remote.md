# Editing, display and remote writes

These APIs are **Unreleased source preview**. Build matching packages from the recorded source revision; they are absent from npm 0.1.0. Commands reuse engine validation, permissions, atomic batches and bounded history.

## Paste special

```ts
engine.select(0, 0);
engine.paste('10\t20\n30\t40', { mode: 'values', transpose: true });
engine.paste('\t7', { skipEmpty: true });
const blocks = engine.copySelectionBlocks();
engine.pasteSelectionBlocks(blocks, { mode: 'formats' });
```

Canvas exposes the same `paste` and `pasteSelectionBlocks` options and menu actions. Use `selectRow` or pointer/keyboard selection in Canvas; `select` belongs to the headless engine.

| Option | Contract |
| --- | --- |
| `mode: 'all'` (default) | Paste values and supported structured formatting |
| `mode: 'values'` | Ignore source formats; preserve destination formats |
| `mode: 'formats'` | Apply structured formats; retain destination values; check formatting permission without invoking value parsers/setters |
| `transpose: true` | Swap block positions, matrix dimensions and format coordinates |
| `skipEmpty: true` | Skip cells whose clipboard string is exactly empty; whitespace and `0` remain values |

Options combine. Format-only TSV has no format payload and does not change formatting. An empty format object does not clear destination formatting; use `format(targets, patch)` with null fields to clear. Normal paste parses text and checks every destination before any write. One-cell payloads broadcast to the selection; larger matrices do not tile or create rows. Same-engine cut remains a normal move; special paste copies the payload and never silently deletes the cut source. Existing limits remain 100,000 cells and 10 million UTF-16 code units. Structured clipboard is versioned, does not deserialize callbacks and cannot preserve every external application's style.

## Hide rows and columns

```ts
engine.setRowsHidden([1, 3], true);
engine.setColumnsHidden([2], true);
engine.setRowsHidden(engine.getHiddenRows(), false);
engine.setColumnsHidden(engine.getHiddenColumns(), false);
```

Both engine and Canvas expose these methods plus `getHiddenRows`, `getHiddenColumns`, `isRowHidden` and `isColumnHidden`. Row arguments are indices in the current projection; source identity and saved hidden state follow the record through local sort, move, refresh and undo. `getHiddenRows` omits records excluded by a filter or collapsed group: clear that view before unhiding every source record.

Hidden axes have zero rendered size and keep their stored positive size, raw data, formats and locks. Canvas skips them in paint, hit testing, keyboard movement, search and viewport ARIA. Context menus expose hide/show actions; Shift+F10 can recover an entirely hidden layout. `canChangeVisibility({axis, indices, hidden})` receives source row/current column indices and can veto an atomic visibility command; table lock also blocks it. Undo/redo rechecks the policy. Hiding clears selection and pending cut; it does not delete data. Programmatic logical selection and rectangular clipboard ranges can still include hidden cells: hiding is not authorization. Use cell permissions to restrict data.

## Numeric display formats

```ts
grid.format([{scope:'column', columnIndex:0}], {numberFormat:'currency'});
grid.format([{scope:'cell', rowIndex:0, columnIndex:0}], {numberFormat:'percent'});
grid.format([{scope:'table'}], {numberFormat:null});
```

Formats are `decimal`, `integer`, `percent` and `currency`. Sparse table/row/column/cell precedence, permissions, undo, structured clipboard and saved state use the existing format pipeline. Null removes that layer; a more specific layer still wins. Canvas uses native `Intl.NumberFormat`: decimal and percent have at most two fractional digits, integer zero, currency follows its ISO currency digits. Percent treats `0.25` as 25%. Default currency is USD; set `currency:'VND'` at construction. Without `numberFormat`, display retains raw string behavior. Non-numeric values are never coerced. Painting, search, ARIA and auto-fit use formatted numbers; editors and custom renderer callbacks retain raw values. Sorting, filters and value validation operate on raw data. Numeric text parsing remains column/host-owned; localized display does not turn an editor's `1.234,5` into a number automatically.

## Canvas localization

```ts
import {createGrid, canvasEnglishMessages, canvasVietnameseMessages} from '@acheron-grid/canvas';
const grid = createGrid({
  container, columns, dataSource,
  locale:'vi-VN', currency:'VND',
  messages:{'Copy':'Chép dữ liệu'},
});
```

English and Vietnamese UI packs are bundled. `locale` selects native number formatting; Vietnamese locales select the Vietnamese messages, other locales retain English unless the host provides overrides. Supply a complete language pack using `canvasEnglishMessages` as the inventory. Keys are English defaults; `{0}`, `{1}` placeholders preserve dynamic row counts, status and destination values. Packs are snapshotted at construction. `createCanvasTranslator(locale, messages)` is available to extensions. Menus, dialogs, choice/media editors, search, progress and accessibility labels share the translator. Column titles, actual data, custom validation errors and host-rendered labels are host-owned and are not implicitly translated. Recreate the grid to change locale/currency. Native browser/OS input and clipboard prompts remain platform-owned.

## Bounded optimistic remote source

`createRemoteDataSource` adds synchronous atomic drafts backed by explicit asynchronous transport. It complements the read-only async page and live stream sources; it is a **full snapshot cache**, not a paged write adapter or a collaborative server.

```ts
import {createRemoteDataSource, createGridEngine} from '@acheron-grid/core';
const remote = createRemoteDataSource({
  datasetId:'people', columnKeys:['name'], maxRows:10_000, maxPendingCells:10_000,
  createAbortController:()=>new AbortController(),
  createMutationId:()=>crypto.randomUUID(),
  load:async signal=>{
    const response=await fetch('/api/people', {signal});
    if(!response.ok) throw new Error('Load failed');
    return response.json();
  },
  write:async (mutation, signal)=>{
    const response=await fetch('/api/people/mutations', {
      method:'POST', signal, headers:{'Content-Type':'application/json'},
      body:JSON.stringify(mutation),
    });
    if(!response.ok) throw new Error('Transport failed');
    return response.json();
  },
});
await remote.resync();
const engine=createGridEngine({dataSource:remote, columns:[{key:'name',title:'Name',editable:true}]});
engine.editCell(0,0,'Updated'); // validate and stage synchronously
const previousIds=engine.captureRowIdentity(); // BEFORE replacing source snapshots
await remote.commit();
if(remote.status==='ready' && remote.pendingCellCount===0) engine.refreshData(previousIds);
// On dispose: engine.destroy(); remote.destroy();
```

The application must implement the endpoints; URLs above are illustrative. Enforce authentication, dataset/row/field authorization, server validation and atomic compare-and-swap on `expectedRevision`. Store a durable result keyed by dataset and mutation ID, returning that same receipt for retries. Mutation IDs must stay unique for the server's idempotency-record lifetime. A lost response can mean the write already succeeded: a client retry must not apply it twice. Return logical rejected/conflict receipts as a successful transport response; unrelated HTTP failure remains uncertain.

Snapshot shape: `{datasetId, revision, rows:[{id, values:{name:...}}]}`. IDs must be unique strings or finite numbers, revision a nonempty string, fields configured by `columnKeys` present. Values and messages are JSON-safe: no undefined, functions, symbols, bigint, nonfinite numbers or cycles. Snapshots/requests are copied and deeply frozen; payload limit 10 million UTF-16 code units and depth 64. Default row/pending-cell limits are 10,000 each; staging batches additionally cap at 100,000 entries. Draft values remain host-owned until the immutable commit snapshot; mutate through engine commands rather than changing nested objects in place.

Mutation shape: `{datasetId, mutationId, expectedRevision, changes:[{rowId,columnKey,previous,value}]}`. Stable IDs address records independently of order. Server receipts:

```ts
{mutationId, status:'accepted', snapshot} // matching dataset; revision must advance
{mutationId, status:'conflict', snapshot} // authoritative matching dataset snapshot
{datasetId, mutationId, status:'rejected', message:'Validation failed'}
```

| State/action | Result |
| --- | --- |
| Ready edit | Optimistic atomic cache update; one engine history command |
| `commit()` | Freeze one mutation; deduplicate concurrent commit calls; block new drafts |
| Accepted | Adopt canonical snapshot, clear drafts, ready; host refreshes engine/history |
| Rejected | Keep draft, expose `lastError`, ready for correction or explicit discard |
| Transport failure / disconnect | Retain exact uncertain mutation and draft; block edits; send an unsent draft with `commit()`, or retry an uncertain request with the same payload/ID |
| Conflict | Keep draft and expose validated `conflict` snapshot; block edits until explicit resolution |
| `acceptServer()` | Adopt server snapshot, discard draft, clear conflict; host refreshes engine |
| `resync()` / `reconnect()` | Load fresh snapshot; refuse unsent drafts without `resync(true)`; always refuse uncertain mutations |
| `destroy()` | Abort/invalidate pending generation and release cache/observers; late results do not restore it |

For conflict review, capture `getPendingChanges()` and engine identity **before** `acceptServer()`, refresh afterward, then reapply chosen changes through engine validation by finding each stable row ID in the new view. Do not blindly replay previous coordinates or overwrite newer server data. Undo during unsent drafts can remove a pending value by restoring its original value. Engine refresh after accepted/server/resync snapshots clears old history and pending cut; saved metadata follows captured IDs. Refresh is application-owned, never automatic from the transport cache.

Subscribe to status changes for UI; `lastError`, `revision`, `pendingCellCount` and `conflict` expose the lifecycle. Observer errors are isolated and bounded. The host owns transport deadlines, backoff, online/offline scheduling, connectivity and retry controls. This module does not silently discard uncertain writes, choose winners, merge edits across users or persist drafts through process reload. The existing [remote save example](../examples/remote-save.md) remains a separate host-owned recipe for a fixed local draft.

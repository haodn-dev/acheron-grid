// Behavioral notes for the generated public API catalog.
export const coreContracts = {
  updateCellsAsync:
    'Cooperative typed batch preparation with host scheduling, cancellation and optional external revision guard. One final synchronous atomic write; other engine mutations are blocked while pending.',
  pasteAsync:
    'Cooperative TSV parsing/preflight with the same paste options, limits and permissions. One atomic commit/history entry. Structured clipboard operations remain synchronous.',
  undoAsync:
    'Cooperatively preflight value history, then replay atomically. Other history kinds and final commit remain synchronous; cancellation retains the entry.',
  redoAsync:
    'Cooperatively preflight value redo, then replay atomically. Current identity, values and authority are rechecked before commit.',
  setViewAsync:
    'Cooperative local filtering and stable merge sort with the same ordering as setView. Installs the completed projection once; server queries belong to the data source.',
  subscribe:
    'Register independent event/invalidation observers. Returns an unsubscribe function; callbacks observe committed state and cannot perform nested mutations. Registration requires a live engine.',
  takeObserverErrors:
    'Drain the bounded observer error queue without changing data or history. Observer failures do not roll back committed commands.',
  captureRowIdentity:
    'Capture source row IDs before an external structural change. This explicit operation scans every source row; call refreshData with the captured IDs afterward.',
  refreshData:
    'Reconcile external source changes and clear history/pending cut. Values mode requires unchanged IDs/order/count; an ID snapshot enables remapping; without IDs row-dependent metadata is dropped.',
  sourceRowCount:
    'Number of source rows, before local filtering or collapsed groups. This differs from the visible rowCount.',
  getRowId:
    'Resolve a visible row to its stable source ID. Invalid row indices are rejected by the source/mapping contract.',
  columns:
    'Frozen snapshots of the current column definitions in current display order. Application callbacks remain trusted code.',
  rowCount:
    'Visible row count after local view and collapsed-group projection; use sourceRowCount for the unprojected count.',
  getValue:
    'Read a raw value using a visible row and column key. No parsing/formatting occurs; missing or unloaded values may be undefined according to the source contract.',
  editCell:
    'Editor-style text command: resolve visible coordinates, require editable/writable, parse and validate before committing. Supports setValue or atomic setValues.',
  updateCells:
    'Typed-value updates: resolve visible rows, validate and require writable, without editor parsing or editable checks. Duplicate cells use the last value. Multi-cell changes require atomic setValues.',
  replaceText:
    'Source-only bounded literal replacement of string values in the view or selection. Requires editable/writable and validation; one atomic undo command. It is not a regular-expression API.',
  destroy:
    'Idempotently release engine-owned observers, history and selection. The host still owns source destruction/transport. Data/layout commands and clipboard operations reject after destruction; undo/redo return false. Do not use retained read getters as a live engine after disposal.',
  getSelection:
    'Current visible active cell, or null. It is not a source-coordinate address; use getRowSourceIndex when needed.',
  getSelectionRange:
    'Current active visible range, or null. Other retained selection ranges are available through getSelectionRanges.',
  getSelectionRanges:
    'Visible selection ranges including retained ranges. Projection can split source ranges into multiple visible fragments; serialization has explicit fragment limits.',
  select:
    'Select a visible cell, or extend from the anchor when extend is true. Selectable policy can veto; returns whether selection changed.',
  selectRange:
    'Select an inclusive visible rectangle with replace/add/extend semantics. Validate bounds, policies and projected fragmentation before changing selection.',
  addSelection:
    'Retain the existing selection and add a visible active cell. Subject to selectable policy and range/fragment limits.',
  clearSelection:
    'Clear active/retained selection and anchor, with selection invalidation/events when changed. Does not change values or create a value-history command.',
  cutSelectionBlocks:
    'Stage a same-engine cut and return structured clipboard text. Data is not deleted until a successful matching paste commit.',
  cancelCut:
    'Cancel the staged cut without modifying data. It is harmless when no cut exists, including after disposal. Host clipboard ownership remains separate.',
  pasteCutSelectionBlocks:
    'Move a matching staged cut to the selected destination after complete validation/permissions/conflict preflight. A failed operation preserves source values.',
  copySelectionBlocks:
    'Return versioned structured clipboard text including supported formatting through copy permissions. Values use string clipboard encoding; fragment/cell/text limits apply.',
  pasteSelectionBlocks:
    'Decode structured clipboard text and atomically preflight values/formats. PasteOptions supports all/values/formats, transpose and skipEmpty; format-only bypasses parsers/value writes and checks format permission. Clipboard strings never execute callbacks.',
  copySelection:
    'Return packed TSV through copy permissions. Core does not access the operating-system clipboard; cell/fragment/text limits apply.',
  paste:
    'Parse TSV/editor text and atomically preflight destinations, parsing, permissions and validation. PasteOptions supports all/values/formats, transpose and skipEmpty; TSV carries no formats. Empty means an empty clipboard string, not whitespace.',
  undo: 'Replay the most recent command under current identity/value/permission checks. Return false when no command exists; conflicts can reject without changing history/data.',
  redo: 'Replay a previously undone command under current identity/value/permission checks. A new committed command clears redo; refresh clears both stacks.',
  canUndo:
    'Whether a live engine has an undo entry. This is not a guarantee that current policies/identities/values will permit replay.',
  canRedo: 'Whether a live engine has a redo entry. Replay still checks current policies and conflicts.',
  exportState:
    'Export versioned domain UI state and selection/metadata. Excludes source data, callback policies, transport and history; identity capture can scan source rows.',
  restoreState:
    'Stage and validate unknown saved state, including current layout/structure/lock/format policies, before committing. Application callbacks/policies are never supplied by saved state.',
  setView:
    'Set a core-owned local sort/filter view; this scans local source data and is not a server query. Preserve stable source identities; clear projected views before structural commands.',
  view: 'Current immutable local sort/filter criteria. This does not represent a remote query or an arbitrary host projection.',
  exportConfiguration:
    'Export JSON-safe column order/widths, frozen counts and local view. Excludes data, callbacks, selection and undo history.',
  getMergedCells:
    'Return merge spans in source row coordinates. Use getMerge for a visible-cell lookup; merged metadata is separate from cell values.',
  getMerge:
    'Find the merge containing a visible cell and return its visible bounds, or null. Source metadata uses getMergedCells.',
  canMerge:
    'Preflight an inclusive visible merge range against bounds, existing merges, projected view, feature flags and layout policies. No mutation occurs.',
  mergeCells:
    'Create a permitted rectangular merge without combining or deleting raw values. Validate before changing metadata; participates in layout history.',
  unmergeCells:
    'Remove merges intersecting the requested visible range, subject to current layout policy. Underlying values are retained.',
  getRowGroups:
    'Return nested manual row-group metadata in source coordinates. These are not computed group-by aggregations.',
  groupRows:
    'Create a manual source-row group from inclusive source indices, subject to grouping/layout rules. Projected views must be cleared for this structural layout operation.',
  ungroupRows: 'Remove a manual group by ID under layout policy. This does not delete source rows.',
  setGroupCollapsed:
    'Collapse/expand a manual group by ID, changing visible projection while preserving source rows. Current layout policy applies.',
  insertColumns:
    'Insert definitions before a current column index under structural policy; keys must be unique and the source must support initializing added fields.',
  deleteColumns:
    'Remove specified current column indices under structural policy and remap related metadata. The source retains its row fields for history/restoration.',
  insertRows:
    'Insert DataRow snapshots before a source row index under structural policy. Requires atomic source splices and valid unique IDs; projected views must be cleared.',
  deleteRows:
    'Delete selected source row indices under structural policy, preserving full shallow row snapshots for undo. Requires source row snapshots/splices.',
  moveRows:
    'Move source row indices before a source insertion position, preserving their relative order. Requires structural policy/source support and no projected view.',
  moveColumns:
    'Move current column indices before an insertion position, preserving their relative order and remapping metadata under structural policy.',
  getCellPermission:
    'Resolve policy capabilities for a visible cell, including current locks and explicit false vetoes. writable does not prove that the source exposes a setter; canEdit checks setter support. Server authorization remains host-owned.',
  getFormat:
    'Resolve supported formatting for a visible cell using sparse table/row/column/cell metadata. Raw source values are unchanged.',
  canFormat:
    'Preflight visible format targets against bounds and formatting policy. Format permission is independent of value writable permission.',
  format:
    'Apply or remove supported formatting on visible targets after complete validation/policy checks. Participates in formatting history; does not change source values.',
  isLocked:
    'Check the requested visible table/row/column/cell lock target. Lock metadata is a client capability constraint, not backend authorization.',
  canManageLocks:
    'Whether lock management is enabled for the engine. Target validation and command lifecycle still apply when changing locks.',
  setLocked:
    'Set or clear a validated visible lock target when lock changes are allowed. Value commands and history replay resolve current effective locks.',
  frozenRows:
    'Visible frozen leading row count after projection/group collapse, derived from the source frozen prefix.',
  frozenColumns: 'Current frozen leading column count. Freeze boundaries must fit the current structure.',
  getViewport:
    'Compute numeric scroll/frozen pane ranges, cell geometry and hit-testing for the visible layout. It does not load remote pages or prove renderer frame rate.',
  canChangeLayout:
    'Preflight a source-coordinate layout request against feature flags and current layout policy. A permission probe is not a committed command.',
  getRowSourceIndex:
    'Map a visible row index to its source row index. Use this explicitly at host/source boundaries; do not pass visible indices directly to a projected source.',
  rows: 'Read-only visible-row size/position/indexAt/range geometry. Sparse overrides do not allocate metadata for every source row.',
  columnsLayout:
    'Read-only current column size/position/indexAt/range geometry. Numeric viewport boundaries are end-exclusive; selection rectangles are inclusive.',
  canChangeStructure:
    'Preflight a source-coordinate structural request against current view, source support, locks and policy. No mutation occurs.',
  isRowHeightManual:
    'Whether a visible row has an explicit manual height override. Automatic measurement does not mark a row as manually resized.',
  measureRowHeight:
    'Apply a finite positive measured height to a visible row through layout policy, without adding a manual resize history entry.',
  canEdit:
    'Preflight edit capability for a visible cell, including source setter support and effective editable/writable permission. Actual parsing/validation can still reject an edit.',
  canPaste:
    'Whether current selection/source permissions permit paste in principle. Payload shape, bounds, parsing and validation are checked by the actual paste command.',
  setFrozen:
    'Set the requested visible leading row/column counts after validation/layout policy; collapsed groups map the row prefix to source coordinates. Participates in layout history; collapsed groups cannot cross a frozen boundary.',
  setRowsHidden:
    'Hide/show specified visible rows under table lock and canChangeVisibility policy. Retain underlying data, stored size and identity; clear selection/cut and record one undo command.',
  setColumnsHidden:
    'Hide/show current column indices under table lock and visibility policy; retain fields, widths and metadata. History replay rechecks the policy.',
  getHiddenRows:
    'Return hidden rows mapped into the current projection. Rows excluded by filters or collapsed groups are omitted; saved state retains source hidden indices.',
  getHiddenColumns: 'Return sorted hidden column indices in current display order.',
  isRowHidden:
    'Check the hidden flag at a visible row; invalid indices reject. Hidden is separate from filter/group projection.',
  isColumnHidden:
    'Check the hidden flag at a current column; invalid indices reject. Hiding is layout, not data authorization.',
  setColumnWidth: 'Set a finite positive current column width under layout policy, with sparse geometry and undo/redo.',
  setRowHeight:
    'Set a finite positive visible row height under layout policy, mark it manual and record layout history.',
};

export const coreExportContracts = {
  createPagedRemoteDataSource:
    'Create a bounded writable page cache with stable-ID drafts, server-owned query/revision, dirty-cohort receipts, exact uncertain retry and whole-cache invalidation after accepted writes. Load only required pages; reconcile engine identity/history after cache changes.',
  createGridEngine:
    'Create the headless domain instance from application-owned columns/source/policies. See the member contracts and construction options above.',
  LocalDataSource:
    'Shallow immutable local row snapshots with unique string/finite-number IDs, synchronous atomic batches and sequential atomic splices. Nested objects remain host-owned.',
  LocalDataView:
    'A fixed local projection using stable ties and nullish-last sorting. Delegated writes map view indices to underlying source indices; reconstruct the view to reapply criteria.',
  createAsyncDataSource:
    'Read-only synchronous cache with explicit asynchronous page/range loading. The host owns load scheduling, AbortController creation, engine refresh and dataset revision consistency.',
  createRemoteDataSource:
    'Bounded optimistic JSON snapshot cache with synchronous atomic drafts and explicit async commit/resync. Host server must provide atomic revision checks and mutation ID deduplication. Lost ACK retains an immutable retry; conflict requires explicit resolution.',
  createLiveDataSource:
    'Read-only bounded local cache of a host stream. Start with a matching snapshot; receive consecutive sequences, coalesce pending cells and flush explicitly. Gaps/disconnect require resync.',
  reorderedIndices:
    'Validate move indices/insertion position and return a new index order preserving relative order. It does not mutate rows, permissions or history.',
  gridClipboardType:
    'MIME identifier for the internal versioned structured clipboard format. TSV remains the external plain-text fallback.',
  encodeBlocks:
    'Validate clipboard block shape/limits and serialize string values plus supported formatting to the versioned wire payload. This is not an arbitrary object codec.',
  decodeBlocks:
    'Parse unknown structured clipboard text and validate schema, dimensions, supported formatting and budgets before use. It does not write to a source.',
  blocksToTsv:
    'Pack structured string blocks into TSV. Core command wrappers additionally enforce effective copy permissions; direct helper calls have no engine authorization context.',
  restoreGridConfiguration:
    'Validate unknown versioned configuration against application column definitions and row count; return construction options. Saved input cannot supply executable callbacks/policies.',
};

export const sourceContracts = {
  discardPending:
    'Paged remote: discard only unsent or rejected drafts and invalidate cached pages. An uncertain or conflicting mutation must be resolved first.',
  getRowCount: 'Synchronous row count of this source/view. Engine projection is a separate layer.',
  getRowId:
    'Read the ID using this source/view index. Async positional identity belongs to one query; the host must manage dataset revisions.',
  getValue:
    'Read a raw shallow value using this source/view index and key. Missing fields return undefined; async unloaded rows also return undefined, so inspect page state separately.',
  setValue:
    'Remote: stage one optimistic value only while ready. Local atomic single-value replacement, or an optional delegated view setter when the underlying source supports it. No engine permissions/history are applied by direct source writes.',
  setValues:
    'Remote: bounded atomic optimistic JSON-safe staging only while ready. Local atomic batch, or an optional mapped view batch when the underlying source supports it. Direct source changes require engine refresh and remain outside engine history.',
  getRow: 'Return a shallow row snapshot including hidden fields; nested values are caller-owned.',
  addColumns:
    'Validate new keys and initialize missing fields atomically while preserving existing fields/defaults. Direct use is outside engine history.',
  spliceRows:
    'Apply sequential row splices atomically with unique valid IDs and shallow snapshots. Capture engine IDs before external structure changes.',
  getSourceIndex:
    'Map a fixed LocalDataView index to the underlying source index. Rebuild the view after changes requiring new sorting/filtering.',
  pageSize: 'Validated positive page length fixed at construction; loadPage offsets must be aligned.',
  maxConcurrentLoads: 'Maximum active loader calls; a canceled loader must settle so its active slot can be released.',
  maxPendingLoads:
    'Maximum active plus queued loads. Duplicate pages share a promise; admission failures occur before scheduling extra work.',
  query:
    'Immutable captured server criteria. Each load receives the snapshot for its generation; this is not local sorting of cached rows.',
  setQuery:
    'Validate new criteria/count, clear cache/statuses and cancel the previous generation. The host must reconcile the engine and identity after a query change.',
  loadPage:
    'Load one aligned nonnegative offset with deduplication/FIFO concurrency. Validate result dimensions; errors reject, canceled/stale results do not repopulate cache.',
  loadRange:
    'Load inclusive source indices start through end. The requested pages must fit the cache and pending capacity before admission.',
  getPageState:
    'Return state for a page offset or null; error/ready bookkeeping is bounded and eviction can remove it. This is not a per-cell loaded-state API.',
  subscribe:
    'Observe page state changes; returns unsubscribe. Observer exceptions are isolated in a bounded queue; engine refresh is host-owned.',
  takeObserverErrors: 'Drain up to the last ten isolated page observer errors. This does not retry failed loads.',
  cancel:
    'Invalidate the request generation and signal pending controllers without clearing completed cache/count. Safe cleanup after disposal; loaders must settle/timeout.',
  reset:
    'Async: clear cache/statuses and cancel generation, retaining query with the supplied count. Live: change stream, clear pending changes and mark stale; retain old data until a matching snapshot.',
  destroy:
    'Idempotent disposal of owned cache/queues/observers. Data access and active loads require a live source; cleanup/status probes follow their specific contract. The host owns external transport resources.',
  streamId: 'Current host stream identifier; messages/snapshots for another stream are ignored.',
  sequence: 'Latest accepted sequence, including buffered updates not yet flushed. It is not a saved backend revision.',
  stale:
    'Whether a fresh snapshot is required. Read-only retained values can still exist while stale; do not treat them as current.',
  status:
    'Remote lifecycle: disconnected/loading/ready/committing/conflict/destroyed. Only ready permits drafts; pending uncertain writes block new edits.',
  revision: 'Remote authoritative snapshot revision; optimistic drafts do not advance it.',
  lastError: 'Most recent remote load/transport/validation rejection; a valid installed snapshot clears it.',
  getPendingChanges:
    'Return frozen remote draft entries keyed by stable row ID and column key. Preserve these before explicitly accepting a conflicting server snapshot.',
  conflict:
    'Validated remote server snapshot on conflict, or null. Draft values remain in the cache until explicit adoption.',
  commit:
    'Commit one immutable mutation against expectedRevision. Bounded remote concurrent calls share the promise; paged concurrent calls reject. Lost responses retain the exact request for retry. Acceptance clears drafts; paged acceptance invalidates pages without fetching them. Rejection retains correctable drafts; conflict blocks editing.',
  resync:
    'Load a fresh bounded remote snapshot. Unsent drafts require explicit discardPending=true; an uncertain mutation cannot be discarded. Capture engine identity first and refresh afterward.',
  reconnect:
    'Remote resync without discarding drafts; retry an uncertain commit first. Transport reconnection itself belongs to the host.',
  acceptServer:
    'Explicitly adopt a validated conflicting remote snapshot and discard its drafts. Host refreshes engine and may reapply selected saved drafts through validation.',
  pendingCellCount:
    'Number of unique buffered destination cells after bounded coalescing; not the count of received messages.',
  disconnect:
    'Remote: abort/invalidate the active generation but retain drafts and uncertain mutation for exact retry. Live: mark the live source stale and discard buffered updates; does not itself reconnect transport or remove retained rows.',
  replaceSnapshot:
    'Validate a matching-stream snapshot with bounded rows, unique IDs and configured fields, then atomically replace the local cache. Reject older/wrong-stream snapshots without installing them.',
  receive:
    'Accept only matching-stream consecutive sequences when not stale; coalesce cells without writing them yet. Gaps, invalid destinations or capacity overflow mark stale and clear pending changes.',
  flush:
    'Apply buffered live changes atomically and return the number of unique updated cells. Returns zero while stale; the host refreshes the engine after flushing.',
};

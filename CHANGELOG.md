# Changelog

## Unreleased — bounded data workflows

- Accept canonical cell delta receipts in the bounded remote source without reloading or replacing unrelated rows. Validate base/new revisions, mutation coverage and the entire receipt before applying it.
- Add explicit cooperative paste, typed update, value-history and local-view APIs with host scheduling, cancellation and revision guards. Preparation yields; the final atomic commit and structural history remain synchronous.
- Add configurable retained command/value-change history budgets and Canvas busy/focus handling. These source-preview APIs do not guarantee a frame-time budget and are not included in npm 0.1.0.

## Unreleased — integration readiness

- Generate MCP declarations from TypeScript while preserving the existing server factory. Add structured error codes, a host-controlled schema row-count policy and post-write revision receipts with an explicit revision-unavailable success fallback.
- Add a runnable HTTP remote-editing example with pending, rejected, retry and conflict review states. Its process-local backend checks revisions and deduplicates uncertain retries; production authorization and durable storage remain host responsibilities.
- Add desktop/mobile-viewport axe checks to the remote playground and correct invalid `aria-rowspan` on button-role headers. Manual assistive-technology and physical-device acceptance remains open.
- Reduce batch coordinate-key allocation without changing mutation order, validation, duplicate handling or history. Large commands remain synchronous.
- Update development and packed-consumer Vue to 3.5.43. Publish an English architecture guide and complete contribution verification instructions. No package release is made by these source changes.

## Unreleased — MCP application workflow

- Optional host-managed dataset revisions detect stale reads, pagination and writes while retaining per-cell expected-value checks.
- Runnable application-owned task session over stdio, read-only by default, with bounded JSON input and controlled in-memory status writes.
- End-to-end SDK checks and a separate real-model evaluation protocol; no browser bridge or model-quality claim.

## Unreleased

- Change original Acheron source and future package distributions from MIT to Apache-2.0; ship LICENSE/NOTICE in every package. Preserve third-party notices and the license of already published 0.1.0 artifacts.

- Add atomic paste special (values/formats/transpose/skip-empty), undoable hidden axes, numeric display formats and complete English/Vietnamese Canvas message packs with host overrides.
- Add a bounded optimistic remote snapshot source with validated JSON writes, durable-server-idempotency contract, exact uncertain retry, explicit reconnect/resync and conflict adoption. Existing async paging remains read-only.

- Preserve native checkbox drafts and context-menu keyboard focus in WebKit; read the current reduced-motion preference before layout animation. Extend browser CI beyond smoke coverage, keeping Chromium-only clipboard permission and CDP touch checks explicit. Add browser command task-delay benchmark evidence.

- Complete the headless API behavior/export/type catalog and prevent undocumented new engine members during documentation sync. Clarify source/view coordinates, capability probes and disposal ownership; add regression checks for source write support and permission-sensitive replay.

- Add verified npm develop/stable release workflows, aligned workspace version tooling, registry consumer checks, and trusted publishing setup instructions.

- Core accepts atomic batch-only sources for editing, discards collapsed groups moved across frozen boundaries during identity refresh, and bounds projected selection/clipboard fragmentation. Collapsed frozen-row counts are cached between state changes.
- Async page totals invalidate older positional caches; empty pages beyond a shrinking total update the count and remain reloadable, with range capacity checked before admission. Host dataset revision consistency remains required.
- Consumer documentation now includes the complete core contract/limit matrix, an executable lifecycle example and independent source/release document revisions on the website.

- Harden CSV controls/full-width formula prefixes and anonymous image loading in details/previews. Document host security boundaries and update the build dependency fixing its Windows development-server advisory.

- React/Vue dispose newly created grids when initialization fails. Media uploads report progress/cancel, bound concurrent jobs per paste and guard every broadcast destination against asynchronous overwrite.

- Bounded literal find/replace goes through editable/writable validation and one undo command; Canvas exposes replaceText and a read-only getValue query.
- Optional XLSX export writes scalar values and literal strings to one sheet, with copy permissions, Unicode/XML checks and archive budgets. ZIP dependency stays outside core.

- Read-only live cache supports stable-ID snapshots, consecutive sequences, bounded cell coalescing, atomic flush and stale/resync handling. Host owns transport and scheduling.
- Optional free inline charts module renders line, column and horizontal bar series with gaps, signed baselines and a bounded point budget. Source preview, not yet published.

- Host-owned remote save example covers local drafts, revision/idempotency receipts, validation/conflict preservation, explicit rollback and late-response guards without changing synchronous DataSource writes.

- Async sources capture immutable server sort/filter queries per request. Validated query changes cancel old loads and clear cache; reset retains the query. Host owns backend execution and engine refresh.

- Optional free CSV export module reuses core copy permissions, supports quoted text/headers/BOM and default formula-text escaping. Source preview, not yet published.

- MCP supports opt-in authorized row discovery, a bounded single-pass ID lookup or checked host resolver, and UTF-8 output budgets checked before write commit.

- Multi-column local sort criteria preserve stable ties, nullish-last ordering, outline blocks, identity and state/history behavior. Canvas headers expose sorted keys; the existing single-column dialog replaces the criteria.

- Async sources bound loader concurrency and pending pages, deduplicate queued work and preflight range capacity. Defaults are four concurrent and 100 pending loads; canceled loaders retain slots until they settle.
- Core benchmarks cover allocated local data, sorting/filtering, batch/paste/history, atomic veto, refresh and state round-trips with correctness checks and environment metadata.

## 0.1.0 — Development preview

The original six packages are published on npm at 0.1.0. The export module and changes under Unreleased are not part of that release.

### Features

- Headless TypeScript engine, synchronous atomic mutations, capability permissions, validation warnings/rejections, typed events and undo/redo.
- Sparse layout, frozen panes, multi-range and whole-axis selection, structural operations, merged cells, nested manual row groups and local sort/filter.
- TSV and structured clipboard, scalar broadcast, atomic same-grid cut, persistent animated copy outlines and reduced-motion support.
- Canvas editors, searchable select/multiselect and context menus, rich text, optional Markdown, custom renderer/editor hooks and remote choice loaders.
- Multiple images and avatars per cell, media gallery, image clipboard and optional host upload integration.
- Automatic basic link popups with optional, host-controlled website metadata.
- Versioned configuration/domain state, identity-aware refresh, multiple subscriptions and isolated observer errors.
- Explicit read-only async paging with cancellation, bounded successful pages and bounded recent error states.
- React/Vue lifecycle adapters and optional MCP documentation/host-authorized cell tools.

### Correctness and distribution

- Restore respects structural vetoes, requires an unlocked table, checks removed outline/format permissions and retains projected selection extension.
- Remote values use own properties; missing fields cannot resolve inherited object members.
- Successful paste selects the destination; rejected paste preserves state and does not clear cut sources.
- Clean typecheck builds dependency declarations. CI includes Node 22/24, Chromium, standalone playground and an independent packed-package consumer.
- MCP server reports version 0.1.0.

### Known limits

APIs remain experimental. Remote writes and validation are synchronous host contracts; the async source is a read-only cache, not a server query or save queue. History is in-memory and shallow. State snapshots exclude data, history, drafts and pending cut. Unlock the table before restore; restoring reordered columns is subject to projected-view restrictions.

Media blob URLs are temporary and tied to the owning grid; durable or cross-session use needs host upload/storage. Image clipboard depends on browser/OS support. MCP CLI exposes docs by default; live data requires host wiring and authorization, with scalar writes and no row-discovery API yet.

Browser automation currently targets Chromium. Full screen-reader, Safari/Firefox, physical touch-device, frame-rate and peak-memory coverage are not claimed. Formulas, workbook/collaboration, multi-column sorting and paste-special modes are outside this release.

See each package README for exact limits and integration examples.

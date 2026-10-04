# Changelog

## 0.1.0 — Release candidate (not published)

This is the first development preview. Package versions are prepared; no npm publication or GitHub tag is announced here.

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

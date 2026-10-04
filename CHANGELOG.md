# Changelog

This file summarizes the current unreleased development preview. It does not announce an npm publication or a tagged GitHub release. Package versions remain `0.0.0` and private.

## Unreleased

### Features

- Headless TypeScript engine with local sources/views, capability permissions, atomic updates, sparse formatting/locks, typed events and undo/redo.
- Canvas viewport rendering, grouped headers, frozen panes, resizing, whole-axis/multiple-range selection and keyboard workflows.
- Structural row/column operations, merged cells and nested manual row groups.
- Searchable context menus, text/choice/multiselect/checkbox editors, image/custom cells, visual HTML/Markdown editing and safe detected-link actions.
- React and Vue 3 lifecycle adapters; optional Markdown parsing and MCP documentation/host-authorized tools remain separate packages.
- Version-1 layout/view configuration export and validated initialization restore, available through core and Canvas/framework handles.
- Bounded layout motion, reduced-motion support and temporary single-cell/range copy feedback.

### Refinements

- Root typecheck builds dependency declarations first, including on a clean checkout.
- Single-cell paste fills selected ranges atomically; same-grid cut stages source clearing until successful paste, with one undo/redo entry.

- Uniform multi-cell selection tint without an extra active-cell border by default.
- Refined group gutter controls and short menu/editor transitions without text scaling.
- Interrupted popup exits start from their current visual state; replayed table-lock notices cancel previous animation.
- Copy feedback clears on state, geometry, theme, navigation or lifecycle changes; asynchronous clipboard completion does not show stale feedback.
- CI verifies core, browser, framework and MCP boundaries on Node 22/24. Browser fixture serves the configuration module.

### Current limits

APIs are experimental. Data sources and validation are synchronous; remote paging, formulas, collaboration, multi-column sorting and complete assistive-technology coverage are not implemented. Browser integration is tested with Chromium. Configuration restores a new instance and excludes data, row order/heights, merges/groups, formatting, locks, selection and history. Full frame-rate/GPU/device coverage is not established.

See package README files for exact permissions, bounds and unsupported combinations.

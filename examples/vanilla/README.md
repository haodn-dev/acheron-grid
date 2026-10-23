# Vanilla playground

A standalone browser example using built `@acheron-grid/core` and `@acheron-grid/canvas` packages. No Laravel, framework, CDN or extra dependency is required.

From the engine repository root with Node.js 22 or later:

```sh
npm ci
npm run playground
```

Open [the local playground](http://127.0.0.1:4180). The command builds all workspace packages and starts a loopback-only Node server; stop it with Ctrl+C. Browser-native import maps load the local core/Canvas ESM packages.

The example includes 10,000 sample rows, a default fixed index, themes, runtime frozen panes, native Status/Approved editors, image cells, custom badges, search, scoped locks/formatting, multiple ranges, clipboard and undo/redo. Header menus provide host-managed local sort/filter views. Applying a new view preserves source values but resets selection, history, user locks, colors and custom sizing; index numbers follow the resulting view. Reset view recreates the grid while preserving the same LocalDataSource and clearing selection/history. Appearance updates the theme in place and preserves selection, locks, sizes and history. Reload resets all sample edits. Frozen controls and right-click Freeze/Unfreeze use the runtime API, preserving selection and data history. The Website column demonstrates detected links and Alt+Enter link actions. The example enables the bounded viewport accessibility tree and includes Light/Teal/Dark themes.

Run `npm run test:playground` for Chromium integration checks covering edits/history/remount, column sort/filter and mapped edits, index numbering/empty views, dialog layout under host CSS resets, keyboard multi-range, one mounted Canvas, Worker paste and restricted HTTP routes. The development server serves the example pages/scripts, built core/Canvas modules including their internal dependencies and Worker entry, and the bounded [snapshot](../remote/README.md) and [paged](../paged/README.md) HTTP APIs. It does not serve arbitrary repository files. Data and receipts are process-local; it is not a production host.

## Learn individual features

Read the [practical guide](practical-guide.md) for editor options, clipboard/history, views, layout, rich content, structure and permissions.

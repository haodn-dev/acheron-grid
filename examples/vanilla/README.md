# Vanilla playground

A standalone browser example using built `@acheron-grid/core` and `@acheron-grid/canvas` packages. No Laravel, framework, CDN or extra dependency is required.

From the engine repository root with Node.js 22 or later:

```sh
npm ci
npm run playground
```

Open [the local playground](http://127.0.0.1:4180). The command builds both packages and starts a loopback-only Node server; stop it with Ctrl+C. Browser-native import maps load the local ESM packages.

The example includes 10,000 sample rows, a default fixed index, themes, runtime frozen panes, native Status/Approved editors, image cells, custom badges, search, scoped locks/formatting, multiple ranges, clipboard and undo/redo. Header menus provide host-managed local sort/filter views. Applying a new view preserves source values but resets selection, history, user locks, colors and custom sizing; index numbers follow the resulting view. Appearance and Reset view destroy and recreate the grid while preserving the same LocalDataSource. Selection and history reset, as the page explains. Reload resets all sample edits. Frozen controls and right-click Freeze/Unfreeze use the runtime API, preserving selection and data history. Appearance remains a construction-time option.

Run `npm run test:playground` for a Chromium integration check covering edits/history/remount, column sort/filter and mapped edits, index numbering/empty views, dialog layout under host CSS resets, keyboard multi-range, one mounted Canvas and restricted HTTP routes. The development server exposes only the example page/script and flat `.js` files inside built core/Canvas directories; it does not serve the repository or provide an API. It is not a production host.

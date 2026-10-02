# Vanilla playground

A standalone browser example using built `@acheron-grid/core` and `@acheron-grid/canvas` packages. No Laravel, framework, CDN or extra dependency is required.

From the engine repository root with Node.js 22 or later:

```sh
npm ci
npm run playground
```

Open [the local playground](http://127.0.0.1:4180). The command builds both packages and starts a loopback-only Node server; stop it with Ctrl+C. Browser-native import maps load the local ESM packages.

The example includes 10,000 sample rows, themes, frozen panes, native Status editing, custom badges, multiple ranges, clipboard and undo/redo. Appearance/frozen controls and Reset view destroy and recreate the grid while preserving the same LocalDataSource. Selection and history reset, as the page explains. Reload resets all sample edits. These controls demonstrate construction-time options; they are not runtime theme/frozen APIs.

Run `npm run test:playground` for a Chromium integration check covering edits/history/remount, status editor, keyboard multi-range, one mounted Canvas and restricted HTTP routes. The development server exposes only the example page/script and flat `.js` files inside built core/Canvas directories; it does not serve the repository or provide an API. It is not a production host.

# Support and release evidence

The original six packages are npm 0.1.0 development previews. Export/charts modules and Unreleased APIs are source previews. No stable 1.0 support promise is implied.

| Surface | Evidence and current limits |
| --- | --- |
| Node.js | CI uses Node 22 and 24; strict headless builds exclude DOM/ambient Node types from core |
| Chromium | Automated browser integration, packed consumer and standalone playground checks |
| WebKit | Configuration/local-view/multi-sort smoke tests; additional interactions remain unverified |
| Firefox | CI configuration/local-view/multi-sort smoke tests configured; verify exact commit results before claiming support |
| React/Vue | SSR and browser lifecycle checks; options identity remounts the grid |
| Accessibility | Keyboard and ARIA mirror checks; manual screen-reader/device coverage remains unverified |
| Clipboard/media | Synthetic browser checks; operating-system clipboard, persistent media storage and real-device coverage remain host/integration work |

Release checks must pass on the exact release commit: clean install, typecheck, Node/MCP/browser/playground tests, eight independent tarballs, relevant benchmark correctness and dependency licenses. Select release scope/version explicitly, synchronize public documentation/site snapshots, provide migration notes for breaking changes and preserve actual raw evidence. Package publication is a separate release action.

Report bugs with package/source revision, runtime/browser/OS, a minimal public reproduction, observed/expected behavior and relevant permissions/view/lifecycle settings. Exclude secrets and private datasets.

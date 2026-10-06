# Support and release evidence

The original six packages are npm 0.1.0 development previews. Export/charts modules and Unreleased APIs are source previews. No stable 1.0 support promise is implied.

| Surface | Evidence and current limits |
| --- | --- |
| Node.js | CI uses Node 22 and 24; strict headless builds exclude DOM/ambient Node types from core |
| Chromium | Automated browser integration, packed consumer and standalone playground checks |
| WebKit | Full portable integration suite: 102 passed on Windows; Linux CI also passed at source 72e4dee. Four Chromium-only clipboard-permission/CDP-touch checks are excluded; this is Playwright WebKit evidence, not Safari/device certification |
| Firefox | Full portable Linux integration suite: 102 passed at source bfdf60b; four Chromium-only clipboard-permission/CDP-touch checks excluded. Synthetic clipboard fixture normalization does not establish OS clipboard support |
| React/Vue | SSR and browser lifecycle checks; options identity remounts the grid |
| Accessibility | Keyboard and ARIA mirror checks; manual screen-reader/device coverage remains unverified |
| Clipboard/media | Synthetic browser checks; operating-system clipboard, persistent media storage and real-device coverage remain host/integration work |

Browser suites normalize explicit synthetic clipboard payloads in Firefox; they do not establish native OS clipboard interoperability. Native scroll dimensions differ: the portable accessibility scroll workload uses 100,000 rows rather than assuming every browser accepts a 32-million-pixel surface. Large local commands remain synchronous; [browser command measurements](BENCHMARKS.md#browser-command-task-evidence) record main-thread delay without an FPS or peak-memory guarantee.

[Full browser and Node 22/24 CI at bfdf60b](https://github.com/haodn-dev/acheron-grid/actions/runs/37417574315) passed on 2026-10-06. Playwright browser evidence does not certify all browser versions or physical devices. Firefox could not launch locally on this Windows machine; its full-suite evidence comes from the Linux runner.

Release checks must pass on the exact release commit: clean install, typecheck, Node/MCP/browser/playground tests, eight independent tarballs, relevant benchmark correctness and dependency licenses. Select release scope/version explicitly, synchronize public documentation/site snapshots, provide migration notes for breaking changes and preserve actual raw evidence. Package publication is a separate release action.

Report bugs with package/source revision, runtime/browser/OS, a minimal public reproduction, observed/expected behavior and relevant permissions/view/lifecycle settings. Exclude secrets and private datasets.

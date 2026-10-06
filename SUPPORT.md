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

[Full browser and Node 22/24 CI at 5cf6601](https://github.com/haodn-dev/acheron-grid/actions/runs/37419226252) passed on 2026-10-06, including the repeated lifecycle-memory workload. The accepted source baseline includes 101 Node tests, six MCP tests, two release-tooling tests, 106 Chromium integration tests, 102 portable integration tests each in Firefox/WebKit and eight independently packed packages. Four Chromium-specific checks are excluded from each portable suite. Playwright browser evidence does not certify all browser versions or physical devices. Firefox could not launch locally on this Windows machine; its full-suite evidence comes from the Linux runner.

## Source acceptance boundary

The tested baseline is ready for integration evaluation within its documented contracts. This acceptance does not change package versions or establish stable 1.0 support. API documentation covers 73 GridEngine members and 46 root exports, with executable examples and document-hash checks. Later runtime changes require their own regression checks; an earlier green CI run does not validate a later commit.

Open validation work includes manual assistive-technology announcements, real-device touch, operating-system clipboard interoperability, true peak browser memory and representative host responsiveness. Local sorting/filtering and large paste/history commands remain synchronous. The current measurements expose these costs; they are not universal performance budgets. Remote writes, formula/workbook execution, pivot and collaborative editing are outside the current core acceptance scope.

Release checks must pass on the exact release commit: clean install, typecheck, Node/MCP/browser/playground tests, eight independent tarballs, relevant benchmark correctness and dependency licenses. Select release scope/version explicitly, synchronize public documentation/site snapshots, provide migration notes for breaking changes and preserve actual raw evidence. Package publication is a separate release action.

## Manual accessibility validation

Automated keyboard/ARIA checks are not screen-reader acceptance. Record OS, browser, screen-reader versions, source revision and pass/fail for each workload before expanding support claims:

1. Focus the viewport and use arrows, Home/End and Ctrl/Meta+Home/End. Check the announced row/column, value, selection and read-only state against visible data.
2. Open an editor with F2, submit an invalid draft, correct it, save with Enter and cancel with Escape. Check focus, accessible name and error announcement; values must remain unchanged after cancellation.
3. Extend a range with Shift, select a row/column and navigate frozen/grouped/projected rows. Check identity and announcements after scrolling, sort/filter and collapse.
4. Open menus with Shift+F10, type to search, use arrows and Escape/Tab. Exercise choices, disabled options and Apply/Cancel; focus must return to the intended control.
5. Repeat with reduced motion and keyboard-only navigation, then destroy/remount. Check that hidden or removed controls cannot receive focus and announcements do not duplicate.

Start with NVDA + Firefox/Chromium on Windows and VoiceOver + Safari on macOS, using authorized non-sensitive sample data. These combinations are a validation plan, not verified support. Real-device touch and operating-system clipboard tests require separate manual evidence. [Lifecycle heap checkpoints](BENCHMARKS.md#retained-canvas-lifecycle-memory) cover one automated teardown workload, without a true peak-memory guarantee.

Report bugs with package/source revision, runtime/browser/OS, a minimal public reproduction, observed/expected behavior and relevant permissions/view/lifecycle settings. Exclude secrets and private datasets.

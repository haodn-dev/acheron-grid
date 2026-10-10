# Support and release evidence

The original six packages are npm 0.1.0 development previews. Export/charts modules and Unreleased APIs are source previews. No stable 1.0 support promise is implied.

| Surface         | Evidence and current limits                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js         | CI uses Node 22 and 24; strict headless builds exclude DOM/ambient Node types from core                                                                                                                                                    |
| Chromium        | Automated browser integration, packed consumer and standalone playground checks                                                                                                                                                            |
| WebKit          | Full portable integration suite: 102 passed on Windows; Linux CI also passed at source 72e4dee. Four Chromium-only clipboard-permission/CDP-touch checks are excluded; this is Playwright WebKit evidence, not Safari/device certification |
| Firefox         | Full portable Linux integration suite: 102 passed at source bfdf60b; four Chromium-only clipboard-permission/CDP-touch checks excluded. Synthetic clipboard fixture normalization does not establish OS clipboard support                  |
| React/Vue       | SSR and browser lifecycle checks; options identity remounts the grid                                                                                                                                                                       |
| Accessibility   | Keyboard and ARIA mirror checks; manual screen-reader/device coverage remains unverified                                                                                                                                                   |
| Clipboard/media | Synthetic browser checks; operating-system clipboard, persistent media storage and real-device coverage remain host/integration work                                                                                                       |

Browser suites normalize explicit synthetic clipboard payloads in Firefox; they do not establish native OS clipboard interoperability. Native scroll dimensions differ: the portable accessibility scroll workload uses 100,000 rows rather than assuming every browser accepts a 32-million-pixel surface. Synchronous APIs still run in one task; source-preview cooperative APIs yield during preparation, with a synchronous final commit; [browser command measurements](BENCHMARKS.md#browser-command-task-evidence) record main-thread delay without an FPS or peak-memory guarantee.

[Full browser and Node 22/24 CI at 5cf6601](https://github.com/haodn-dev/acheron-grid/actions/runs/37419226252) passed on 2026-10-06, including the repeated lifecycle-memory workload. The accepted source baseline includes 101 Node tests, six MCP tests, two release-tooling tests, 106 Chromium integration tests, 102 portable integration tests each in Firefox/WebKit and eight independently packed packages. Four Chromium-specific checks are excluded from each portable suite. Playwright browser evidence does not certify all browser versions or physical devices. Firefox could not launch locally on this Windows machine; its full-suite evidence comes from the Linux runner.

## Source acceptance boundary

The later `d3daa37` source baseline passed locally with 150 Node tests, 15 MCP tests, 110 Chromium tests,
106 WebKit tests with four Chromium-only exclusions, six standalone playground tests on each browser,
eight independent packed consumers and eight default benchmark tests. Two timing profiles are opt-in;
the new cooperative profile was run separately. Firefox cannot launch on this Windows host; the exact
`5df3eeb` candidate subsequently passed [Linux CI on Node 22/24, Firefox and WebKit](https://github.com/haodn-dev/acheron-grid/actions/runs/37572593956),
including portable standalone playground tests. This is automated candidate evidence, not physical-device
or screen-reader acceptance. See the
[1.0 contract and acceptance policy](guides/v1-readiness.md) for the selected compatibility contract,
package scope and remaining gates. Counts in older paragraphs below are historical evidence.

The 2026-10-07 readiness candidate was checked locally with 135 Node tests, 15 MCP tests, 109 Chromium integration tests, four playground tests and eight independent packed consumers. WebKit passed 105 tests with four existing Chromium-only exclusions. Firefox could not launch on this Windows host (`spawn UNKNOWN`); earlier Linux results do not validate this candidate. The remote playground also passes axe checks for serious/critical WCAG 2/2.1 A/AA findings at desktop and mobile viewport sizes. This is automated coverage of that example, not screen-reader or physical-device acceptance. Release remains postponed and required CI must pass on the eventual release commit.

The tested baseline is ready for integration evaluation within its documented contracts. This acceptance does not change package versions or establish stable 1.0 support. The earlier API inventory covered 73 GridEngine members and 46 root exports; those are historical counts. The `5df3eeb` built declaration inventory contains 62 named core root exports, including types, with an identical headless alias. Current API references include cooperative bulk commands and writable paged sources, with executable examples and document-hash checks. Later runtime changes require their own regression checks; an earlier green CI run does not validate a later commit.

Open validation work includes manual assistive-technology announcements, real-device touch, operating-system clipboard interoperability, true peak browser memory and representative host responsiveness. Source-preview cooperative bulk APIs divide preparation into scheduled tasks; final atomic commits, structural history and active-view reprojection can still block. Measurements are workload evidence, not universal performance budgets. Both bounded snapshot and writable paged remote sources have local HTTP examples; production backend acceptance, reload-persistent drafts and editing during commit remain open. See [bulk limits](guides/bulk-commands.md) and [paged writes](guides/paged-remote.md). Formula/workbook execution, pivot and collaborative editing are outside the current core acceptance scope.

The local projection optimization and Canvas header auto-fit fix were subsequently validated at runtime commit `266d411`: [CI on Node 22/24 and Firefox/WebKit](https://github.com/haodn-dev/acheron-grid/actions/runs/37427020290) passed on 2026-10-06. This run includes 103 Node tests (two additional projection regressions), the full browser suites, documentation checks, repeated benchmarks and independent packed consumers. [Projection measurements](BENCHMARKS.md#local-projection-optimization-2026-10-06) retain before/after raw evidence and measurement limits. This validation does not close the manual/device or peak-memory work above.

Release checks must pass on the exact release commit: clean install, typecheck, Node/MCP/browser/playground tests, eight independent tarballs, relevant benchmark correctness and dependency licenses. Select release scope/version explicitly, synchronize public documentation/site snapshots, provide migration notes for breaking changes and preserve actual raw evidence. Package publication is a separate release action.

## Manual accessibility validation

Use the [complete manual acceptance protocol](guides/manual-validation.md) for environment records, per-case PASS/FAIL/NOT RUN, native clipboard, physical touch/Safari and responsiveness/memory profiling. Timing budgets require representative host workloads and stable-runner baselines; existing automated resource-bound assertions remain the correctness gates.

Atomic row-batch optimization was validated separately at `929b6ad`: [Node 22/24 and Firefox/WebKit CI](https://github.com/haodn-dev/acheron-grid/actions/runs/37428401875) passed, including 105 Node tests and the repeated multi-column batch/paste workload. [Raw batch measurements](BENCHMARKS.md#atomic-row-batches-2026-10-06) describe improvements and unchanged synchronous/manual-validation limits.

Automated keyboard/ARIA checks are not screen-reader acceptance. Record OS, browser, screen-reader versions, source revision and pass/fail for each workload before expanding support claims:

1. Focus the viewport and use arrows, Home/End and Ctrl/Meta+Home/End. Check the announced row/column, value, selection and read-only state against visible data.
2. Open an editor with F2, submit an invalid draft, correct it, save with Enter and cancel with Escape. Check focus, accessible name and error announcement; values must remain unchanged after cancellation.
3. Extend a range with Shift, select a row/column and navigate frozen/grouped/projected rows. Check identity and announcements after scrolling, sort/filter and collapse.
4. Open menus with Shift+F10, type to search, use arrows and Escape/Tab. Exercise choices, disabled options and Apply/Cancel; focus must return to the intended control.
5. Repeat with reduced motion and keyboard-only navigation, then destroy/remount. Check that hidden or removed controls cannot receive focus and announcements do not duplicate.

Start with NVDA + Firefox/Chromium on Windows and VoiceOver + Safari on macOS, using authorized non-sensitive sample data. These combinations are a validation plan, not verified support. Real-device touch and operating-system clipboard tests require separate manual evidence. [Lifecycle heap checkpoints](BENCHMARKS.md#retained-canvas-lifecycle-memory) cover one automated teardown workload, without a true peak-memory guarantee.

Report bugs with package/source revision, runtime/browser/OS, a minimal public reproduction, observed/expected behavior and relevant permissions/view/lifecycle settings. Exclude secrets and private datasets.

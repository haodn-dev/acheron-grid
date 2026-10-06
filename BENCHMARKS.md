# Benchmark evidence

## Atomic row batches: 2026-10-06

`tests/benchmark-batch.mjs` measures 100,000 cells arranged as 100k rows × 1 column, 10k × 10 and 1k × 100. Three sequential Chromium trials per shape check every value after direct source writes, API batches, paste, undo and redo. Permission veto and a final invalid cell must leave values, events and history unchanged. This workload now runs in the existing benchmark CI job.

[Before/after raw evidence](benchmark-results/2026-10-06-atomic-batch.json) compares runtime `9095449` with `929b6ad` on the same local Windows Chromium setup. Median CPU wall time in ms:

| Shape, 100k cells | setValues before / after | updateCells before / after | Paste before / after | Undo paste before / after |
| --- | ---: | ---: | ---: | ---: |
| 100k × 1 | 16.5 / 15.3 | 81.5 / 83.7 | 156.6 / 148.5 | 54.3 / 54.4 |
| 10k × 10 | 8.5 / 8.1 | 78.2 / 72.3 | 142.8 / 130.7 | 48.5 / 44.1 |
| 1k × 100 | 24.3 / 10.1 | 94.8 / 76.5 | 159.7 / 123.6 | 67.4 / 52.6 |

LocalDataSource stages one shallow draft per touched row, updates its fields in encounter order and freezes the completed rows only after the entire batch validates. Old snapshots remain frozen and unchanged; duplicate cells retain their last value. Existing own keys such as `__proto__` remain data properties. Batch/paste/cut deduplication uses an integer row prefix and separator followed by the complete column key, avoiding JSON array serialization without conflating keys containing colons or quotes. Permissions, parsing, validation and history continue through the same mutation pipeline.

These are three local samples per shape, without dedicated warmup, fixed system load or timing thresholds. Shapes differ in row count; they do not isolate column-width scaling. The single-column API batch did not improve in this run. Commands remain synchronous; no presented FPS, peak-memory or universal speedup claim is made. [CI at 929b6ad](https://github.com/haodn-dev/acheron-grid/actions/runs/37428401875) passed Node 22/24 and full portable Firefox/WebKit, including 105 Node tests, browser integration, repeated benchmark correctness and packed consumers.

## Local projection optimization: 2026-10-06

[Before/after raw trials](benchmark-results/2026-10-06-local-view-comparison.json) compare the unchanged Node runner at runtime baseline `fcab797` and optimization `53835be`. Both use Node 24.13.0 on the same Windows i5-12400F machine, three trials each at 10k/100k allocated rows, with full identity/value/history assertions. Runtime/runner SHA-256 hashes are included. Documentation changes present during the baseline run do not change the measured runtime.

| Operation | 10k before / after median, ms | 100k before / after median, ms |
| --- | ---: | ---: |
| Numeric sort | 7.31 / 4.07 | 81.34 / 33.80 |
| Multi-sort | 16.34 / 11.07 | 276.92 / 141.57 |
| Equals filter | 1.55 / 1.63 | 19.24 / 11.19 |

LocalDataView now caches sort keys in dense arrays indexed by matched positions, instead of hashing source indices during every comparison. It skips the filtering pass when no filters are configured and normalizes each filter query once. Nullish-last ordering, stable source-order ties, source read order, immutable projection and mapped writes retain their contracts. Storage scales with matched rows and sort keys, without allocating sort caches for filtered-out rows. Filtering still scans the source and commands remain synchronous; no API or dependency changes were made.

These sequential process samples have no dedicated warmup, controlled system-load budget or timing threshold. The 10k filter did not improve in this run. Unmodified paste/history paths also fluctuate: 100k paste median was 166.82 / 157.96 ms and undo 51.58 / 59.53 ms. Do not attribute those differences to this sort/filter change or claim universal speedups, p95, FPS or peak memory.

[Chromium follow-up raw samples](benchmark-results/2026-10-06-local-view-browser.json) at `53835be` passed nine benchmark tests: three command workloads and six viewport/partial-repaint workloads. Each command workload contains three trials; per-workload median multi-sort was 154.2–156.3 ms, paste 144.4–149.9 ms and undo 52.1–61.3 ms on 100k rows. Sorting still blocks the main thread for the duration of the operation. These later samples are not a controlled paired browser comparison against the earlier command report. Full Chromium integration and independently packed consumers were checked separately.

[Final runtime CI at 266d411](https://github.com/haodn-dev/acheron-grid/actions/runs/37427020290) passed on Node 22/24 and Firefox/WebKit, including repeated benchmark correctness. The intervening Canvas fix accepts header-origin double-click events for edge auto-fit; it does not alter the measured LocalDataView sort/filter implementation. Later documentation-only evidence updates do not change this runtime validation revision.

## Retained Canvas lifecycle memory

`tests/benchmark-memory.mjs` uses Chromium CDP heap and DOM/listener counters at named checkpoints. Each run allocates 100,000 rows, mounts Canvas with the viewport ARIA tree, pastes 100,000 values, verifies undo, releases host references and performs 20 additional mount/update/undo/destroy cycles. Two warmup cycles precede the baseline. Explicit GC follows teardown; DOM/document/listener counts must return to the warm baseline. Heap deltas are informational, without a timing or memory threshold.

[Three sequential Windows Chromium runs](benchmark-results/2026-10-06-lifecycle-memory.json) at `cc28d5c` passed on 2026-10-06. Maximum sampled isolate heap was 68.88–70.60 MiB; post-GC retained delta after 20 cycles was about 0.42 MiB. DOM nodes returned to 46 and listeners to 3 in all runs. These are sampled checkpoints, not transient peak memory, total browser RSS or GPU/Canvas backing-store measurements. GC/JIT/cache behavior changes retained heap; stable counters in this workload do not prove every integration is leak-free. Host-owned sources, subscriptions and object URLs still require host cleanup. The existing Chromium benchmark job also runs this workload. [CI at 5cf6601](https://github.com/haodn-dev/acheron-grid/actions/runs/37419226252) passed on Node 22/24, including the repeated memory workload and full portable browser suites.

## Browser command task evidence

The benchmark configuration also runs `tests/benchmark-commands.mjs`: three trials of multi-sort, paste and undo on 100,000 allocated rows. Full row identity/value assertions follow each operation. Raw attachments include synchronous operation duration, zero-delay timer latency and overlapping Long Tasks API entries when supported. Timer latency includes scheduling overhead; overlapping tasks can include fixture/assertion work outside the measured operation. This measures browser main-thread blocking, without Canvas rendering, GPU time, presented FPS or peak memory. There is no warmup or timing pass/fail threshold. Set `ACHERON_TEST_BROWSER` to select Firefox or WebKit; unsupported long-task collection is explicitly recorded.

Local Windows run on 2026-10-06 at source `72e4dee` ([Chromium raw samples](benchmark-results/2026-10-06-chromium-commands.json), [WebKit raw samples](benchmark-results/2026-10-06-webkit-commands.json)): median operation/timer latency in ms for 100k multi-sort was 244.8/245.0 in Chromium and 298/312 in WebKit; paste 138.4/138.5 and 189/200; undo 49.6/49.7 and 89/93. Chromium recorded seven overlapping long-task entries; WebKit did not expose that API. All correctness assertions passed. These three-trial results expose synchronous main-thread blocking, not a cross-browser speed ranking or p95 target. OS/runtime/JIT, locale and timing precision differ. Large local commands should be measured against the host's responsiveness needs before choosing an async or worker integration.

Run `npm run benchmark -- --repeat-each=3 --reporter=json` after installing development dependencies and Playwright Chromium. The existing runner builds the packages and uses one worker with the browser fixture. Assertions check viewport-bounded reads and single-cell partial updates; timing is informational.

## Local baseline: 2026-10-05

[Recorded outputs and environment](benchmark-results/2026-10-05-callback-cost.json) identify the source revision. Six tests passed: three runs for each frozen configuration. Windows, Chromium 153, Node 22, DPR 1, grid viewport 640 × 360 CSS pixels. CPU metadata was unavailable, so this is not a portable performance target. An existing unrelated touch-test edit was present; benchmark and runtime source matched the recorded revision.

The source exposes 1,000,000 logical rows and 1,000 columns lazily, with two sparse size overrides. It does not allocate one billion cells. Each run performs 60 scroll steps and 60 visible-cell updates. Native scroll events can produce extra callbacks.

| Frozen rows/columns | Scroll median range | Scroll p95 range | Maximum reads/callback | Partial median range | Partial p95 range | Partial reads |
| --- | --- | --- | --- | --- | --- | --- |
| 0 / 0 | 0.9–1.2 ms | 1.3–2.6 ms | 44 | 0.1–0.2 ms | 0.3–0.9 ms | 1 |
| 1 / 1 | 1.2–1.6 ms | 1.7–10.0 ms | 55 | 0.1 ms | 0.3–0.4 ms | 1 |

Ranges describe three per-run summaries, not pooled percentiles. The 10 ms p95 is retained as measured. Outputs contain per-run summaries, not individual callback samples. This instrumentation measures synchronous animation-frame callbacks that read source cells. It does not measure presented FPS, raster/GPU time, peak memory, all UI callbacks or production application latency. Concurrent machine activity is uncontrolled; these results do not establish a regression against earlier runs.

The sections above and below add allocated local sort/filter/refresh, batch/paste/history, browser task-delay and retained teardown-memory evidence. Complex layouts, remote cache churn, presented frame cadence, real-device workloads and true peak memory still need dedicated measurements. Each benchmark must pair cost measurements with correctness checks. Timing gates require repeated baselines on a stable runner; current read-count assertions can already catch virtualization regressions.

## Raw callback evidence

The runner now includes ordered `rawSamples.scroll` and `rawSamples.partial` arrays of `{ ms, reads }` in its JSON output and attaches `callback-cost.json` to each Playwright result. Summary sample counts match array lengths; median and p95 use the sorted duration at indices `floor(n / 2)` and `min(n - 1, floor(n * 0.95))`.

[The repeated raw-sample run](benchmark-results/2026-10-05-raw-callback-cost.json) passed all six tests. Its metadata records the base runtime revision and SHA-256 of the instrumented runner. Maximum reads remained 44 without frozen panes, 55 with frozen panes and 1 for partial updates. This separate run does not replace the earlier baseline or establish a speed improvement.

CI repeats the Canvas workloads three times on Node 22 and 24 and uploads the JSON report plus raw-sample attachments for seven days, including on failure. Read-count assertions gate correctness; timings have no pass/fail threshold. [CI at 5cf6601](https://github.com/haodn-dev/acheron-grid/actions/runs/37419226252) verified the benchmark job remotely.

## Live batches and inline chart geometry

Run `node tests/benchmark-live-charts.mjs` after building. Three trials at 1,000 and 10,000 rows/cells record consecutive stable-ID update admission, bounded queue size, atomic flush and numeric chart geometry. Assertions verify values, gaps/resync and signed baselines. This measures CPU wall time including assertions; it does not measure Canvas/DPR/FPS/GPU/peak memory. The JSON records source revision/runtime/platform and individual samples. CI retains it alongside the existing reports; no timing threshold is imposed.

## Allocated local data and commands

Run `npm run benchmark:core`. The Node runner uses three trials each at 10,000 and 100,000 allocated rows with deterministic scores and team values. It measures source/engine construction, numeric sort/multi-sort, filter, identity capture, 1,000/10,000-cell batches and history, 10,000-cell paste and a 100,000-cell paste at the clipboard cell limit, permission veto, refresh and state export/restore. Sort/filter results are checked against independently computed row IDs; mutations/history check cell values; veto checks unchanged data, notifications and history. Assertions fail the command on incorrect behavior. No timing thresholds are applied.

[Recorded trial durations and environment](benchmark-results/2026-10-05-core-cost.json) preserve individual trial costs. Trials run in one process without a dedicated warm-up, so JIT/GC and operation ordering affect timings; do not compare dataset sizes as an isolated scaling experiment. Heap delta is retained heap after optional explicit GC and includes the live fixture, source, views and correctness oracle. It is neither peak memory nor evidence of a leak. CI is configured to retain this report alongside Canvas evidence.

The Node runner performs three trials per dataset size, and CI retains its report on Node 22 and 24 for seven days. Correctness assertions gate the result; timings have no pass/fail threshold. [CI at 5cf6601](https://github.com/haodn-dev/acheron-grid/actions/runs/37419226252) verified this workload remotely.

# Benchmark evidence

Run `npm run benchmark -- --repeat-each=3 --reporter=json` after installing development dependencies and Playwright Chromium. The existing runner builds the packages and uses one worker with the browser fixture. Assertions check viewport-bounded reads and single-cell partial updates; timing is informational.

## Local baseline: 2026-10-05

[Recorded outputs and environment](benchmark-results/2026-10-05-callback-cost.json) identify the source revision. Six tests passed: three runs for each frozen configuration. Windows, Chromium 153, Node 22, DPR 1, grid viewport 640 × 360 CSS pixels. CPU metadata was unavailable, so this is not a portable performance target. An existing unrelated touch-test edit was present; benchmark and runtime source matched the recorded revision.

The source exposes 1,000,000 logical rows and 1,000 columns lazily, with two sparse size overrides. It does not allocate one billion cells. Each run performs 60 scroll steps and 60 visible-cell updates. Native scroll events can produce extra callbacks.

| Frozen rows/columns | Scroll median range | Scroll p95 range | Maximum reads/callback | Partial median range | Partial p95 range | Partial reads |
| --- | --- | --- | --- | --- | --- | --- |
| 0 / 0 | 0.9–1.2 ms | 1.3–2.6 ms | 44 | 0.1–0.2 ms | 0.3–0.9 ms | 1 |
| 1 / 1 | 1.2–1.6 ms | 1.7–10.0 ms | 55 | 0.1 ms | 0.3–0.4 ms | 1 |

Ranges describe three per-run summaries, not pooled percentiles. The 10 ms p95 is retained as measured. Outputs contain per-run summaries, not individual callback samples. This instrumentation measures synchronous animation-frame callbacks that read source cells. It does not measure presented FPS, raster/GPU time, peak memory, all UI callbacks or production application latency. Concurrent machine activity is uncontrolled; these results do not establish a regression against earlier runs.

Further evidence is needed for allocated local datasets, sort/filter/refresh, batch/paste/history, complex layout, remote cache lifecycle, interactive frame cadence, memory after teardown, other browsers and real devices. Each benchmark must pair cost measurements with correctness checks. Timing gates require repeated baselines on a stable runner; current read-count assertions can already catch virtualization regressions.

## Raw callback evidence

The runner now includes ordered `rawSamples.scroll` and `rawSamples.partial` arrays of `{ ms, reads }` in its JSON output and attaches `callback-cost.json` to each Playwright result. Summary sample counts match array lengths; median and p95 use the sorted duration at indices `floor(n / 2)` and `min(n - 1, floor(n * 0.95))`.

[The repeated raw-sample run](benchmark-results/2026-10-05-raw-callback-cost.json) passed all six tests. Its metadata records the base runtime revision and SHA-256 of the instrumented runner. Maximum reads remained 44 without frozen panes, 55 with frozen panes and 1 for partial updates. This separate run does not replace the earlier baseline or establish a speed improvement.

CI is configured to repeat both workloads three times on Node 22 and 24 and upload the JSON report plus raw-sample attachments for seven days, including on failure. Read-count assertions gate correctness; timings have no pass/fail threshold. Local validation passed; this workflow change has not yet been verified on the remote runner.

## Live batches and inline chart geometry

Run `node tests/benchmark-live-charts.mjs` after building. Three trials at 1,000 and 10,000 rows/cells record consecutive stable-ID update admission, bounded queue size, atomic flush and numeric chart geometry. Assertions verify values, gaps/resync and signed baselines. This measures CPU wall time including assertions; it does not measure Canvas/DPR/FPS/GPU/peak memory. The JSON records source revision/runtime/platform and individual samples. CI retains it alongside the existing reports; no timing threshold is imposed.

## Allocated local data and commands

Run `npm run benchmark:core`. The Node runner uses three trials each at 10,000 and 100,000 allocated rows with deterministic scores and team values. It measures source/engine construction, numeric sort/multi-sort, filter, identity capture, 1,000/10,000-cell batches and history, 10,000-cell paste and a 100,000-cell paste at the clipboard cell limit, permission veto, refresh and state export/restore. Sort/filter results are checked against independently computed row IDs; mutations/history check cell values; veto checks unchanged data, notifications and history. Assertions fail the command on incorrect behavior. No timing thresholds are applied.

[Recorded trial durations and environment](benchmark-results/2026-10-05-core-cost.json) preserve individual trial costs. Trials run in one process without a dedicated warm-up, so JIT/GC and operation ordering affect timings; do not compare dataset sizes as an isolated scaling experiment. Heap delta is retained heap after optional explicit GC and includes the live fixture, source, views and correctness oracle. It is neither peak memory nor evidence of a leak. CI is configured to retain this report alongside Canvas evidence.

CI is configured to repeat both workloads three times on Node 22 and 24 and upload the JSON report plus raw-sample attachments for seven days, including on failure. Read-count assertions gate correctness; timings have no pass/fail threshold. Local validation passed; this workflow change has not yet been verified on the remote runner.

# Manual device and accessibility acceptance

Automated tests do not establish screen-reader announcements, native clipboard interoperability, physical touch behavior, presented frame rate or true peak memory. Use this protocol on the exact source revision being evaluated, with public sample data. Record failures and evidence before expanding support claims. No result is implied by this document.

## Environment record

Copy this record for each combination:

```text
Source revision:
Package versions/source preview:
Date:
Tester:
OS and version:
Browser and version:
Assistive technology and version (or none):
Device, CPU/RAM, display refresh rate and DPR:
Dataset shape, column types, groups/merges/frozen counts:
Result per case: PASS / FAIL / NOT RUN
Observed and expected behavior:
Reproduction and evidence location:
```

Start with NVDA + Firefox/Chromium on Windows, VoiceOver + Safari on macOS, and physical iOS/Android touch devices. These combinations are planned coverage, not verified support.

## Keyboard and screen readers

1. Focus the grid. Navigate with arrows, Home/End and Ctrl/Meta+Home/End. Confirm row/column, value, selection and read-only announcements match visible data.
2. Use Shift to extend ranges, select whole rows/columns and navigate frozen/grouped/projected rows. Repeat after sorting, filtering and collapsing groups; announcements must match stable record identities.
3. Open an editor with F2. Submit an invalid draft, correct it, save with Enter and cancel a second edit with Escape. Confirm the field name/error is announced, focus returns correctly and cancel preserves values.
4. Open the menu with Shift+F10. Search and navigate options, including disabled options. Apply and cancel choices; check focus after Escape/Tab.
5. Repeat with reduced motion. Destroy/remount the grid; removed controls must not remain focusable or produce duplicate announcements.

## Native clipboard

1. Copy/paste a rectangular range between two grid instances and a native text/spreadsheet application. Include Unicode, quoted tabs, multiline values and empty cells; verify exact resulting values.
2. Test same-grid cut/move, copy after cut, Escape cancellation, permission rejection and undo/redo. Rejected paste must preserve source and destination values/history.
3. Paste while a text editor is active; its native text selection/clipboard must remain usable. Check permission-denied and unavailable clipboard behavior through the actual browser UI.
4. Repeat with public rich-text/HTML input and supported formats; confirm unsafe content stays inert and unsupported formats have the documented fallback.

## Physical touch and Safari

1. Scroll the page and grid in both axes. Select a cell/range, drag a header where enabled, and edit without accidentally trapping page scrolling.
2. Exercise frozen panes, narrow layouts, on-screen keyboard, rotation, menus and choice editors. Confirm targets remain reachable and the editor stays aligned with its cell.
3. Background/resume and destroy/remount; confirm stale touch gestures, menus and listeners do not remain active.

## Responsiveness and memory

1. Select representative host workloads and an acceptable interaction-latency budget **before** comparing timings. Record allocated rows/cells, edit shapes, sort/filter criteria, cache limits and update rates.
2. Warm up the application, then collect at least 30 samples per workload on a stable runner. Preserve raw durations, operation errors, median/p95 and frame evidence; do not discard slow samples without a recorded reason.
3. Capture a browser performance trace through scroll, sort, paste, undo, live bursts and remote query changes. Report presented frames only when the tool actually observes them; requestAnimationFrame cadence alone is insufficient.
4. Sample browser/renderer process memory and heap during allocation, large commands and teardown. Record sampling rate and process identities. Report a **maximum observed sample**, not true transient peak. Use an OS/native profiler if a true peak or GPU allocation claim is required.
5. Repeat mount/destroy and query/cache churn. Compare DOM/listener/cache counters and retained heap after warmup; document host-owned subscriptions and object URLs separately.

## Release decision

Any failure needs the exact revision, reproduction, expected/observed result and evidence. Keep NOT RUN items open. Timing gates require a stable runner, a host-approved budget and repeated baseline data; the existing CI gates enforce correctness and resource bounds without inventing a hardware-independent latency threshold. Package publication and production deployment remain separate actions.

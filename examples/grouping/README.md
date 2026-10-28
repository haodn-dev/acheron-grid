# Local grouping example

Run `npm run playground` from the repository root, then open [the local grouping example](http://127.0.0.1:4180/grouping/). This source preview is not included in published npm 0.3.0.

The example groups 100 complete local sample records by team and sums their numeric amounts. Filter teams, expand/collapse groups, edit leaf amounts and replay edits with Undo/Redo. Group rows are read-only; count/sum retain collapsed records. Values are illustrative IEEE-754 numbers, not a currency accounting model.

The example uses viewport accessibility and the existing Canvas theme. Enter/Space toggle a focused group; Left/Right close/open it, and Up/Down navigate. Physical-device, assistive-technology and native clipboard acceptance remain separate from automated browser checks. See [the Canvas guide](../../packages/canvas/README.md#local-grouping-source-preview) and [the core contract](../../packages/core/README.md#local-grouping-source-preview) for working-set and unsupported-combination limits.

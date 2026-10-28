# Local grouping example

Run `npm run playground` from the repository root, then open [the local grouping example](http://127.0.0.1:4180/grouping/). Its grouping APIs are included in 0.4.0; build matching packages from this checkout to run the example.

The example groups 100 complete local sample records by team and sums their numeric amounts. Filter teams, expand/collapse groups, edit leaf amounts and replay edits with Undo/Redo. Group rows are read-only; count/sum retain collapsed records. Values are illustrative IEEE-754 numbers, not a currency accounting model.

The example uses viewport accessibility and the existing Canvas theme. Enter/Space toggle a focused group; Left/Right close/open it, and Up/Down navigate. Physical-device, assistive-technology and native clipboard acceptance remain separate from automated browser checks. See [the Canvas guide](../../packages/canvas/README.md#local-grouping-040-preview) and [the core contract](../../packages/core/README.md#local-grouping-040-preview) for working-set and unsupported-combination limits.

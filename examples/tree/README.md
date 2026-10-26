# Local tree source preview

From the repository root, run `npm run playground` and open `/tree/`. This example requires the current checkout; npm 0.3.0 does not include tree APIs.

The 20 sample records form four local project trees. Filter a task and expand its ancestors, edit an estimate, and undo/redo the value change. The parent field is read-only. Disclosure and keyboard navigation use real source IDs. Left/Right in the first visible column navigate the tree; other columns keep cell navigation. Enter/F2 edits, PageUp/Down moves through visible records and Ctrl+Home/End moves to the first/last record.

This is a complete bounded local dataset, not a lazy remote tree. Structural edits, reparenting, cut, row sizing/hiding, frozen rows, merges and manual outlines are unavailable while tree mode is active. [Core contract](../../packages/core/README.md) and [Canvas guide](../../packages/canvas/README.md) describe the source preview APIs and limits.

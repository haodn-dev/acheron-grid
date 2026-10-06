# Architecture and extension boundaries

Acheron separates headless data semantics from browser presentation. Applications own datasets, authorization, transport and storage. Optional packages remain open source and free; core has no framework or Canvas dependency.

## Package map

| Package     | Responsibility                                                                           | Boundary                                                                    |
| ----------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| core        | DataSource, engine commands, permissions, selection, history, views, sparse layout/state | Pure TypeScript; no DOM/framework imports                                   |
| canvas      | Rendering, scrolling, editors, menus, clipboard integration, accessibility mirror        | Public core APIs only                                                       |
| react / vue | Mount/unmount, props/events and ready/error handling                                     | Thin Canvas lifecycle adapters; options identity may remount                |
| markdown    | Optional safe rich-text conversion                                                       | Consumer-controlled input and rendering limits                              |
| export      | CSV/XLSX selected data                                                                   | Copy permissions and existing clipboard budgets; dependency license notices |
| charts      | Bounded inline series rendering                                                          | Optional Canvas renderer; not a workbook/charting platform                  |
| mcp         | Documentation resources and host-authorized data tools                                   | SDK/protocol/transport outside core; writes disabled by default             |

## Design decisions

### Headless core and public dependency direction

Core computes numeric geometry and data semantics without accessing browser globals. Canvas interprets those results and submits commands through public APIs. Internal modules under `src/internal` are assembly details, not supported import paths. Consumers import package entry points; `core/headless` remains a compatibility entry.

### One controlled mutation pipeline

Commands validate bounds, current identity, permissions and values before controlled writes, then record history and publish invalidation/events. Async transports must not turn synchronous DataSource setters into promises or split one atomic command into silent partial writes. Applications can subscribe independently; observer failures are isolated and available through a bounded error queue. External changes need explicit identity capture/refresh rather than repaint alone.

### Sparse state and stable identities

Data access uses row IDs, column keys and coordinates. Sparse formatting, locks and layout metadata avoid allocating an object for every logical cell. Local projection uses stable source identities; visible indices and source indices have different meanings. Hidden axes are a presentation feature, not authorization. Saved UI state excludes dataset contents, callbacks and undo history.

### History and reconciliation

Undo/redo rechecks present permissions, identities and values; an old command does not grant access. Locks themselves are outside history. Source refresh clears stale history/pending cut and remaps metadata using captured IDs where provided. The host owns refresh after authoritative remote snapshots, including accepted commits and resync.

### Virtualization and browser accessibility

Canvas paints visible panes and keeps DOM editors/menus and an accessibility mirror. Virtualization bounds painting, not all synchronous command costs or dataset allocations. Keyboard/ARIA/axe automation is separate from screen-reader and physical-device acceptance. See [support boundaries](../SUPPORT.md).

### Async, live and remote sources

Async paging, bounded live updates and optimistic full-snapshot remote writes have distinct lifecycles. Cancellation/generation checks prevent stale results restoring a destroyed instance. Hosts supply transport, deadlines, connectivity/retry policy, server authorization and compare-and-swap. Uncertain writes retain their identity/payload; conflict resolution is explicit, never an automatic winner selection. See [editing and remote contracts](editing-and-remote.md) and the [HTTP example](../examples/remote/README.md).

### Compatibility and evidence

Source-preview additions are not part of published npm 0.1.0. Public exports, generated declarations, examples, packed consumers and documentation catalogs are checked together. Benchmark callback CPU, command latency and heap checkpoints describe their actual workloads; they do not imply presented FPS, true GPU peak memory or unlimited data support. Breaking contracts need explicit migration/release decisions.

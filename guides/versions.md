# Documentation versions

Package versions and documentation revisions answer different questions. The package version identifies an installed artifact. A documentation revision identifies a change to a specific guide or reference; it does not announce a new package release.

## Reading channels

The 0.2.0 development preview is published for all eight packages. The repository is preparing
the compatible 0.2.1 patch; see [patch changes and migration](../RELEASE-0.2.1.md).
The website defaults to npm 0.2.0. The archived npm 0.1.0 channel retains its original
scope; Source preview follows a separately identified Git revision.

| Channel           | Use it when                                               | Meaning                                                                                              |
| ----------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| npm 0.1.0         | Your application installs the published 0.1.0 packages    | Frozen API scope from Git tag v0.1.0; later editorial corrections may clarify that scope             |
| npm 0.2.0         | Your application installs the current development preview | All eight packages; repository guides and tag v0.2.0 define the released API scope                   |
| 0.2.1 preparation | You evaluate the patch source before publication          | Same public API as 0.2.0, with ARIA and documentation corrections; not yet a published-channel claim |
| Source preview    | You build the revision shown by the site                  | Includes 0.2.0 APIs and any subsequent source changes; identify the exact revision                   |

The site defaults to npm 0.2.0. Select npm 0.1.0 only for an application that still installs that version. Select Source preview for development after the released scope and record the exact Git revision.

## Per-document revisions

Each public document has a stable ID, revision number, updated date, content hash (UTF-8 with LF line endings) and a short change summary in `documentation.json`. Revision 1 records the previous public snapshot; revision 2 aligns installation/status, adds the reader workflow and synchronizes current API contracts. New documents start at revision 1.

The website displays the channel, document revision, updated date and source revision beside the title. Its change page lists what changed per document. A document revision changes only when that document's content changes; it does not reset or version engine state/configuration schemas.

## Maintenance

The [1.0 contract and acceptance policy](v1-readiness.md) defines SemVer, deprecation and the
package-specific evidence required before stability is announced. Current 0.x/source availability is unchanged.

Package README files and the guides in this repository are canonical consumer documentation. Refresh MCP copies with `npm run docs:sync`; the site imports the same files and checks their hashes. Do not fix only the site's downloaded Markdown or an MCP snapshot.

When changing an API: update its owning guide/README, record its release availability, update the affected document's revision/history, regenerate signatures and copies, compile the runnable examples, then deploy the site. Keep frozen 0.1.0 docs free of newer APIs. For breaking changes, provide a before/after migration example in release notes; documentation revision numbers are not a substitute for package SemVer.

## License transition

Current source and 0.2.0 distributions use Apache-2.0, with copyright attribution in NOTICE. Published npm 0.1.0 and tag v0.1.0 retain MIT; the source license decision does not retroactively change those artifacts. Embedded Lucide assets (ISC/MIT), fflate/Marked and other dependencies retain their own licenses and required notices.

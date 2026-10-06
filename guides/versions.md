# Documentation versions

Package versions and documentation revisions answer different questions. The package version identifies an installed artifact. A documentation revision identifies a change to a specific guide or reference; it does not announce a new package release.

## Reading channels

| Channel | Use it when | Meaning |
| --- | --- | --- |
| npm 0.1.0 | Your application installs the published 0.1.0 packages | Frozen API scope from Git tag v0.1.0; later editorial corrections may clarify that scope |
| Source preview | You build the revision shown by the site | Includes Unreleased APIs and export/charts modules; not a registry release |

The site defaults to npm 0.1.0 for an installable starting point. Switch channels explicitly for a source-only recipe. Internal dependency versions alone do not identify a source preview: also record the Git revision.

## Per-document revisions

Each public document has a stable ID, revision number, updated date, content hash (UTF-8 with LF line endings) and a short change summary in `documentation.json`. Revision 1 records the previous public snapshot; revision 2 aligns installation/status, adds the reader workflow and synchronizes current API contracts. New documents start at revision 1.

The website displays the channel, document revision, updated date and source revision beside the title. Its change page lists what changed per document. A document revision changes only when that document's content changes; it does not reset or version engine state/configuration schemas.

## Maintenance

Package README files and the guides in this repository are canonical consumer documentation. Refresh MCP copies with `npm run docs:sync`; the site imports the same files and checks their hashes. Do not fix only the site's downloaded Markdown or an MCP snapshot.

When changing an API: update its owning guide/README, record its release availability, update the affected document's revision/history, regenerate signatures and copies, compile the runnable examples, then deploy the site. Keep frozen 0.1.0 docs free of newer APIs. For breaking changes, provide a before/after migration example in release notes; documentation revision numbers are not a substitute for package SemVer.

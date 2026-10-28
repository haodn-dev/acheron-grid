# Release preparation

The current npm release is **0.3.0 development preview** for all eight packages. See
[the release notes](RELEASE-0.3.0.md) for changes and migration.
The original 0.1.0, 0.2.0 and 0.2.1 artifacts and tags remain immutable.

The approved next version is **0.4.0 development preview**; see its [candidate notes](RELEASE-0.4.0.md). Package preparation is separate from publication. Keep 0.3.0 as the current published scope until the release workflow and exact registry consumers verify 0.4.0.

This file retains the original 0.1.0 preparation procedure. The six original 0.1.0 packages are now
published previews; 0.2.0 includes the subsequent source APIs. Before selecting a future stable version, close
the [1.0 contract and acceptance gates](guides/v1-readiness.md). The current publisher aligns all eight
packages, so a stable subset cannot be published by that workflow without a separate tooling change.

For automated develop/stable publishing and one-time account configuration, see [release channels and trusted publishing](guides/releasing.md). Production trusted publishers are configured. The develop channel requires its own publisher-policy decision before activation.

At the original preparation baseline, `0.1.0` was selected and package manifests were prepared without publishing. That release and 0.2.0 have since been published; the root workspace remains private. The checklist below remains a preparation procedure, not authorization to publish, push tags or change the license.

## Before release

1. Confirm the newly agreed version and scope, supported environments and public documentation/demo URL. Do not reuse an existing release version or use the local `.test` address as a public website.
2. Review API changes, migration instructions and known limitations. Update the Unreleased section in [CHANGELOG.md](CHANGELOG.md), root/package README files, and bundled MCP documentation.
3. Verify all package versions and local dependency ranges agree. Review package contents, licenses and Lucide attribution. The root workspace remains private; change individual publication flags only as part of an explicit package-release decision.
4. Resolve failing checks and record actual results for the release commit. A rerun that passes does not explain an intermittent failure.

## Verification

From a clean checkout on Node.js 22 or 24:

```sh
npm ci
npm run typecheck
npm test
npm run test:mcp
npx playwright install chromium
npm run test:browser
npm run test:playground
npm pack --dry-run --workspaces
npm run test:package
```

Run the browser/playground suites sequentially; their server ports must be available. Inspect dry-run contents for built ESM/declarations, README and license files. Dry-run success is not evidence that package installation or registry publication will succeed. Before a package release, test the packed artifacts in an independent TypeScript application, including React/Vue where relevant. The test:package script installs all eight source tarballs in a temporary independent project, typechecks public imports, renders React/Vue SSR, and mounts/updates/destroys Canvas in Chromium. Its printed temporary directory is retained for diagnosis. Verify clipboard, reduced motion and intended browser support with the integration suites. Do not infer full screen-reader coverage or FPS from the existing Chromium suite.

CI checks Node 22/24 on Ubuntu and retains failed-browser diagnostics. Confirm the workflow for the intended release commit; local checks do not establish remote CI status.

## GitHub Release publication

Every future tagged release must have a published GitHub Release with substantive notes. Creating a Git tag or publishing npm packages alone does not complete this step. Existing tags do not need to be backfilled unless explicitly requested.

Prepare the notes before tagging. After publication and registry-consumer verification, publish the GitHub Release against the verified tag and check that its page displays:

- User-visible changes since the previous release, with a comparison link when available.
- The exact package version, npm links and installation command.
- Migration instructions, including an explicit statement when no migration is needed.
- Checks actually passed and relevant known limitations.
- The correct release status; 0.x development previews remain marked as prereleases.

Use the version-specific release notes as the basis for the body; do not leave it empty or rely only on a raw commit list. Record the GitHub Release URL alongside npm publication evidence. This is a requirement for future releases, not a request to create or edit historical GitHub Releases now.

## Release notes template

Use the following structure for a future GitHub draft release. Replace placeholders with verified facts; do not invent a version or release date.

```md
# Acheron Grid <version> — development preview

TypeScript data grid with a headless core, Canvas rendering, and React/Vue adapters.

## Changes
- <User-visible behavior and API changes since the previous release>

## Migration
- <Breaking changes and concrete before/after guidance, or None>

## Installation
<Verified checkout or published-package instructions for this release>

## Validation
<Checks and supported environments actually verified for this commit>

## Known limits
<Relevant synchronous-source, browser, accessibility and persistence limits>

## License
Apache 2.0; embedded third-party assets retain their documented notices.
```

Once release approval exists, verify npm scope ownership and authentication, publish only the approved artifacts in dependency order (core, canvas, markdown, react, vue, export, charts, mcp), and verify that each published package can be installed from the registry. Update the README and versioned notes from prepared to published only after successful publication. Create the agreed tag/draft from the verified release commit. A GitHub source release and npm publication are separate actions. Keep an unreleased section for subsequent work.

Current source uses Apache-2.0. Published npm 0.1.0 remains MIT and cannot be overwritten; use a new package version when publication resumes. Each package must ship its Apache LICENSE and project NOTICE plus any applicable third-party license files.

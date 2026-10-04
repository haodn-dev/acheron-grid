# Release preparation

Version `0.1.0` has been selected for the first release. Package manifests are prepared for public publication; the root workspace remains private. No package has been published by this preparation. This guide prepares a reviewable release; it does not authorize publishing, pushing tags or changing the license.

## Before release

1. Confirm the agreed 0.1.0 development-preview scope, supported environments and public documentation/demo URL. Do not use the local `.test` address as a public website.
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

Run the browser/playground suites sequentially; their server ports must be available. Inspect dry-run contents for built ESM/declarations, README and license files. Dry-run success is not evidence that package installation or registry publication will succeed. Before a package release, test the packed artifacts in an independent TypeScript application, including React/Vue where relevant. The test:package script installs all six tarballs in a temporary independent project, typechecks public imports, renders React/Vue SSR, and mounts/updates/destroys Canvas in Chromium. Its printed temporary directory is retained for diagnosis. Verify clipboard, reduced motion and intended browser support with the integration suites. Do not infer full screen-reader coverage or FPS from the existing Chromium suite.

CI checks Node 22/24 on Ubuntu and retains failed-browser diagnostics. Confirm the workflow for the intended release commit; local checks do not establish remote CI status.

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
MIT; embedded third-party assets retain their documented notices.
```

Once release approval exists, verify npm scope ownership and authentication, publish only the approved artifacts in dependency order (core, canvas, markdown, react, vue, mcp), and verify that each published package can be installed from the registry. Update the README and versioned notes from prepared to published only after successful publication. Create the agreed tag/draft from the verified release commit. A GitHub source release and npm publication are separate actions. Keep an unreleased section for subsequent work.

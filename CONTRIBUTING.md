# Contributing

Maintainers: see [package release setup and channels](guides/releasing.md) for GitHub Actions and npm trusted publishing.

Start with the public [architecture and design decisions](guides/architecture.md), package README and a minimal reproduction. Small documentation/example improvements and focused regression cases are suitable first contributions; maintainers should label only concrete scoped issues as `good first issue`.

All features and optional modules are open source and free. Keep core headless; Canvas depends on public core, and framework/transport/export/chart dependencies belong in optional modules.

Use a small branch and explain the observable problem, resulting behavior and validation. Reuse the controlled mutation/permission/validation/history pipeline. Do not turn synchronous atomic DataSource setters into promises. Define async lifecycle, cancellation, bounded work and stale-response behavior explicitly.

Use Node 22 or 24. From a clean checkout run `npm ci`, `npx playwright install chromium`, `npm run typecheck`, `npm test`, `npm run test:browser -- --workers=1`, `npm run test:playground -- --workers=1` and `npm run format:check`. Before a PR, also run `npm run test:mcp`, `npm run test:release`, `npm run test:package` and `npm run test:docs`. Browser integration and standalone playground use different servers; validate both. Changes affecting Canvas/core or adapters also need portable Firefox/WebKit evidence where available. Changes affecting performance should run the relevant benchmark with correctness checks; record raw samples, environment and source revision. CI publishes benchmark artifacts; retain only selected reproducible evidence in documentation. Do not infer FPS or GPU cost from callback timings.

For source documentation changes, run `npm run docs:sync` and review generated catalogs/hashes before `npm run test:docs`. Do not edit generated package documentation copies manually. Keep source-preview and published-version scopes separate. For formatter-only changes, use a separate commit and record it in `.git-blame-ignore-revs`.

Public API changes need consumer documentation, examples, regression checks and an Unreleased changelog entry. Source preview does not mean npm published. Do not introduce paid feature gates or license keys; retain dependency licenses. Keep credentials, application data and internal planning out of public submissions.

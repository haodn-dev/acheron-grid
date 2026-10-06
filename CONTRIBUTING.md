# Contributing

Maintainers: see [package release setup and channels](guides/releasing.md) for GitHub Actions and npm trusted publishing.

All features and optional modules are open source and free. Keep core headless; Canvas depends on public core, and framework/transport/export/chart dependencies belong in optional modules.

Use a small branch and explain the observable problem, resulting behavior and validation. Reuse the controlled mutation/permission/validation/history pipeline. Do not turn synchronous atomic DataSource setters into promises. Define async lifecycle, cancellation, bounded work and stale-response behavior explicitly.

Use Node 22 or 24. From a clean checkout run `npm ci`, `npm run typecheck`, `npm test`, `npm run test:mcp`, `npx playwright install chromium`, `npm run test:browser` and `npm run test:package`. Changes affecting performance should also run the relevant benchmark; record raw samples, environment and source revision. Do not infer FPS or GPU cost from callback timings.

Public API changes need consumer documentation, examples, regression checks and an Unreleased changelog entry. Source preview does not mean npm published. Do not introduce paid feature gates or license keys; retain dependency licenses. Keep credentials, application data and internal planning out of public submissions.

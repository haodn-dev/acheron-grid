# Acheron Grid Engine

This repository contains the public engine source. Keep the core in pure TypeScript and independent of Laravel, React and Vue.

Internal product planning, feature specifications, ADRs and worklogs are maintained in the companion private workspace, not this repository. Read that workspace documentation before substantive work when available. If unavailable, request access to the relevant private documents before changing behavior; never copy internal documents into public commits.

Each feature must have a dedicated internal specification. Update its final Changelog section and record a worklog for every substantive work session, including fixes, refactoring and tooling. Link actual engine commit hashes from private worklogs when available.

Keep public usage documentation accurate and distinguish proposed APIs, implementation and verified behavior. Public documentation must be explicitly intended for consumers; internal worklogs remain private.

Use short-lived feat/, fix/ or docs/ branches. Run relevant checks once build tooling exists. Do not publish packages or choose a license without an agreed release/license decision.

## Mandatory verification before commit, push and pull requests

1. Read applicable instructions, inspect the working tree, and identify all affected consumers before editing. Preserve unrelated user changes. Trace changed imports through package entry points, browser fixture servers, the standalone playground server and packed consumers. Do not assume one server or suite covers another.
2. For a defect, reproduce the failing path or capture evidence of its root cause before fixing it. Keep existing assertions, timeouts and skips intact; do not weaken tests to obtain a pass. Add focused regression coverage where existing tests do not exercise the defect.
3. After each implementation step, run `npm run typecheck`, `npm test`, `npm run test:browser -- --workers=1`, `npm run test:playground -- --workers=1` and `npm run format:check`. All five are mandatory for source, test, example, server, dependency or build changes. Browser integration and playground are separate suites with separate servers. Never build or regenerate dist concurrently with browser or packed-consumer tests.
4. Before pushing an implementation branch or opening/updating its PR, also run `npm run test:package`, `npm run test:mcp`, `npm run test:release` and `npm run test:docs` on the final candidate. Review generated documentation changes rather than blindly staging them. If unrelated user drafts prevent a clean generated-doc check, preserve the drafts and explicitly report that check as blocked; do not claim complete validation.
5. When imports, module layout or package exports change, inspect every serving route/import map and verify public export maps and built declarations against the baseline. For pure refactors, public API differences must be empty. Internal module extraction must also pass standalone playground and packed-consumer checks.
6. For core, Canvas or integration changes, run the existing Firefox and WebKit suites where the runtime works. For performance changes, capture comparable before/after samples with correctness assertions, warm-ups and workload/environment metadata; run the existing benchmark correctness suite. Record skipped opt-in profiles and measurement limits. Do not infer performance from functional tests or claim a browser passed when it failed to launch.
7. Inspect the final diff, run `git diff --check`, and record each required check as passed, failed, blocked or not applicable, including command, revision, counts and reason. Documentation/instruction-only changes require format and link checks, not runtime suites unless executable configuration also changed. Any later implementation change invalidates the affected results and requires rerunning those checks.
8. Commit only the authorized files. Push and create/update PRs when authorized, describing the actual scope and any failed/blocked checks. A CI-reproduction fix may be pushed with an explicitly disclosed environmental block so CI can verify it; never silently bypass a required check. After pushing, distinguish local results from CI results for the exact head SHA. Do not call the PR merge-ready until required CI checks pass; merging or publishing needs its own authorization.

## Development responsibilities and language

Implement engine code, adapters, tests, examples and public usage documentation here. Write the public README and usage documentation in professional English for external users and developers.

Keep internal specifications, architecture decisions, roadmap and worklogs in the companion private workspace, in Vietnamese. Change its Laravel application only for integration or demo work; do not duplicate the engine there. The demo consumes built core and Canvas packages through local file dependencies. Build core before Canvas, then build/run the demo; do not copy engine source.

For engine features, update the internal specification, implement and verify here, then record the actual engine commit hash in the private worklog. Working across both repositories does not mean implementing a feature twice.

## Source comments and architecture

Do not put AI agent, plugin or workflow names in source comments. Comments should explain technical reasons, invariants, limitations and performance assumptions.

Read the private workspace's docs/architecture/core-constitution.md before substantive engine changes. Treat headless core, one controlled mutation pipeline, independent capability permissions, sparse coordinate-based state, virtualization and stable public contracts as architectural direction. Core root is now headless; browser rendering/interaction lives in @acheron-grid/canvas and depends only on public core. Keep that dependency direction. For significant redesigns, inspect and report the smallest proposed design before implementing; preserve working behavior and avoid unrelated rewrites.

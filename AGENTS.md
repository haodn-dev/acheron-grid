# Acheron Grid Engine

This repository contains the public engine source. Keep the core in pure TypeScript and independent of Laravel, React and Vue.

Internal product planning, feature specifications, ADRs and worklogs are maintained in the companion private workspace, not this repository. Read that workspace documentation before substantive work when available. If unavailable, request access to the relevant private documents before changing behavior; never copy internal documents into public commits.

Each feature must have a dedicated internal specification. Update its final Changelog section and record a worklog for every substantive work session, including fixes, refactoring and tooling. Link actual engine commit hashes from private worklogs when available.

Keep public usage documentation accurate and distinguish proposed APIs, implementation and verified behavior. Public documentation must be explicitly intended for consumers; internal worklogs remain private.

Use short-lived feat/, fix/ or docs/ branches. Run relevant checks once build tooling exists. Do not publish packages or choose a license without an agreed release/license decision.

## Development responsibilities and language

Implement engine code, adapters, tests, examples and public usage documentation here. Write the public README and usage documentation in professional English for external users and developers.

Keep internal specifications, architecture decisions, roadmap and worklogs in the companion private workspace, in Vietnamese. Change its Laravel application only for integration or demo work; do not duplicate the engine there. The demo consumes built core and Canvas packages through local file dependencies. Build core before Canvas, then build/run the demo; do not copy engine source.

For engine features, update the internal specification, implement and verify here, then record the actual engine commit hash in the private worklog. Working across both repositories does not mean implementing a feature twice.

## Source comments and architecture

Do not put AI agent, plugin or workflow names in source comments. Comments should explain technical reasons, invariants, limitations and performance assumptions.

Read the private workspace's docs/architecture/core-constitution.md before substantive engine changes. Treat headless core, one controlled mutation pipeline, independent capability permissions, sparse coordinate-based state, virtualization and stable public contracts as architectural direction. Core root is now headless; browser rendering/interaction lives in @acheron-grid/canvas and depends only on public core. Keep that dependency direction. For significant redesigns, inspect and report the smallest proposed design before implementing; preserve working behavior and avoid unrelated rewrites.
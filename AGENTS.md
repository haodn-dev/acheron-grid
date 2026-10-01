# Acheron Grid Engine

This repository contains the public engine source. Keep the core in pure TypeScript and independent of Laravel, React and Vue.

Internal product planning, feature specifications, ADRs and worklogs are maintained in the companion private workspace, not this repository. Read that workspace documentation before substantive work when available. If unavailable, request access to the relevant private documents before changing behavior; never copy internal documents into public commits.

Each feature must have a dedicated internal specification. Update its final Changelog section and record a worklog for every substantive work session, including fixes, refactoring and tooling. Link actual engine commit hashes from private worklogs when available.

Keep public usage documentation accurate and distinguish proposed APIs, implementation and verified behavior. Public documentation must be explicitly intended for consumers; internal worklogs remain private.

Use short-lived feat/, fix/ or docs/ branches. Run relevant checks once build tooling exists. Do not publish packages or choose a license without an agreed release/license decision.

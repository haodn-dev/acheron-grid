# Contributing to Acheron Grid

Acheron Grid is an experimental TypeScript project. Discuss substantial API or architecture changes before implementing them. Keep changes focused and include a reproducible example for reported bugs.

## Setup

Use Node.js 22 or later. From the repository root:

```sh
npm ci
npm run build
npx playwright install chromium
```

Run `npm run playground` for the standalone example. No framework or application backend is required.

## Making changes

- Keep `packages/core` independent of browser globals and frameworks. Canvas imports only the public core API.
- Route writes through the existing mutation/permission/history pipeline. Avoid per-dataset-cell state; use sparse metadata and viewport work.
- Preserve validation, atomic batch writes, accessibility semantics and cleanup. Source count and row identity remain stable for each mounted engine.
- Update the relevant public guide and add a focused regression test for behavior changes. Write source comments and public documentation in English.

Run `npm run typecheck` and `npm test`. For rendering or interaction changes, also run `npm run test:browser`; for example changes, run `npm run test:playground`. Use `npm run benchmark` when changing render hot paths. Do not run suites sharing a server port simultaneously. There is no lint script.

Describe the problem, resulting behavior and actual checks in a pull request. Include screenshots when a visual change needs comparison. Do not publish a package as part of an ordinary contribution.

## Bug reports

Include the browser/version, relevant options, a small dataset or source stub, steps to reproduce, and expected versus actual behavior. Remove credentials and private application data from examples. Distinguish an engine bug from externally mutated source data or backend behavior.

## Licensing

Original project code is licensed under [MIT](LICENSE). Contributions should be compatible with MIT. Retain the existing third-party icon notices and document any additional third-party material.

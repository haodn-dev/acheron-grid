# Releasing packages

All eight packages remain public and free. CI configuration does not mean a package has been published.

## Channels

- Pushes to `develop` run the full engine CI and publish the next patch prerelease with npm tag `develop`. For source version `0.1.0`, run 123 publishes `0.1.1-dev.123`.
- Tags `vX.Y.Z` run the same CI and publish stable packages with npm tag `latest`. The tagged commit must be on the history of `main`, and every package and internal dependency must already match `X.Y.Z`.
- Pull requests run checks only. Package versions are aligned across all eight workspaces. Developing a breaking release requires selecting its stable version deliberately; automatic develop numbering is a preview channel, not a compatibility promise.

```sh
npm install @acheron-grid/core@develop @acheron-grid/canvas@develop
```

## One-time GitHub and npm setup

1. Merge `.github/workflows/ci.yml`, `.github/workflows/release.yml` and release tooling into `main` before creating `develop` from that updated commit.
2. Create environments `npm-develop` and `npm-production`. Restrict the first to branch `develop`, and the second to tags `v*`. Add a required reviewer for production where the GitHub plan supports it.
3. Protect `main` and `develop`: require pull requests, successful `Node 22`, `Node 24`, `Browser smoke firefox`, and `Browser smoke webkit` checks; block force pushes and deletion. Select the exact check names shown after the first CI run. Protect release tags from unauthorized creation/update/deletion as well.
4. On npm, configure GitHub trusted publishers on **each** package: owner `haodn-dev`, repository `acheron-grid`, workflow filename `release.yml`. Add one publisher for environment `npm-develop` and one for `npm-production`. No npm write token is needed. Enable GitHub Actions for the repository.
5. If a package has never been published, an owner must bootstrap that package interactively before its package settings can be configured. Publish the intended reviewed initial version with `--access public` and the intended tag; do not assume all eight `0.1.0` packages already exist.
6. Create `develop` only after the publisher settings are ready; its first push triggers a release. Merge changes through PRs thereafter.

The release job uses Node 24, npm 11.21.0, GitHub-hosted runners and `id-token: write`. Repository metadata must match GitHub. Trusted publishing automatically creates provenance for supported public repositories. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Stable release

Choose the version according to the public API change, then prepare a release PR:

```sh
npm run release -- prepare 0.2.0
npm install --package-lock-only --ignore-scripts
npm run release -- check 0.2.0
```

Update consumer documentation and the changelog. Commit the manifests and lockfile, merge the reviewed PR into `main`, and tag that exact commit:

```sh
git tag -a v0.2.0 -m "Release 0.2.0"
git push origin v0.2.0
```

Approve `npm-production` when requested. Do not tag an older version to replace a newer `latest`. Site deployment remains separate: update its committed distribution snapshots and docs in a site PR; Vercel deploys the site's configured production branch.

## Verification and retries

The release workflow runs full existing CI, then tests the prepared tarballs in an independent strict TypeScript/headless/SSR/browser consumer before publishing. After publishing, that same consumer installs the exact versions from npm and runs again. A green release requires both checks.

Publishing several packages is not atomic. The script preflights all eight tarballs and checks registry integrity before its first write. Re-running the **same GitHub run** reuses the same develop version, skips existing versions only when integrity matches, and publishes missing packages. Do not change source for a rerun. A registry version with different contents fails instead of being overwritten. Develop retries require the commit to remain the current `develop` tip; if it has advanced, use the newer run.

If the workflow failed after publication, inspect its logs before announcing a release: packages may already exist even though the registry consumer failed. No automatic unpublish or rollback is performed.

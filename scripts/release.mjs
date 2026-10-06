import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const packageOrder = ['core', 'canvas', 'markdown', 'react', 'vue', 'export', 'charts', 'mcp'];
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const valid = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.[1-9]\d*)?$/;
export function developVersion(base, run) {
  if (!stable.test(base) || !/^[1-9]\d*$/.test(String(run)))
    throw new Error('Expected a stable base version and positive run number.');
  const [major, minor, patch] = base.split('.');
  return `${major}.${minor}.${BigInt(patch) + 1n}-dev.${run}`;
}
export async function prepare(root, version) {
  if (!valid.test(version)) throw new Error('Use X.Y.Z or X.Y.Z-dev.N.');
  const packages = await Promise.all(
    packageOrder.map(async (directory) => ({
      directory,
      json: JSON.parse(await readFile(join(root, 'packages', directory, 'package.json'), 'utf8')),
    })),
  );
  const names = new Set(packages.map(({ json }) => json.name));
  for (const { directory, json } of packages) {
    json.version = version;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'])
      for (const name of Object.keys(json[field] ?? {})) if (names.has(name)) json[field][name] = version;
    await writeFile(join(root, 'packages', directory, 'package.json'), JSON.stringify(json, null, 2) + '\n');
  }
}
export async function check(root, version) {
  if (!valid.test(version)) throw new Error('Invalid release version.');
  const packages = await Promise.all(
    packageOrder.map(async (directory) =>
      JSON.parse(await readFile(join(root, 'packages', directory, 'package.json'), 'utf8')),
    ),
  );
  const names = new Set(packages.map((pkg) => pkg.name));
  for (const pkg of packages) {
    if (pkg.version !== version) throw new Error(`${pkg.name}: expected version ${version}, got ${pkg.version}.`);
    if (pkg.repository?.url !== 'git+https://github.com/haodn-dev/acheron-grid.git')
      throw new Error(`${pkg.name}: repository URL must match the trusted publisher.`);
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'])
      for (const [name, value] of Object.entries(pkg[field] ?? {}))
        if (names.has(name) && value !== version) throw new Error(`${pkg.name}: ${name} must use ${version}.`);
  }
  return packages;
}
function npm(args, cwd) {
  if (!process.env.npm_execpath) throw new Error('Run through npm run release -- ...');
  return spawnSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, encoding: 'utf8' });
}
function success(result) {
  if (result.status !== 0) throw new Error(result.stderr + '\n' + result.stdout);
  return result.stdout;
}
async function publish(root, version, tag) {
  if (
    (tag === 'develop' && !version.includes('-dev.')) ||
    (tag === 'latest' && !stable.test(version)) ||
    !['develop', 'latest'].includes(tag)
  )
    throw new Error('Release version does not match dist-tag.');
  const packages = await check(root, version);
  const destination = await mkdtemp(join(tmpdir(), 'acheron-release-'));
  const pending = [];
  // Inspect every tarball and existing version before the first registry write.
  for (const pkg of packages) {
    const [pack] = JSON.parse(
      success(npm(['pack', '--workspace', pkg.name, '--json', '--pack-destination', destination], root)),
    );
    const result = npm(
      ['view', `${pkg.name}@${version}`, 'dist.integrity', '--json', '--registry=https://registry.npmjs.org'],
      root,
    );
    if (result.status === 0) {
      if (JSON.parse(result.stdout) !== pack.integrity)
        throw new Error(`${pkg.name}@${version} already exists with different contents.`);
      console.log(`Already published: ${pkg.name}@${version}`);
    } else {
      if (!/E404/.test(result.stderr + '\n' + result.stdout)) throw new Error(result.stderr + '\n' + result.stdout);
      pending.push(join(destination, pack.filename));
    }
  }
  for (const tarball of pending)
    console.log(
      success(
        npm(
          [
            'publish',
            tarball,
            '--access=public',
            '--tag',
            tag,
            '--provenance',
            '--registry=https://registry.npmjs.org',
          ],
          root,
        ),
      ),
    );
  console.log(`Verified/published ${packages.length} packages at ${version}; tag ${tag}.`);
}
async function main() {
  const [command, value, tag] = process.argv.slice(2),
    root = resolve('.');
  if (command === 'prepare') await prepare(root, value);
  else if (command === 'develop') {
    const core = JSON.parse(await readFile(join(root, 'packages/core/package.json'), 'utf8'));
    const version = developVersion(core.version, value);
    await prepare(root, version);
    console.log(version);
  } else if (command === 'check') await check(root, value);
  else if (command === 'publish') await publish(root, value, tag);
  else
    throw new Error(
      'Usage: npm run release -- prepare VERSION | develop RUN_NUMBER | check VERSION | publish VERSION develop|latest',
    );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ciScope } from '../scripts/ci-scope.mjs';

test('CI scope keeps documentation light and forces runtime for code, releases and uncertain diffs', () => {
  const event = { name: 'push', base: 'before', head: 'head' };
  const paths = (files) => () => files.join('\0') + '\0';
  for (const files of [['README.md'], ['guides/usage.md', 'documentation.json'], ['assets/readme/grid.png']])
    assert.equal(ciScope(event, paths(files)).runtime, false);
  for (const file of [
    'src/grid.ts',
    'package-lock.json',
    'package.json',
    '.github/workflows/ci.yml',
    'scripts/check.mjs',
    'assets/readme/app.js',
    'example.html',
  ])
    assert.equal(ciScope(event, paths(['README.md', file])).runtime, true, file);
  assert.equal(ciScope(event, paths([])).runtime, true);
  assert.equal(
    ciScope(event, () => {
      throw new Error('missing base');
    }).runtime,
    true,
  );
  for (const override of [
    { refType: 'tag' },
    { forceFull: true },
    { name: 'workflow_call' },
    { name: 'workflow_dispatch' },
  ])
    assert.equal(ciScope({ ...event, ...override }, paths(['README.md'])).runtime, true);
});

test('real Git diffs use PR merge bases, include deleted rename sources and handle new branches', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'acheron-ci-'));
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const commit = () => {
    git(['add', '.']);
    git(['-c', 'user.name=CI', '-c', 'user.email=ci@example.invalid', 'commit', '-qm', 'fixture']);
    return git(['rev-parse', 'HEAD']).trim();
  };
  try {
    git(['init', '-q']);
    writeFileSync(join(cwd, 'README.md'), '# Grid\n');
    writeFileSync(join(cwd, 'runtime.js'), 'export const value = 1;\n');
    const base = commit();
    git(['update-ref', 'refs/remotes/origin/main', base]);
    writeFileSync(join(cwd, 'README.md'), '# Grid\nUpdated.\n');
    const head = commit();
    assert.equal(ciScope({ name: 'pull_request', base, head }, git).runtime, false);
    assert.equal(ciScope({ name: 'push', base: '0'.repeat(40), head, defaultBranch: 'main' }, git).runtime, false);
    git(['checkout', '-qb', 'base-advanced', base]);
    writeFileSync(join(cwd, 'base-only.js'), 'export {};\n');
    const advanced = commit();
    assert.equal(ciScope({ name: 'pull_request', base: advanced, head }, git).runtime, false);
    git(['checkout', '-q', '--detach', head]);
    renameSync(join(cwd, 'runtime.js'), join(cwd, 'runtime.md'));
    const renamed = commit();
    const scope = ciScope({ name: 'push', base: head, head: renamed }, git);
    assert.equal(scope.runtime, true);
    assert.ok(scope.files.includes('runtime.js'));
    assert.ok(scope.files.includes('runtime.md'));
    rmSync(join(cwd, 'runtime.md'));
    const deleted = commit();
    assert.equal(ciScope({ name: 'push', base: renamed, head: deleted }, git).runtime, false);
  } finally {
    assert.ok(cwd.startsWith(join(tmpdir(), 'acheron-ci-')));
    rmSync(cwd, { recursive: true, force: true });
  }
});

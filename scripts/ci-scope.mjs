import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function ciScope(event, git = (args) => execFileSync('git', args, { encoding: 'utf8' })) {
  if (event.forceFull || event.refType === 'tag' || !['push', 'pull_request'].includes(event.name))
    return { runtime: true, files: [] };
  try {
    const head = event.head;
    let base = event.base;
    if (event.name === 'pull_request') base = git(['merge-base', base, head]).trim();
    else if (!base || /^0+$/.test(base)) base = git(['merge-base', `origin/${event.defaultBranch}`, head]).trim();
    const files = git(['diff', '--name-only', '--no-renames', '-z', base, head, '--']).split('\0').filter(Boolean);
    const docs = (file) =>
      file.endsWith('.md') || file === 'documentation.json' || /^assets\/readme\/.+\.(png|jpe?g|webp|gif)$/.test(file);
    return { runtime: files.length === 0 || !files.every(docs), files };
  } catch {
    return { runtime: true, files: [] };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const result = ciScope({
    name: process.env.GITHUB_EVENT_NAME,
    refType: process.env.GITHUB_REF_TYPE,
    forceFull: process.env.FORCE_FULL === 'true',
    head: event.pull_request?.head.sha ?? process.env.GITHUB_SHA,
    base: event.pull_request?.base.sha ?? event.before,
    defaultBranch: event.repository.default_branch,
  });
  appendFileSync(process.env.GITHUB_OUTPUT, `runtime=${result.runtime}\nfiles=${JSON.stringify(result.files)}\n`);
  console.log(`${result.runtime ? 'Full runtime' : 'Documentation-only'} CI: ${result.files.length} changed paths.`);
}

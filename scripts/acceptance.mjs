import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const cli = fileURLToPath(new URL('../cli/run.mjs', import.meta.url));
const directory = process.argv[2]
  ? resolve(process.argv[2])
  : join(mkdtempSync(join(tmpdir(), 'fuse-acceptance-')), 'demo');
function run(args, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
    encoding: 'utf8',
    timeout: 45000,
  });
  assert.equal(result.status, expected, result.stderr || result.stdout);
  const body = JSON.parse(result.stdout);
  assert.equal(body.schemaVersion, 1);
  return body.data;
}
const fixture = run(['demo', '--dir', directory]);
const repo = fixture.repo;
const command = (...args) => [...args, '--repo', repo];
run(command('session', 'remove', 'request'));
run(command('session', 'remove', 'schema'));
run(
  command(
    'session',
    'add',
    'request',
    '--name',
    'Request validation',
    '--worktree',
    fixture.sessionA,
  ),
);
run(
  command(
    'session',
    'add',
    'schema',
    '--name',
    'Schema validation',
    '--worktree',
    fixture.sessionB,
  ),
);
const alert = run(command('watch', '--once'), 2);
assert.equal(alert.alert, true);
assert.equal(run(command('watch', '--once')).alert, false);
let review = alert.review;
assert.equal(review.files[0].analysis.conflicts[0].id, 'overlap:validateBody');
review = run(
  command(
    'intent',
    review.id,
    '--first',
    'a',
    '--note',
    'Missing fields should get the friendly error before schema details.',
  ),
  2,
);
assert.equal(review.files[0].recommendations[0].action.order, 'a-first');
review = run(
  command(
    'decide',
    review.id,
    '--file',
    'checkout.ts',
    '--conflict',
    'overlap:validateBody',
    '--choice',
    'both',
    '--order',
    'a-first',
    '--note',
    'Keep both validators and preserve the expected first error.',
  ),
);
review = run(command('preview', review.id));
review = run(command('apply', review.id, '--approve', review.preview.token));
assert.equal(review.checks[0].status, 'passed');
for (const args of [
  ['add', 'checkout.ts'],
  ['commit', '-m', 'Resolve checkout with Fuse evidence'],
]) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
review = run(command('link', review.id, '--commit', 'HEAD'));
assert.equal(review.status, 'committed');
assert.equal(run(command('review', review.id)).commit, review.commit);
assert.ok(run(command('history')).some((r) => r.id === review.id && r.commit === review.commit));
const single = run(['demo', '--dir', `${directory}-single`, '--single']);
assert.equal(single.review.files[0].analysis.conflicts.length, 0);
assert.ok(single.review.files[0].evidence.some((e) => e.revision === 'a' && e.observations.length));
// Exercise the actual visual-server CLI entry point and repository-bound review route.
const server = spawn(
  process.execPath,
  [cli, ...command('review', review.id, '--serve', '--port', '3211')],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let startup = '';
let errors = '';
server.stderr.on('data', (data) => {
  errors += data;
});
try {
  await new Promise((accept, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Visual server did not start: ${errors}`)),
      15000,
    );
    server.on('error', reject);
    server.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Visual server exited ${code}: ${errors}`));
    });
    server.stdout.on('data', (data) => {
      startup += data;
      if (startup.includes('http://127.0.0.1:3211')) {
        clearTimeout(timeout);
        accept();
      }
    });
  });
  const response = await fetch(`http://127.0.0.1:3211/api/reviews/${review.id}`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).commit, review.commit);
  assert.equal((await fetch('http://127.0.0.1:3211/')).status, 200);
} finally {
  server.kill('SIGTERM');
}
console.log(
  JSON.stringify(
    {
      status: 'passed',
      repository: repo,
      review: review.id,
      commit: review.commit,
      checks: review.checks.map((c) => ({ name: c.name, status: c.status })),
      singleChange: single.repo,
      reopen: `node ${quote(cli)} review ${review.id} --repo ${quote(repo)} --serve --open`,
    },
    null,
    2,
  ),
);

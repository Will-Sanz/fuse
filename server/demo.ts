import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkoutExample } from '../shared/example';
import { InputError } from './engine';
import { git } from './git';
import { configureCheck, inspect, registerSession, setIntent } from './local';
import { LocalStore } from './local-store';

/** Scripted fixture construction only. All subsequent analysis uses real Git/worktree reads. */
export function createDemo(directory: string, single = false) {
  const dir = resolve(directory);
  if (existsSync(dir))
    throw new InputError('Demo destination must not exist. Choose a new directory.');
  const repo = join(dir, 'checkout'),
    a = join(dir, 'session-a'),
    b = join(dir, 'session-b');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'pipe' });
  git(repo, ['config', 'user.name', 'Fuse Demo']);
  git(repo, ['config', 'user.email', 'demo@fuse.local']);
  writeFileSync(join(repo, 'checkout.ts'), checkoutExample.base);
  writeFileSync(join(repo, 'package.json'), '{"type":"module"}\n');
  writeFileSync(
    join(repo, 'checkout.test.mjs'),
    `import assert from 'node:assert/strict';
import { requestHandler } from './checkout.ts';
const expected = process.argv[2] === 'specific' ? 'email: enter a valid email address' : 'Your order is incomplete';
assert.deepEqual(requestHandler({}), {ok:false,error:expected});
assert.deepEqual(requestHandler({email:'ok@example.com',items:['book']}), {ok:true});
assert.deepEqual(requestHandler({email:'wrong',items:['book']}), {ok:false,error:'email: enter a valid email address'});
console.log('PASS: empty order, valid order, and malformed email');
`,
  );
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'Checkout fixture common base']);
  if (single) writeFileSync(join(repo, 'checkout.ts'), checkoutExample.agentA);
  else {
    git(repo, ['worktree', 'add', '-b', 'session/request', a]);
    git(repo, ['worktree', 'add', '-b', 'session/schema', b]);
    registerSession(repo, 'request', 'Request validation', a);
    registerSession(repo, 'schema', 'Schema validation', b);
    writeFileSync(join(a, 'checkout.ts'), checkoutExample.agentA);
    writeFileSync(join(b, 'checkout.ts'), checkoutExample.agentB);
    configureCheck(repo, {
      name: 'Checkout behavior: friendly errors first',
      command: process.execPath,
      args: ['checkout.test.mjs', 'friendly'],
      timeoutMs: 10000,
    });
  }
  let review = inspect({ repo, sessions: !single });
  if (!single)
    review = setIntent(repo, review.id, review.revision, {
      first: 'a',
      rationale:
        'Missing fields should receive the friendly incomplete-order error first. Malformed email should still receive a specific error.',
    });
  review.demo = true;
  review.title = single ? 'A normal checkout change' : 'Checkout validation';
  new LocalStore(repo).save(review);
  return {
    repo,
    sessionA: single ? undefined : a,
    sessionB: single ? undefined : b,
    review,
    scripted: true,
    expectation: single
      ? undefined
      : 'Empty orders show the friendly incomplete-order message; malformed email still gets a specific error.',
  };
}

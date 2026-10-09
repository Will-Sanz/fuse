import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { checkoutExample, shippingExample } from '../shared/example';
import { exampleVisual } from '../shared/demo-visuals';
import { InputError } from './engine';
import { git } from './git';
import { configureCheck, inspect, registerSession, setIntent } from './local';
import { LocalStore } from './local-store';

/** Scripted fixture construction only. All subsequent analysis uses real Git/worktree reads. */
export function createDemo(
  directory: string,
  single = false,
  options: { scenario?: 'checkout' | 'shipping'; presentation?: boolean; merge?: boolean } = {},
) {
  const scenario = options.scenario || 'checkout';
  const input = scenario === 'shipping' ? shippingExample : checkoutExample;
  const file = input.fileName;
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
  writeFileSync(join(repo, file), input.base);
  writeFileSync(join(repo, 'package.json'), '{"type":"module"}\n');
  writeFileSync(
    join(repo, 'README.md'),
    scenario === 'shipping'
      ? '# Checkout shipping\nShipping costs $10. Free shipping begins at $100. Two policies disagree about whether discounts count toward eligibility. Example: a $120 basket receives a $30 discount.\n'
      : '# Checkout validation\nRequests pass through required-field and schema checks. Both can reject an empty order. The product decision is which error the customer sees first. The schema also rejects malformed email and invalid items.\n',
  );
  if (scenario === 'checkout')
    writeFileSync(
      join(repo, 'checkout.test.mjs'),
      `import assert from 'node:assert/strict';
import { requestHandler } from './checkout.ts';
const expected = process.argv[2] === 'specific' ? 'email: enter a valid email address' : 'Your order is incomplete';
if (process.argv[2] === 'any') assert.ok(['Your order is incomplete', 'email: enter a valid email address'].includes(requestHandler({}).error));
else assert.deepEqual(requestHandler({}), {ok:false,error:expected});
assert.deepEqual(requestHandler({email:'ok@example.com',items:['book']}), {ok:true});
assert.deepEqual(requestHandler({email:'wrong',items:['book']}), {ok:false,error:'email: enter a valid email address'});
console.log('PASS: empty order, valid order, and malformed email');
`,
    );
  if (scenario === 'shipping')
    writeFileSync(
      join(repo, 'shipping.test.mjs'),
      `import assert from 'node:assert/strict';
import {shippingCost, orderTotal} from './shipping.ts';
assert.equal(shippingCost(80, 0), 10);
assert.equal(shippingCost(150, 10), 0);
assert.ok([90, 100].includes(orderTotal(120, 30)));
console.log('PASS: shipping boundaries; discounted basket total = $' + orderTotal(120, 30));
`,
    );
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'Checkout fixture common base']);
  if (single) writeFileSync(join(repo, file), input.agentA);
  else {
    git(repo, ['worktree', 'add', '-b', 'session/request', a]);
    git(repo, ['worktree', 'add', '-b', 'session/schema', b]);
    registerSession(repo, 'request', input.nameA, a);
    registerSession(repo, 'schema', input.nameB, b);
    writeFileSync(join(a, file), input.agentA);
    writeFileSync(join(b, file), input.agentB);
    configureCheck(repo, {
      name: options.presentation ? 'Checkout behavior' : 'Checkout behavior: friendly errors first',
      command: process.execPath,
      args:
        scenario === 'shipping'
          ? ['shipping.test.mjs']
          : ['checkout.test.mjs', options.presentation ? 'any' : 'friendly'],
      timeoutMs: 10000,
    });
  }
  if (options.merge) {
    for (const path of [a, b]) {
      git(path, ['add', file]);
      git(path, ['commit', '-m', path === a ? input.nameA : input.nameB]);
    }
    git(repo, ['merge', '--ff-only', 'session/request']);
    const result = spawnSync('git', ['-C', repo, 'merge', '--no-edit', 'session/schema'], {
      encoding: 'utf8',
    });
    if (result.status !== 1 || !git(repo, ['ls-files', '--unmerged']))
      throw new InputError('The meeting example must contain a real Git merge conflict.');
  }
  let review = inspect({ repo, sessions: !single && !options.merge });
  if (!single && !options.presentation && scenario === 'checkout')
    review = setIntent(repo, review.id, review.revision, {
      first: 'a',
      rationale:
        'Missing fields should receive the friendly incomplete-order error first. Malformed email should still receive a specific error.',
    });
  review.demo = true;
  review.title = single ? 'A normal checkout change' : input.title;
  if (options.presentation && !options.merge)
    review.visual = exampleVisual(scenario, file, review.files[0]?.analysis.conflicts[0]?.id);
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

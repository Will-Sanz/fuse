import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { validateAdaptedLock } from '../adapted.mjs';

const fixture = () =>
  JSON.parse(readFileSync(new URL('../adapted-lock.json', import.meta.url), 'utf8'));

test('adapted source lock pins both real upstream trees and all eight authored case identities', () => {
  const lock = fixture();
  validateAdaptedLock(lock);
  assert.equal(lock.cases.filter((c) => c.label === 'conflict').length, 4);
  assert.deepEqual([...new Set(lock.cases.map((c) => c.target))].sort(), ['click', 'ms']);
  for (const mutate of [
    (l) => {
      l.cases[1].id = l.cases[0].id;
    },
    (l) => {
      l.cases[0].target = '../outside';
    },
    (l) => {
      l.cases[0].target = '__proto__';
    },
    (l) => {
      l.cases[0].label = 'no_conflict';
    },
    (l) => {
      l.cases[0].aCommit = '--all';
    },
    (l) => {
      l.cases[0].aTree = 'not-a-tree';
    },
    (l) => {
      l.targets.click.tree = l.cases[0].baseTree = 'a'.repeat(40);
    },
    (l) => {
      l.targets.click.commit = 'a'.repeat(40);
    },
  ]) {
    const changed = fixture();
    mutate(changed);
    assert.throws(() => validateAdaptedLock(changed));
  }
});

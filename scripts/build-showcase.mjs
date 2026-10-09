import { register } from 'tsx/esm/api';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
register();
const { analyze, explain, resolve, hash } = await import('../server/engine.ts');
const { checkoutExample, shippingExample } = await import('../shared/example.ts');
const { exampleVisual } = await import('../shared/demo-visuals.ts');
const { actionDecision } = await import('../shared/visual.ts');
const { renderVisual } = await import('../server/visual-renderer.ts');
const directory = new URL('../public/showcase/', import.meta.url);
mkdirSync(directory, { recursive: true });
for (const [scenario, input] of [
  ['checkout', checkoutExample],
  ['shipping', shippingExample],
]) {
  const analysis = analyze(input);
  assert.equal(analysis.conflicts.length, 1);
  const conflictId = analysis.conflicts[0].id;
  const visual = exampleVisual(scenario, input.fileName, conflictId);
  const outputs = Object.fromEntries(
    visual.options.map((option) => [
      option.action,
      resolve(
        input,
        { [conflictId]: { ...actionDecision(option.action), note: option.description } },
        analysis,
      ),
    ]),
  );
  assert.equal(new Set(Object.values(outputs)).size, visual.options.length);
  const snapshot = (code, label) => ({
    ref: { kind: 'revision', value: 'example', label },
    head: 'example',
    fingerprint: hash(code),
    files: { [input.fileName]: { code, hash: hash(code), mode: '100644' } },
  });
  const review = {
    schemaVersion: 1,
    id: scenario,
    revision: 0,
    title: input.title,
    repository: 'checkout',
    commonDir: '',
    baseCommit: 'example',
    targetHead: 'example',
    sources: { a: snapshot(input.agentA, input.nameA), b: snapshot(input.agentB, input.nameB) },
    files: [
      {
        path: input.fileName,
        input,
        analysis,
        ...explain(input),
        decisions: {},
        recommendations: [],
      },
    ],
    unsupported: [],
    status: 'proposed',
    createdAt: visual.generatedAt,
    updatedAt: visual.generatedAt,
    checks: [],
    events: [],
    attribution: { kind: 'local-git', name: '', email: '', verified: false },
    demo: true,
    visual,
  };
  writeFileSync(new URL(`${scenario}.json`, directory), JSON.stringify({ review, outputs }));
  writeFileSync(new URL(`${scenario}.svg`, directory), renderVisual(visual));
  console.log(
    `Built ${scenario}: real analysis, ${visual.options.length} resolved outputs, prepared visual.`,
  );
}

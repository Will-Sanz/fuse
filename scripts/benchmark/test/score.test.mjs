import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreRuns } from '../score.mjs';

const cases = [
  { id: 'positive', type: 'runtime', label: 'conflict' },
  { id: 'negative', type: 'negative', label: 'no_conflict' },
];
function row(caseId, arm, assessment, extra = {}) {
  return {
    caseId,
    arm,
    status: 'complete',
    assessment,
    category: assessment === 'conflict' ? 'runtime' : 'none',
    explanation: 'Source-grounded assessment.',
    involved_symbols: ['app'],
    durationMs: arm === 'agent' ? 10 : 20,
    tokens: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10 },
    mcp: { inspectAttempts: arm === 'fuse' ? 1 : 0, inspectSuccesses: arm === 'fuse' ? 1 : 0 },
    ...extra,
  };
}
const paired = () => [
  row('positive', 'agent', 'no-conflict'),
  row('positive', 'fuse', 'conflict'),
  row('negative', 'agent', 'no-conflict'),
  row('negative', 'fuse', 'no-conflict'),
];

test('scores paired improvement and actual usage with complete coverage', () => {
  const report = scoreRuns(cases, paired());
  assert.equal(report.observedRuns, 4);
  assert.equal(report.arms.agent.validOnly.recall, 0);
  assert.equal(report.arms.fuse.validOnly.recall, 1);
  assert.equal(report.arms.fuse.validOnly.precision, 1);
  assert.deepEqual(report.paired.fuseOnlyCorrect, ['positive']);
  assert.equal(report.paired.accuracyDeltaOnBothDeterminate, 0.5);
  assert.equal(report.paired.coverage, 1);
  assert.equal(report.arms.fuse.mcp.inspectAttempts, 2);
  assert.equal(report.arms.fuse.tokens.totals.input_tokens, 200);
  assert.equal(report.arms.fuse.durationMs.median, 20);
  assert.equal(report.arms.fuse.costUsd, null);
});

test('errors and abstentions stay unresolved instead of becoming safe outcomes', () => {
  const rows = paired();
  rows[1] = row('positive', 'fuse', 'conflict', { status: 'timeout' });
  rows[3] = row('negative', 'fuse', 'insufficient-evidence');
  const report = scoreRuns(cases, rows);
  assert.equal(report.arms.fuse.states.timeout, 1);
  assert.equal(report.arms.fuse.abstentions, 1);
  assert.equal(report.arms.fuse.determinateCoverage, 0);
  assert.equal(report.arms.fuse.validOnly.denominator, 0);
  assert.equal(report.arms.fuse.validOnly.recall, null);
  assert.equal(report.arms.fuse.unresolved.length, 2);
  assert.equal(report.arms.fuse.officialCompatibility.falseNegatives, 1);
  assert.equal(report.arms.fuse.officialCompatibility.trueNegatives, 1);
  assert.match(report.arms.fuse.officialCompatibility.policy, /unresolved, not safe/);
  assert.equal(report.paired.bothDeterminate, 0);
  assert.equal(report.paired.accuracyDeltaOnBothDeterminate, null);
});

test('failed MCP attempt remains in intent-to-treat and successful subset shows its denominator', () => {
  const rows = paired();
  rows[1].mcp = {
    status: 'unsupported',
    inspectAttempts: 1,
    inspectSuccesses: 0,
    unsupported: ['multi-file'],
  };
  const report = scoreRuns(cases, rows);
  assert.equal(report.arms.fuse.validOnly.denominator, 2);
  assert.equal(report.arms.fuse.validOnly.recall, 1);
  assert.deepEqual(report.arms.fuse.mcp.failedInspectCases, ['positive']);
  assert.deepEqual(report.arms.fuse.mcp.unsupportedCases, ['positive']);
  assert.equal(report.arms.fuse.mcp.successfulAssistanceSubset.denominator, 1);
  assert.equal(report.arms.fuse.mcp.successfulAssistanceSubset.coverage, 0.5);
});

test('wrong-ref success does not count as successful matched assistance after the correct call errors', () => {
  const rows = paired();
  rows[1].mcp = {
    inspectAttempts: 2,
    inspectSuccesses: 1,
    matchedInspectAttempts: 1,
    matchedInspectSuccesses: 0,
  };
  const report = scoreRuns(cases, rows);
  assert.equal(report.arms.fuse.validOnly.denominator, 2);
  assert.equal(report.arms.fuse.mcp.inspectAttempts, 2);
  assert.equal(report.arms.fuse.mcp.inspectSuccesses, 1);
  assert.equal(report.arms.fuse.mcp.rawInspectAttempts, 3);
  assert.equal(report.arms.fuse.mcp.rawInspectSuccesses, 2);
  assert.deepEqual(report.arms.fuse.mcp.failedInspectCases, ['positive']);
  assert.equal(report.arms.fuse.mcp.successfulAssistanceSubset.denominator, 1);
  assert.equal(report.arms.fuse.mcp.successfulAssistanceSubset.coverage, 0.5);
  rows[1].mcp.matchedInspectAttempts = 0;
  assert.throws(() => scoreRuns(cases, rows), /no actual inspect/);
  rows[1].mcp.matchedInspectAttempts = 3;
  assert.throws(() => scoreRuns(cases, rows), /Matched MCP counts/);
  rows[1].mcp.matchedInspectAttempts = 1;
  rows[1].mcp.matchedInspectSuccesses = 2;
  assert.throws(() => scoreRuns(cases, rows), /Matched MCP counts/);
  delete rows[1].mcp.matchedInspectSuccesses;
  assert.throws(() => scoreRuns(cases, rows), /supplied together/);
  rows[1].mcp.matchedInspectSuccesses = null;
  assert.throws(() => scoreRuns(cases, rows), /Invalid MCP/);
});

test('rejects missing, duplicate, invalid and protocol-inconsistent runs', () => {
  assert.throws(() => scoreRuns(cases, paired().slice(1)), /Missing paired/);
  assert.throws(() => scoreRuns(cases, [...paired(), paired()[0]]), /Duplicate/);
  const zeroInspect = paired();
  zeroInspect[1].mcp = { inspectAttempts: 0, inspectSuccesses: 0 };
  assert.throws(() => scoreRuns(cases, zeroInspect), /no actual inspect/);
  const badControl = paired();
  badControl[0].mcp = { inspectAttempts: 1, inspectSuccesses: 1 };
  assert.throws(() => scoreRuns(cases, badControl), /Control arm/);
  const badAnswer = paired();
  badAnswer[1].assessment = 'safe-ish';
  assert.throws(() => scoreRuns(cases, badAnswer), /Invalid completed/);
  const badDuration = paired();
  badDuration[0].durationMs = NaN;
  assert.throws(() => scoreRuns(cases, badDuration), /duration/);
});

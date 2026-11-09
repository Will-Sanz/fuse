const ARMS = ['agent', 'fuse'];
const STATUSES = ['complete', 'error', 'timeout', 'protocol_error'];
const ASSESSMENTS = ['conflict', 'no-conflict', 'insufficient-evidence'];
const CATEGORIES = ['textual', 'build', 'test', 'runtime', 'intent', 'none'];
const ratio = (n, d) => (d ? n / d : null);
const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
};

function determinate(row) {
  return row.status === 'complete' && row.assessment !== 'insufficient-evidence';
}
const inspectCount = (row, kind) =>
  row.mcp?.[`matchedInspect${kind}`] ?? row.mcp?.[`inspect${kind}`] ?? 0;
function confusion(cases, rows) {
  const c = { truePositives: 0, falseNegatives: 0, falsePositives: 0, trueNegatives: 0 };
  let categoryCorrect = 0;
  const misses = [],
    falseAlarms = [];
  for (const testCase of cases) {
    const row = rows.get(testCase.id);
    const predicted = determinate(row) && row.assessment === 'conflict';
    const actual = testCase.label === 'conflict';
    if (actual && predicted) {
      c.truePositives++;
      if (row.category === testCase.type) categoryCorrect++;
    } else if (actual) {
      c.falseNegatives++;
      misses.push(testCase.id);
    } else if (predicted) {
      c.falsePositives++;
      falseAlarms.push(testCase.id);
    } else c.trueNegatives++;
  }
  return {
    denominator: cases.length,
    ...c,
    precision: ratio(c.truePositives, c.truePositives + c.falsePositives),
    recall: ratio(c.truePositives, c.truePositives + c.falseNegatives),
    accuracy: ratio(c.truePositives + c.trueNegatives, cases.length),
    falsePositiveRate: ratio(c.falsePositives, c.falsePositives + c.trueNegatives),
    categoryAccuracy: ratio(categoryCorrect, c.truePositives),
    misses,
    falseAlarms,
  };
}
function validateRecord(row) {
  if (!ARMS.includes(row.arm) || !STATUSES.includes(row.status))
    throw new Error(`Invalid arm/status for ${row.caseId}`);
  if (
    row.status === 'complete' &&
    (!ASSESSMENTS.includes(row.assessment) ||
      !CATEGORIES.includes(row.category) ||
      (row.assessment === 'conflict' && row.category === 'none') ||
      typeof row.explanation !== 'string' ||
      !row.explanation.trim() ||
      !Array.isArray(row.involved_symbols) ||
      row.involved_symbols.some((x) => typeof x !== 'string'))
  )
    throw new Error(`Invalid completed assessment for ${row.caseId}/${row.arm}`);
  if (!Number.isFinite(row.durationMs) || row.durationMs < 0)
    throw new Error(`Invalid duration for ${row.caseId}/${row.arm}`);
  for (const key of [
    'inspectAttempts',
    'inspectSuccesses',
    'matchedInspectAttempts',
    'matchedInspectSuccesses',
  ]) {
    const n = row.mcp?.[key] === undefined ? 0 : row.mcp[key];
    if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid MCP ${key}`);
  }
  if ((row.mcp?.inspectSuccesses ?? 0) > (row.mcp?.inspectAttempts ?? 0))
    throw new Error('MCP successes exceed attempts.');
  const matched = ['matchedInspectAttempts', 'matchedInspectSuccesses'].filter(
    (key) => row.mcp?.[key] !== undefined,
  );
  if (matched.length === 1)
    throw new Error('Matched MCP attempts and successes must be supplied together.');
  if (
    matched.length &&
    (row.mcp.matchedInspectAttempts > (row.mcp.inspectAttempts ?? 0) ||
      row.mcp.matchedInspectSuccesses > (row.mcp.inspectSuccesses ?? 0) ||
      row.mcp.matchedInspectSuccesses > row.mcp.matchedInspectAttempts)
  )
    throw new Error('Matched MCP counts exceed raw calls or matched attempts.');
  if (row.arm === 'agent' && (row.mcp?.inspectAttempts ?? 0) !== 0)
    throw new Error('Control arm unexpectedly called Fuse.');
  if (row.arm === 'fuse' && row.status === 'complete' && !(inspectCount(row, 'Attempts') > 0))
    throw new Error('Completed Fuse arm has no actual inspect attempt.');
  for (const [key, value] of Object.entries(row.tokens ?? {}))
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`Invalid token usage ${key} for ${row.caseId}/${row.arm}`);
}
function usage(rows) {
  const known = rows.filter((r) => r.tokens && Object.keys(r.tokens).length);
  const total = {};
  for (const row of known)
    for (const [key, value] of Object.entries(row.tokens)) total[key] = (total[key] || 0) + value;
  const durations = rows.map((r) => r.durationMs);
  return {
    durationMs: {
      total: durations.reduce((a, b) => a + b, 0),
      median: quantile(durations, 0.5),
      p90: quantile(durations, 0.9),
      max: durations.length ? Math.max(...durations) : null,
    },
    tokens: { knownRecords: known.length, totalRecords: rows.length, totals: total },
    costUsd: null,
    costNote:
      'No dollar estimate: token counts are observed; account charges/pricing were not measured.',
  };
}
function armReport(cases, rows, arm) {
  const selected = rows.filter((r) => r.arm === arm);
  const map = new Map(selected.map((r) => [r.caseId, r]));
  const valid = cases.filter((c) => determinate(map.get(c.id)));
  const successful = valid.filter((c) => inspectCount(map.get(c.id), 'Successes') > 0);
  const states = Object.fromEntries(
    STATUSES.map((s) => [s, selected.filter((r) => r.status === s).length]),
  );
  const byType = {};
  for (const type of [...new Set(cases.map((c) => c.type))]) {
    const all = cases.filter((c) => c.type === type);
    const completed = all.filter((c) => determinate(map.get(c.id)));
    byType[type] = {
      total: all.length,
      determinate: completed.length,
      validOnly: confusion(completed, map),
      officialCompatibility: confusion(all, map),
    };
  }
  const unresolved = selected.filter((r) => !determinate(r));
  return {
    caseCount: cases.length,
    states,
    abstentions: selected.filter(
      (r) => r.status === 'complete' && r.assessment === 'insufficient-evidence',
    ).length,
    determinateCount: valid.length,
    determinateCoverage: ratio(valid.length, cases.length),
    unresolved: unresolved.map((r) => ({
      caseId: r.caseId,
      status: r.status,
      assessment: r.assessment ?? null,
    })),
    validOnly: { coverage: ratio(valid.length, cases.length), ...confusion(valid, map) },
    officialCompatibility: {
      policy:
        'Upstream-style compatibility only: errors, timeouts, protocol errors and abstentions are predicted no-conflict. These are unresolved, not safe outcomes.',
      ...confusion(cases, map),
    },
    byType,
    mcp: {
      countPolicy:
        'Use exact-repo/ref matched counts when supplied; retain raw call totals separately.',
      inspectAttempts: selected.reduce((n, r) => n + inspectCount(r, 'Attempts'), 0),
      inspectSuccesses: selected.reduce((n, r) => n + inspectCount(r, 'Successes'), 0),
      rawInspectAttempts: selected.reduce((n, r) => n + (r.mcp?.inspectAttempts ?? 0), 0),
      rawInspectSuccesses: selected.reduce((n, r) => n + (r.mcp?.inspectSuccesses ?? 0), 0),
      failedInspectCases: selected
        .filter((r) => inspectCount(r, 'Attempts') > inspectCount(r, 'Successes'))
        .map((r) => r.caseId),
      unsupportedCases: selected
        .filter((r) => {
          const value = r.mcp?.unsupported ?? r.unsupported;
          return Array.isArray(value) ? value.length > 0 : Boolean(value);
        })
        .map((r) => r.caseId),
      successfulAssistanceSubset:
        arm === 'fuse'
          ? {
              coverage: ratio(successful.length, cases.length),
              ...confusion(successful, map),
            }
          : null,
    },
    ...usage(selected),
  };
}

/** Every expected arm/case must be present, including failed and unresolved runs. */
export function scoreRuns(cases, rows) {
  const ids = new Set(cases.map((c) => c.id));
  if (ids.size !== cases.length || !cases.length)
    throw new Error('Cases must be nonempty and unique.');
  const seen = new Set();
  for (const row of rows) {
    if (!ids.has(row.caseId)) throw new Error(`Unknown result case: ${row.caseId}`);
    validateRecord(row);
    const key = `${row.caseId}/${row.arm}`;
    if (seen.has(key)) throw new Error(`Duplicate run: ${key}`);
    seen.add(key);
  }
  for (const id of ids)
    for (const arm of ARMS)
      if (!seen.has(`${id}/${arm}`)) throw new Error(`Missing paired run: ${id}/${arm}`);
  const reports = Object.fromEntries(ARMS.map((arm) => [arm, armReport(cases, rows, arm)]));
  const maps = Object.fromEntries(
    ARMS.map((arm) => [arm, new Map(rows.filter((r) => r.arm === arm).map((r) => [r.caseId, r]))]),
  );
  const pairedCases = cases.filter((c) => ARMS.every((arm) => determinate(maps[arm].get(c.id))));
  const correct = (c, arm) =>
    (maps[arm].get(c.id).assessment === 'conflict') === (c.label === 'conflict');
  const wins = pairedCases
    .filter((c) => correct(c, 'fuse') && !correct(c, 'agent'))
    .map((c) => c.id);
  const losses = pairedCases
    .filter((c) => correct(c, 'agent') && !correct(c, 'fuse'))
    .map((c) => c.id);
  return {
    schemaVersion: 1,
    study:
      'One paired source-only detection run per case; no target tests executed by the agent and no repair evaluation.',
    expectedCases: cases.length,
    expectedRuns: cases.length * 2,
    observedRuns: rows.length,
    arms: reports,
    paired: {
      bothDeterminate: pairedCases.length,
      totalCases: cases.length,
      coverage: ratio(pairedCases.length, cases.length),
      fuseOnlyCorrect: wins,
      agentOnlyCorrect: losses,
      accuracyDeltaOnBothDeterminate: ratio(wins.length - losses.length, pairedCases.length),
      officialCompatibilityAccuracyDelta:
        reports.fuse.officialCompatibility.accuracy - reports.agent.officialCompatibility.accuracy,
    },
    limitations: [
      'Authored cases from one repository; one run per arm does not establish production reliability or statistical significance.',
      'Binary benchmark labels do not assess whether an explanation identified the right causal interaction; review explanations separately.',
      'Intent conflicts include coordination/duplication judgments rather than necessarily failing behavior.',
      'Source-only agent study is not directly comparable to the upstream merge-check-plus-LLM pipeline.',
      'Successful-assistance and valid-only subsets must be read with their all-case denominators and coverage.',
    ],
  };
}

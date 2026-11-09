import type { Review, Snapshot } from '../shared/review';

/** Keep exact source once in file.input; stored reviews and other interfaces stay complete. */
export function compactReview(review: Review) {
  const inputs = new Map(review.files.map((file) => [file.path, file.input]));
  const snapshot = (source: Snapshot, side: 'agentA' | 'agentB') => ({
    ...source,
    files: Object.fromEntries(
      Object.entries(source.files).map(([path, file]) => {
        const { code, ...metadata } = file;
        return [path, inputs.get(path)?.[side] === code ? metadata : file];
      }),
    ),
  });
  return {
    ...review,
    detail: 'compact' as const,
    sources: { a: snapshot(review.sources.a, 'agentA'), b: snapshot(review.sources.b, 'agentB') },
    files: review.files.map((file) => ({
      ...file,
      evidence: file.evidence.map(({ code: _code, ...evidence }) => evidence),
      analysis: {
        ...file.analysis,
        conflicts: file.analysis.conflicts.map(
          ({ base: _base, a: _a, b: _b, ...conflict }) => conflict,
        ),
      },
    })),
  };
}

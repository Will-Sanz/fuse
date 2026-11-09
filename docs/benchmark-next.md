# Benchmark follow-through protocol

The original RealWorld baseline remains unchanged. Its official overlap-policy
misses (`rw-014`, `rw-028`, `rw-034`) remain misses: orphan-tag deletion plus a
used-tag filter, repeated idempotent email normalization, and two favorites APIs
can compose safely while duplicating an authored goal. These are coordination
warnings, not evidence of a merged runtime fault. A useful product should describe
that distinction and leave the desired behavior to the developer. We do not
change the labels or add case-specific prompt rules to improve the score.

## Broader support probes: preregistered before model runs

Eight **authored, adapted** branch interactions use two complete pinned upstream
repositories. They are not historical production conflicts and were selected
by the implementer. They test source-only reasoning and Fuse's unsupported-file
behavior on additional languages and architectures; they do not establish broad
production reliability.

| Target                                                                                        | Exact original commit                      | Architecture                                       | License      |
| --------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------- | ------------ |
| [Click 8.1.7](https://github.com/pallets/click/tree/874ca2bc1c30d93a4ac6e36a15ed685eafe89097) | `874ca2bc1c30d93a4ac6e36a15ed685eafe89097` | Python package / multi-module command-line toolkit | BSD-3-Clause |
| [ms 2.1.3](https://github.com/vercel/ms/tree/1c6264b795492e8fdecbc82cb8802fcfbfc08d26)        | `1c6264b795492e8fdecbc82cb8802fcfbfc08d26` | JavaScript CommonJS duration utility               | MIT          |

Each group has the same side-A public-behavior-preserving refactor and two
side-B versions of a new feature. A private implementation dependency breaks in
the positive; the public API keeps the negative compatible. Both have the same
task and commit-message wording. All merges are textually clean.

| Cases           | Side A                                                            | Side B                                                                | Executed positive failure   |
| --------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------- |
| bx-001 / bx-002 | Rename the private DateTime parser                                | ISO date helper using private parser / public conversion              | AttributeError              |
| bx-003 / bx-004 | Rename internal string conversion and existing callers            | Filename labels using old internal import / public filename formatter | ImportError                 |
| bx-005 / bx-006 | Internal parse result becomes an object; public API stays numeric | Seconds helper using private parse / public conversion                | NaN fails numeric assertion |
| bx-007 / bx-008 | Rename long formatter and existing callers                        | Verbose helper using old private name / public formatter              | ReferenceError              |

Odd cases are runtime positives; even cases are compatible twins. Labels, group
names, positive/negative refs, and oracle code stay in the controller. The actors
receive only independent opaque stores with exactly reconstructed base/A/B
commits, generic refs, unchanged full application trees, neutral messages, and
side A's task. Upstream tests/docs/license are legitimate source available to
both arms; the new controller oracles are never copied into actor stores.

The builder first executes the original public-behavior assertion on base and A,
both assertions on B, then public behavior and the new feature separately on the
clean merged tree. Base/A/B and merged public behavior must pass. The new merged
feature must fail with its intended error only on the four positives, and pass
on the four negatives. This is a bounded executable oracle, not exhaustive proof.

The committed `scripts/benchmark/adapted-lock.json` pins all original and authored
commits/trees. Fixed identities and timestamps make it reproducible. The loader
checks upstream metadata, ancestry and every actual tree. The frozen run manifest
includes the exact lock hash. Production parsing/application safeguards are not
relaxed for Python or JavaScript; unavailable engine support must remain visible.

The planned comparison uses two fresh epochs of all eight pairs, both arms in
each epoch (32 arm attempts), same actual agent and production MCP, explicit
`gpt-6-astra` / `high`, 180-second configured watchdog and at most four pair
workers. Freeze the product and harness before running either epoch. Counterbalance
arm order with a recorded seed; use a fresh output directory for each epoch.
All failures/abstentions and unknown usage remain. No retries overwrite an epoch.
Report each epoch separately, plus a clearly identified repeated-probe aggregate;
do not pool these authored cases into the RealWorld headline score. With eight
simple cases and two repeats, ceiling effects and correlated twins are expected.
No pricing or account charges are inferred from token counts.

## Reproduce the adapted dataset

Use Node 24, Python 3 and Git. Building runs only the fixed checked-in oracle
snippets against downloaded pinned code in disposable directories; inspect them
before using a different upstream. Never provide untrusted alternative source.
The model does not execute target code.

```sh
git clone --depth 1 --branch 8.1.7 https://github.com/pallets/click /tmp/fuse-click-upstream
git clone --depth 1 --branch 2.1.3 https://github.com/vercel/ms /tmp/fuse-ms-upstream
node scripts/benchmark/adapted.mjs --click /tmp/fuse-click-upstream --ms /tmp/fuse-ms-upstream --out /tmp/fuse-adapted-source
cmp scripts/benchmark/adapted-lock.json /tmp/fuse-adapted-source/dataset-lock.json
npm run benchmark:run -- --upstream /tmp/fuse-adapted-source --dataset scripts/benchmark/adapted-lock.json --out /tmp/fuse-adapted-epoch1 --concurrency 4 --seed fuse-adapted-epoch1
npm run benchmark:run -- --upstream /tmp/fuse-adapted-source --dataset scripts/benchmark/adapted-lock.json --out /tmp/fuse-adapted-epoch2 --concurrency 4 --seed fuse-adapted-epoch2
```

The original `benchmark:run --upstream ...` interface still selects the pinned
53-case RealWorld dataset. Its source-only controls and scorer are reused intact.
Before real runs, copy the committed product/harness to an immutable checkout;
editing the same checkout while an experiment runs invalidates its evidence.

## Dataset validation completed before model runs

The builder validated all eight cases with actual Python/Node execution. The
independent reviewer also reconstructed all eight actor stores and checked exact
trees, only three commits, generic refs, no remotes, and no oracle/case-label
leakage. See [oracle evidence](evidence/adapted-baseline/oracle-results.json).

As a separate regression check, all 22 distinct base/A/B/merged trees ran their
existing upstream suite. Click: 588 passed, 22 skipped and 1 expected failure on
each of its 11 trees. ms: 49 passed on each of its 11 trees. These upstream tests
do not cover the authored new helpers; the separate controller oracle supplies
that check. Temporary test-only dependencies were pytest 8.3.5 (Python 3.13.0),
Mocha 4.0.1 and expect.js 0.3.1 (Node 24.3.0); no product dependency was added.
The pytest version differs from upstream's original 7.4.0 lock. One initial run
used the wrong working directory and failed a glob fixture; all reported runs use
the target root. Full normalized logs are in
[upstream suite evidence](evidence/adapted-baseline/upstream-suites.json).

## Completion gates

Preserve the original baseline; compare a targeted evidence-payload improvement
under the same frozen repeated protocol; publish all observed outcomes, overhead,
unsupported evidence and limits. Merge reviewed code only after its required
checks pass. Validate the inline workflow in the actual permitted Codex host
separately; browser-host simulation or a CLI transcript cannot establish native
rendering. Demo production remains deferred.

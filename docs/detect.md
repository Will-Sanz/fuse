# Conflict detection

`fuse detect` checks whether two branches conflict, including conflicts that git and
the tests do not catch: the branches merge cleanly and pass, but the merged code
behaves wrongly, or both solve the same problem twice.

It is separate from `fuse inspect`: it does not create a review and is not yet
connected to the review or proposal flow.

## How it works

Two stages; the first that finds a conflict is the answer.

1. **merge-check** (`detect/merge-check.mjs`, no API call): merges B into A in its own
   Git worktree, then runs the repository's typecheck and tests on the result. A merge
   conflict is `textual`, a typecheck failure `build`, a test failure `test`. Tests
   that time out or never start are an error, not a conflict.
2. **LLM** (`detect/llm.mjs`, Claude Sonnet 5.5): reads both diffs, a ts-morph graph of
   how the changed declarations connect (`detect/graph.mjs`), both sides' commit
   messages and the task. It answers `runtime` or `intent`, or no conflict. Messages
   are hints; the prompt says to trust the code.

The working copy is never changed. merge-check keeps one reusable worktree per
repository under the system temp directory.

## Run it

```sh
fuse detect --repo /path/to/project --a feature/one --b feature/two --target detect.json
```

- `--base REF`: default is the merge base of the two.
- `--task TEXT`: what side A is meant to do.
- `--target FILE`: the repository's commands (below). Without it the pair is only
  merged, and the LLM is told nothing was built or tested.
- `--no-llm`: merge-check only.
- `--skip-merge-check`: when CI already merged, built and tested the pair.
- `--summary FILE`: also write the answer as Markdown.

It prints one JSON object. Exit code 0 means no conflict, 1 a conflict, 2 the check
failed to run. The LLM stage needs `ANTHROPIC_API_KEY` in the environment or in the
Fuse installation's `.env`; a check that reaches it costs about $0.04, up to about
$0.08 for very large diffs.

Target file:

```json
{
  "setup": [{ "run": "npm ci", "inputs": ["package-lock.json"] }],
  "keep_between_checkouts": ["node_modules"],
  "typecheck": "npx tsc --noEmit",
  "test": "npx jest --json --outputFile={report}",
  "test_report": "jest-json",
  "timeout_seconds": 300
}
```

A setup step reruns only when its `inputs` change. `test_report: "jest-json"` lets
merge-check tell failing tests from tests that never ran.

## On pull requests

`.github/workflows/conflict-check.yml` is a reusable workflow. It checks a pull request
against the branch it merges into, comments the answer and fails on a conflict. In the
repository to check, add its `ANTHROPIC_API_KEY` secret and a workflow like:

```yaml
name: Conflict check
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  check:
    uses: Will-Sanz/fuse/.github/workflows/conflict-check.yml@main
    with:
      target: detect.json
      prepare: docker compose up -d --wait db-test
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Test it on the eval cases

The [eval repository](https://github.com/elizedrac/realworld-express-prisma) holds 53
labelled cases, each a pair of branches. `scripts/mock-push.mjs` runs the check on a
case as if side A had just been pushed against side B, and compares the answer with
the label. Nothing is pushed. It needs that repository's test database running, and
Node.js 22 on the PATH: the repository's own tests fail on newer versions, which shows
up as false `test` conflicts.

```sh
node scripts/mock-push.mjs --repo ../realworld-express-prisma --case rw-042 --case rw-043
node scripts/mock-push.mjs --repo ../realworld-express-prisma --all --no-llm   # no API call
```

`tests/detect.test.ts` covers merge-check and the command's output without the LLM.

## Limits

- The graph reads TypeScript under `src/`, so other layouts get the diffs without it.
- Each diff is capped at 150,000 characters; lower-priority files (lockfiles, docs,
  seed data) and files unrelated to the other side are cut first.
- A pull request is checked against its target branch only, not other open pull
  requests.
- Measured on one repository with cases written to test specific weaknesses.

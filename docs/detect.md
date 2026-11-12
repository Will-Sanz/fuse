# Conflict detection

You work locally with your AI coding agent. When a teammate pushes, Fuse checks their
push against your current local code and tells your agent if the two conflict,
including conflicts git and tests miss: the code merges and passes, but behaves wrongly.

## How it works

Each check runs only if the one before it found nothing.

1. **A teammate pushes** to `main` or any other branch.
2. **Your agent's next turn:** a hook runs `fuse incoming`, which runs `git fetch` and
   finds branches with commits you do not have. It works in the background, so your
   prompt is never delayed.
3. **Snapshot your local code,** uncommitted work included, without touching your
   files. That is side A. The teammate's push is side B.
4. **Git check** (instant, free): try the merge. A git conflict is reported as `textual`.
5. **Build and test check** (free): typecheck and test the merged code. A failure is
   reported as `build` or `test`.
6. **AI check** (about 4 s, about 4 cents): Claude reads both changes, a graph of how
   the changed code connects, and what each side meant to do. It reports `runtime`
   (the merged code behaves wrongly) or `intent` (both sides solve the same problem).
7. **Tell the agent:** on the turn after the check finishes, the agent gets a message:
   whose push, what breaks and why.

## Set it up

1. Put `ANTHROPIC_API_KEY` in the Fuse installation's `.env` (or the environment).
2. Add `.fuse/detect.json` to the repository being watched, with its commands:

   ```json
   {
     "setup": [{ "run": "npm ci", "inputs": ["package-lock.json"] }],
     "keep_between_checkouts": ["node_modules"],
     "typecheck": "npx tsc --noEmit",
     "test": "npx jest --json --outputFile={report}",
     "test_report": "jest-json"
   }
   ```

   Without this file step 5 is skipped and the AI is told nothing was built or tested.

3. Add the hook to that repository's `.claude/settings.json`:

   ```json
   {
     "hooks": {
       "UserPromptSubmit": [
         {
           "hooks": [
             { "type": "command", "command": "node /path/to/fuse/detect/incoming.mjs --hook" }
           ]
         }
       ]
     }
   }
   ```

## Limits

- **At most once per 15 minutes** (`--interval MINUTES`). Conflicts already found are
  still reported on your next message.
- **At most 5 new pushes per run** (`--max N`), newest first.
- **The first run checks nothing.** It records the remote as it is and watches for
  pushes after that.
- A push is checked once. What was seen and found is kept in `.git/fuse/incoming.json`.

## On and off

```sh
fuse incoming off      # pause: no fetch, no checks, no cost
fuse incoming on       # watch again, from now
fuse incoming status   # on or off, last run, latest results
fuse incoming          # check now and print the result
```

## Check two branches by hand

```sh
fuse detect --a feature/one --b feature/two --target .fuse/detect.json
```

Prints one JSON object. Exit code 0 means no conflict, 1 a conflict, 2 the check failed
to run. `--no-llm` stops after step 5.

## Tests

- `tests/incoming.test.ts` and `tests/detect.test.ts`: a fake teammate repository, no
  API key.
- `scripts/mock-push.mjs`: runs the check on the 53 labelled cases in the
  [eval repository](https://github.com/elizedrac/realworld-express-prisma), as if side
  B had just been pushed. It needs that repository's test database and Node.js 22.

  ```sh
  node scripts/mock-push.mjs --repo ../realworld-express-prisma --case rw-042 --case rw-043
  ```

## Not in v1

- A detected conflict is a message to the agent. It does not open a Fuse review yet.
- Claude Code only. It runs when you send your agent a message.
- The code graph reads TypeScript under `src/`.

# Contributing to Fuse

## One-time setup

Accept your repository invitation. Then clone `https://github.com/Will-Sanz/fuse` using GitHub Desktop or the command in the README. Everyone works in their own local copy of the same repository.

For command-line Git, configure your name and email before committing. Use an email verified with GitHub or your GitHub-provided no-reply email.

## Development checks

Use Node.js 24 and `npm ci`. Run `npm run dev` for the app. Before pushing, run `npm run format`, `npm run check`, and `npm run test:e2e` for UI or workflow changes. Install the test browser once with `npx playwright install chromium`.

Engine changes belong in `server/engine.ts` with behavioral tests in `tests/engine.test.ts`. API changes belong in `server/` with API tests. Interface work belongs in `src/`. Keep `shared/types.ts` consistent at both ends. Add credentials only to your ignored `.env` file.

## For each task

1. Pick or create a GitHub issue and agree on who owns the work.
2. Start from the latest `main`, with your previous work committed:

   ```sh
   git switch main
   git pull --ff-only
   git switch -c your-name/short-task-description
   ```

3. Make the change and check that it works. Review the files you are committing:

   ```sh
   git status
   git diff
   git add path/to/changed-file
   git diff --staged
   git commit -m "Describe what changed"
   git push -u origin HEAD
   ```

   Replace the example branch name, file path, and commit message with your own.

4. Open a pull request into `main`. Explain the change and how you checked it; use `Closes #123` when it completes an issue.
5. Ask a teammate to review, address feedback, then squash and merge. Delete the finished branch on GitHub.

You can also perform this workflow in GitHub Desktop: fetch/pull `main`, create a branch, commit, publish the branch, and open a pull request.

## Team agreements

- Use pull requests for changes to `main`, with at least one teammate's review. This is a team convention unless branch protection is configured.
- Keep unrelated changes in separate pull requests.
- Coordinate before editing the same files. If Git reports a conflict, compare both changes and preserve the intended behavior.
- Add meaningful tests when appropriate and update setup instructions when dependencies change.
- Commit an `.env.example` containing placeholder values when configuration is introduced. Never commit passwords, tokens, or real environment files.

Reference: [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow).

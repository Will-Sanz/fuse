import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { InputError } from '../server/engine';
import {
  applyReview,
  configureCheck,
  decide,
  inspect,
  linkCommit,
  markMerged,
  preview,
  registerSession,
  removeSession,
  setIntent,
  watchOnce,
} from '../server/local';
import { LocalStore } from '../server/local-store';
import { createDemo } from '../server/demo';
import type { Review } from '../shared/review';
import { shellQuote } from '../shared/shell';

export const help = `Fuse — understand and reconcile local TypeScript changes

fuse inspect [--repo PATH] [--base REF] [--a REF --b REF | --sessions] [--json]
fuse session add ID --name NAME --worktree PATH [--repo PATH]
fuse session list | remove ID [--repo PATH]
fuse watch --repo PATH [--once] [--interval 1500] [--json]
fuse review ID [--repo PATH] [--json]
fuse review ID --serve [--port 3001] [--open] [--repo PATH]
fuse intent ID --first a|b --note TEXT [--repo PATH]
fuse decide ID --file PATH --conflict ID --choice a|b|both|reviewed [--order a-first|b-first] --note TEXT
fuse preview ID [--repo PATH] [--json]
fuse apply ID --approve PREVIEW_TOKEN [--repo PATH] [--json]
fuse check add NAME --command EXECUTABLE [--arg VALUE ...] [--timeout 10000]
fuse check list [--repo PATH]
fuse history [--repo PATH] [--json]
fuse link ID --commit REF [--repo PATH]
fuse merged ID --into REF [--repo PATH]
fuse demo --dir NEW_DIRECTORY [--single] [--json]
fuse demo --dir NEW_DIRECTORY --merge [--scenario checkout|shipping] [--json]
fuse visualize ID [--regenerate] [--repo PATH] [--json]
fuse mcp --repo PATH

Use --revision N on mutations to reject stale tool/browser state. Apply always requires
the current preview token. Checks run only after explicit configuration and approval.
Exit codes: 0 success/quiet, 1 invalid input, 2 review attention, 3 stale/dirty,
4 configured checks failed. --json emits one versioned JSON object (watch: JSONL).
`;
export function describe(review: Review) {
  const lines = [
    `Fuse · ${review.title}`,
    `Review ${review.id} · ${review.status}`,
    `Base ${review.baseCommit.slice(0, 12)} · ${review.repository}`,
  ];
  for (const [key, source] of Object.entries(review.sources))
    lines.push(
      `${key.toUpperCase()}: ${source.ref.label}${source.ref.sessionId ? ` [registered ${source.ref.sessionId}]` : ' [no agent attribution]'} · ${source.head.slice(0, 12)}`,
    );
  for (const file of review.files) {
    lines.push(`\n${file.path}`);
    for (const e of file.evidence.filter((e) => e.revision !== 'base'))
      lines.push(
        `  ${e.revision.toUpperCase()} ${e.function} · ${e.file}:${e.line}: ${e.observations.join(' ')}`,
      );
    for (const c of file.analysis.conflicts)
      lines.push(
        `  ${c.kind === 'overlap' ? 'SHARED EDIT' : c.kind === 'dependency' ? 'POSSIBLE INTERACTION' : 'WHOLE-FILE REVIEW'}: ${c.title}. ${c.explanation}`,
      );
    for (const rec of file.recommendations)
      lines.push(
        `  ${rec.action ? 'Recommendation' : 'Review'}: ${rec.reason}${rec.question ? `\n  Question: ${rec.question}` : ''}`,
      );
  }
  if (!review.files.length && !review.unsupported.length)
    lines.push('No changes from the selected base.');
  if (review.files.length && !review.files.some((f) => f.analysis.conflicts.length))
    lines.push(
      'No differing overlap detected. Review the source-linked changes and run configured checks.',
    );
  for (const f of review.unsupported) lines.push(`MANUAL REVIEW ${f.path}: ${f.reason}`);
  for (const c of review.checks) lines.push(`Check ${c.name}: ${c.status} (exit ${c.exitCode})`);
  if (review.preview)
    lines.push(
      `Preview token: ${review.preview.token}`,
      `Approve: fuse apply ${review.id} --repo ${shellQuote(review.repository)} --approve ${review.preview.token}`,
    );
  if (review.commit) lines.push(`Commit ${review.commit}`);
  lines.push(
    `Visual review: fuse review ${review.id} --repo ${shellQuote(review.repository)} --serve --open`,
  );
  return lines.join('\n');
}
export const attention = (r: Review) =>
  r.unsupported.length > 0 ||
  r.files.some((f) => f.analysis.conflicts.some((c) => !f.decisions[c.id]));
export async function main(args = process.argv.slice(2)) {
  const { values: v, positionals: p } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      repo: { type: 'string', default: process.cwd() },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      base: { type: 'string' },
      a: { type: 'string' },
      b: { type: 'string' },
      sessions: { type: 'boolean' },
      name: { type: 'string' },
      worktree: { type: 'string' },
      once: { type: 'boolean' },
      interval: { type: 'string' },
      file: { type: 'string' },
      conflict: { type: 'string' },
      choice: { type: 'string' },
      order: { type: 'string' },
      note: { type: 'string' },
      first: { type: 'string' },
      approve: { type: 'string' },
      revision: { type: 'string' },
      command: { type: 'string' },
      arg: { type: 'string', multiple: true },
      timeout: { type: 'string' },
      commit: { type: 'string' },
      into: { type: 'string' },
      dir: { type: 'string' },
      single: { type: 'boolean' },
      serve: { type: 'boolean' },
      open: { type: 'boolean' },
      port: { type: 'string' },
      merge: { type: 'boolean' },
      scenario: { type: 'string' },
      regenerate: { type: 'boolean' },
    },
  });
  const required = (name: keyof typeof v) => {
    const value = v[name];
    if (typeof value !== 'string' || !value) throw new InputError(`Missing --${name}.`);
    return value;
  };
  const print = (data: unknown, readable?: string) =>
    console.log(
      v.json
        ? JSON.stringify({ schemaVersion: 1, data })
        : readable || JSON.stringify(data, null, 2),
    );
  const opts = { repo: v.repo!, base: v.base, a: v.a, b: v.b, sessions: v.sessions };
  const review = () => new LocalStore(v.repo!).get(p[1] || '');
  const rev = (r: Review) => {
    const n = v.revision === undefined ? r.revision : Number(v.revision);
    if (!Number.isInteger(n) || n < 0) throw new InputError('Invalid revision.');
    return n;
  };
  let result: Review | undefined;
  if (v.help || !p.length) {
    console.log(help);
    return 0;
  }
  switch (p[0]) {
    case 'visualize': {
      const { generateVisual } = await import('../server/visual-ai');
      result = await generateVisual(v.repo!, p[1] || '', { regenerate: v.regenerate });
      break;
    }
    case 'inspect':
      result = inspect(opts);
      break;
    case 'session':
      if (p[1] === 'add')
        print(registerSession(v.repo!, p[2] || '', required('name'), required('worktree')));
      else if (p[1] === 'list') print(new LocalStore(v.repo!).config().sessions);
      else if (p[1] === 'remove') print(removeSession(v.repo!, p[2] || ''));
      else throw new InputError('Use session add, list, or remove.');
      return 0;
    case 'watch': {
      const interval = Number(v.interval || 1500);
      if (!Number.isFinite(interval) || interval < 100)
        throw new InputError('Watch interval must be at least 100 ms.');
      let stopped = false;
      const stop = () => {
        stopped = true;
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      do {
        const w = watchOnce(opts);
        if (v.json) print(w);
        else if (w.alert)
          console.log(
            `\nFUSE ALERT · New or updated overlap\n${describe(w.review)}\nOpen http://127.0.0.1:${v.port || 3001}/?review=${w.review.id} after starting fuse review --serve.`,
          );
        else if (v.once) console.log('No new overlap alert.');
        if (v.once) return w.alert ? 2 : 0;
        await new Promise((r) => setTimeout(r, interval));
      } while (!stopped);
      return 0;
    }
    case 'review':
      result = review();
      if (v.serve) {
        const { serveReview } = await import('../server/review-server');
        await serveReview(v.repo!, result.id, Number(v.port || 3001), Boolean(v.open));
        return 0;
      }
      break;
    case 'intent': {
      const r = review();
      result = setIntent(v.repo!, r.id, rev(r), {
        first: required('first') as 'a' | 'b',
        rationale: required('note'),
      });
      break;
    }
    case 'decide': {
      const r = review();
      result = decide(v.repo!, r.id, rev(r), required('file'), required('conflict'), {
        choice: required('choice') as 'a',
        order: v.order as 'a-first' | 'b-first' | undefined,
        note: required('note'),
      });
      break;
    }
    case 'preview': {
      const r = review();
      result = preview(v.repo!, r.id, rev(r));
      break;
    }
    case 'apply': {
      const r = review();
      result = applyReview(v.repo!, r.id, rev(r), required('approve'));
      break;
    }
    case 'check':
      if (p[1] === 'list') print(new LocalStore(v.repo!).config().checks);
      else if (p[1] === 'add')
        print(
          configureCheck(v.repo!, {
            name: p[2] || '',
            command: required('command'),
            args: v.arg || [],
            timeoutMs: Number(v.timeout || 10000),
          }),
        );
      else throw new InputError('Use check add or list.');
      return 0;
    case 'history':
      print(
        new LocalStore(v.repo!).list().map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          updatedAt: r.updatedAt,
          commit: r.commit,
          checks: r.checks.map((c) => ({ name: c.name, status: c.status })),
        })),
      );
      return 0;
    case 'link': {
      const r = review();
      result = linkCommit(v.repo!, r.id, rev(r), required('commit'));
      break;
    }
    case 'merged': {
      const r = review();
      result = markMerged(v.repo!, r.id, rev(r), required('into'));
      break;
    }
    case 'demo': {
      if (v.scenario && !['checkout', 'shipping'].includes(v.scenario))
        throw new InputError('Choose checkout or shipping.');
      const d = createDemo(required('dir'), v.single, {
        scenario: v.scenario as 'checkout' | 'shipping' | undefined,
        merge: v.merge,
        presentation: v.merge,
      });
      print(
        d,
        `Scripted Git fixture created at ${d.repo}\n${d.expectation || ''}\n${describe(d.review)}`,
      );
      return 0;
    }
    case 'mcp': {
      const { serveMcp } = await import('../server/mcp');
      await serveMcp(v.repo!);
      return 0;
    }
    default:
      throw new InputError(`Unknown command: ${p[0]}. Run fuse --help.`);
  }
  print(result, describe(result!));
  return result!.checks.some((c) => c.status !== 'passed') ? 4 : attention(result!) ? 2 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      const status = (error as { status?: number }).status;
      const code = status === 409 ? 3 : 1;
      if (process.argv.includes('--json'))
        console.log(
          JSON.stringify({
            schemaVersion: 1,
            error: { message: (error as Error).message, exitCode: code },
          }),
        );
      else console.error(`Fuse: ${(error as Error).message}`);
      process.exitCode = code;
    });
}

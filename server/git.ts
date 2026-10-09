import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { hash, InputError } from './engine';
import type { FileSnapshot, Snapshot, SourceRef } from '../shared/review';

export function git(repo: string, args: string[]) {
  try {
    return execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', repo, ...args], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 15000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
  } catch (error) {
    const e = error as { stderr?: string };
    throw new InputError(`Git: ${(e.stderr || 'Unable to read repository.').trim()}`);
  }
}
export const root = (repo: string) =>
  realpathSync(git(resolve(repo), ['rev-parse', '--show-toplevel']));
export const commonDir = (repo: string) =>
  realpathSync(git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
export function commit(repo: string, ref: string) {
  if (!ref || ref.startsWith('-') || ref.length > 300)
    throw new InputError('Invalid Git revision.');
  return git(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
}
export function safePath(repo: string, path: string) {
  if (
    !path ||
    path.includes('\\') ||
    path.includes('\0') ||
    isAbsolute(path) ||
    path.split('/').some((p) => p === '..' || p === '.git')
  )
    throw new InputError('Unsafe repository path.');
  const full = resolve(repo, path);
  if (relative(repo, full).startsWith(`..${sep}`)) throw new InputError('Path leaves repository.');
  let current = repo;
  for (const part of relative(repo, full).split(sep)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new InputError(`Symlink requires manual review: ${path}`);
  }
  return full;
}
function tree(repo: string, ref: string) {
  const entries = new Map<string, { mode: string; oid: string }>();
  for (const row of git(repo, ['ls-tree', '-rz', ref]).split('\0').filter(Boolean)) {
    const [meta, path] = [row.slice(0, row.indexOf('\t')), row.slice(row.indexOf('\t') + 1)];
    const [mode, , oid] = meta.split(' ');
    entries.set(path, { mode, oid });
  }
  return entries;
}
export function blob(repo: string, revision: string, path: string): FileSnapshot {
  const entry = tree(repo, revision).get(path);
  if (!entry) return { code: null, hash: hash('<absent>'), mode: 'absent' };
  if (!['100644', '100755'].includes(entry.mode))
    return {
      code: null,
      hash: entry.oid,
      mode: entry.mode,
      unsupported: 'Symlinks and submodules require manual review.',
    };
  const size = Number(git(repo, ['cat-file', '-s', entry.oid]));
  if (size > 100000)
    return {
      code: null,
      hash: entry.oid,
      mode: entry.mode,
      unsupported: 'File exceeds the 100 KB analysis limit.',
    };
  const data = execFileSync('git', ['-C', repo, 'cat-file', 'blob', entry.oid], {
    maxBuffer: 1024 * 1024,
    timeout: 15000,
  });
  return fromBuffer(data, entry.mode);
}
function fromBuffer(data: Buffer, mode: string): FileSnapshot {
  const code = data.toString('utf8');
  const unsupported =
    data.length > 100000
      ? 'File exceeds the 100 KB analysis limit.'
      : data.includes(0) || !Buffer.from(code).equals(data)
        ? 'Binary or non-UTF-8 file requires manual review.'
        : undefined;
  return {
    code: unsupported ? null : code,
    hash: hash(data.toString('base64')),
    mode,
    ...(unsupported ? { unsupported } : {}),
  };
}
export function snapshot(repo: string, base: string, ref: SourceRef): Snapshot {
  const worktree = ref.kind === 'worktree' ? root(ref.value) : repo;
  if (commonDir(worktree) !== commonDir(repo))
    throw new InputError('Session must use a worktree of this repository.');
  const head = commit(worktree, ref.kind === 'worktree' ? 'HEAD' : ref.value);
  const before = tree(repo, base),
    after = tree(repo, head);
  const paths = new Set(
    [...before.keys(), ...after.keys()].filter(
      (path) => JSON.stringify(before.get(path)) !== JSON.stringify(after.get(path)),
    ),
  );
  let status = '';
  if (ref.kind === 'worktree') {
    for (const path of git(worktree, ['diff', '--name-only', '-z', base, '--'])
      .split('\0')
      .filter(Boolean))
      paths.add(path);
    for (const path of git(worktree, ['ls-files', '--others', '--exclude-standard', '-z'])
      .split('\0')
      .filter(Boolean))
      paths.add(path);
    status = git(worktree, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  }
  if (paths.size > 80)
    throw new InputError(
      'Review at most 80 changed files at a time. Commit or split the change first.',
    );
  const files: Record<string, FileSnapshot> = {};
  for (const path of [...paths].sort()) {
    if (ref.kind === 'revision') files[path] = blob(repo, head, path);
    else {
      try {
        const full = safePath(worktree, path);
        if (!existsSync(full)) files[path] = { code: null, hash: hash('<absent>'), mode: 'absent' };
        else {
          const stat = lstatSync(full);
          if (!stat.isFile())
            files[path] = {
              code: null,
              hash: 'non-file',
              mode: 'unsupported',
              unsupported: 'Non-regular file requires manual review.',
            };
          else if (stat.size > 100000)
            files[path] = {
              code: null,
              hash: hash(`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`),
              mode: 'unsupported',
              unsupported: 'File exceeds the 100 KB analysis limit.',
            };
          else
            files[path] = fromBuffer(readFileSync(full), stat.mode & 0o111 ? '100755' : '100644');
        }
      } catch (error) {
        if (!(error instanceof InputError)) throw error;
        files[path] = {
          code: null,
          hash: 'symlink',
          mode: 'unsupported',
          unsupported: error.message,
        };
      }
    }
  }
  return {
    ref: { ...ref, value: ref.kind === 'revision' ? head : worktree },
    head,
    files,
    fingerprint: hash(JSON.stringify({ head, status, files })),
  };
}
export const isClean = (repo: string) =>
  !git(repo, ['status', '--porcelain=v1', '--untracked-files=all']);
export function worktrees(repo: string) {
  return git(repo, ['worktree', 'list', '--porcelain', '-z'])
    .split('\0')
    .filter((x) => x.startsWith('worktree '))
    .map((x) => realpathSync(x.slice(9)));
}

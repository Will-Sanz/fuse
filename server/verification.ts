import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { git, safePath } from './git';
import { hash, InputError } from './engine';
import type { CheckCommand, CheckResult, Review } from '../shared/review';

export function verificationImage(image?: string) {
  if (!image || !/^sha256:[a-f0-9]{64}$/.test(image))
    throw new InputError(
      'Configure a prepared verification image by immutable sha256 image ID. No host fallback is available.',
    );
  const result = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', image], {
    encoding: 'utf8',
    timeout: 10000,
  });
  if (result.status !== 0 || result.stdout.trim() !== image)
    throw new InputError(
      'Docker or the configured verification image is unavailable. Prepare the image first.',
    );
  return image;
}

export function pinnedProject(r: Review) {
  const files: Record<string, Buffer> = {};
  let size = 0;
  const entries = git(r.repository, ['ls-tree', '-rz', r.baseCommit]).split('\0').filter(Boolean);
  if (entries.length > 2000)
    throw new InputError('Verification supports at most 2000 pinned files.');
  for (const entry of entries) {
    const tab = entry.indexOf('\t'),
      path = entry.slice(tab + 1);
    const [mode, , oid] = entry.slice(0, tab).split(' ');
    safePath(r.repository, path);
    if (
      !['100644', '100755'].includes(mode) ||
      path.split('/').some((p) => ['.git', 'node_modules'].includes(p))
    )
      throw new InputError(`Unsupported verification project entry: ${path}`);
    if (/(^|\/)(\.env(?:\..*)?|.*\.(pem|key))$/i.test(path))
      throw new InputError('Remove tracked credentials from the verification project.');
    size += Number(git(r.repository, ['cat-file', '-s', oid]));
    if (size > 8 * 1024 * 1024) throw new InputError('Pinned verification project exceeds 8 MB.');
    files[path] = execFileSync('git', ['-C', r.repository, 'cat-file', 'blob', oid], {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 10000,
    });
  }
  return files;
}
export const projectHash = (files: Record<string, Buffer>) =>
  hash(JSON.stringify(Object.entries(files).map(([p, b]) => [p, hash(b.toString('base64'))])));

/** No project process runs on the host. Every check gets a new bounded container. */
export async function runIsolated(
  files: Record<string, Buffer>,
  path: string,
  source: string,
  checks: CheckCommand[],
  image: string,
  signal?: AbortSignal,
): Promise<CheckResult[]> {
  const directory = mkdtempSync(join(tmpdir(), 'fuse-verification-'));
  const material = { ...files, [path]: Buffer.from(source) };
  const expected = projectHash(material);
  try {
    chmodSync(directory, 0o755);
    for (const [name, data] of Object.entries(material)) {
      const full = safePath(directory, name);
      mkdirSync(dirname(full), { recursive: true, mode: 0o755 });
      writeFileSync(full, data, { mode: 0o444 });
    }
    const results: CheckResult[] = [];
    for (const check of checks) {
      if (signal?.aborted) throw new InputError('Verification cancelled.');
      const name = `fuse-check-${randomUUID()}`;
      const started = Date.now();
      let stdout = '',
        stderr = '',
        receivedBytes = 0,
        stopped = false;
      const args = [
        'run',
        '--rm',
        '--pull=never',
        '--name',
        name,
        '--network=none',
        '--read-only',
        '--user=65534:65534',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--pids-limit=64',
        '--memory=256m',
        '--memory-swap=256m',
        '--cpus=1',
        '--ulimit',
        'nofile=256:256',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=32m',
        '--mount',
        `type=bind,src=${directory},dst=/project,readonly`,
        '--workdir=/project',
        '--env',
        'HOME=/tmp',
        '--env',
        'NODE_ENV=test',
        '--entrypoint',
        '/usr/bin/timeout',
        image,
        '--signal=KILL',
        `${Math.ceil(check.timeoutMs / 1000)}s`,
        check.command,
        ...check.args,
      ];
      let exitCode: number | null = null;
      try {
        exitCode = await new Promise<number | null>((accept, reject) => {
          const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
          const stop = () => {
            stopped = true;
            child.kill('SIGKILL');
          };
          const timer = setTimeout(stop, check.timeoutMs);
          signal?.addEventListener('abort', stop, { once: true });
          const append = (part: 'stdout' | 'stderr', data: Buffer) => {
            receivedBytes += data.byteLength;
            if (part === 'stdout') stdout += data.toString();
            else stderr += data.toString();
            if (receivedBytes > 128000) stop();
            stdout = stdout.slice(0, 64000);
            stderr = stderr.slice(0, 64000);
          };
          child.stdout.on('data', (d) => append('stdout', d));
          child.stderr.on('data', (d) => append('stderr', d));
          child.once('error', reject);
          child.once('close', (code) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', stop);
            accept(code);
          });
        });
      } finally {
        // Also removes a container if the client timed out or disconnected after creation.
        spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 10000 });
      }
      if (signal?.aborted) throw new InputError('Verification cancelled.');
      if (
        projectHash(
          Object.fromEntries(
            Object.keys(material).map((p) => [p, readFileSync(safePath(directory, p))]),
          ),
        ) !== expected
      )
        throw new InputError('Verification input integrity changed.');
      results.push({
        ...check,
        status:
          stopped || exitCode === 124 || exitCode === 137
            ? 'timed-out'
            : exitCode === 0
              ? 'passed'
              : exitCode === null || [125, 126, 127].includes(exitCode)
                ? 'error'
                : 'failed',
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        at: new Date().toISOString(),
      });
    }
    return results;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { commonDir, root } from './git';
import { InputError } from './engine';
import type { LocalConfig, Review } from '../shared/review';

export class LocalStore {
  readonly repo: string;
  readonly directory: string;
  constructor(repo: string) {
    this.repo = root(repo);
    this.directory = join(commonDir(this.repo), 'fuse');
    mkdirSync(join(this.directory, 'reviews'), { recursive: true });
  }
  read<T>(name: string, fallback: T): T {
    const path = join(this.directory, name);
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
  }
  write(name: string, value: unknown) {
    const target = join(this.directory, name),
      temporary = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, target);
  }
  config() {
    return this.read<LocalConfig>('config.json', { sessions: [], checks: [] });
  }
  get(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new InputError('Invalid review ID.');
    const review = this.read<Review | null>(`reviews/${id}.json`, null);
    if (!review) throw Object.assign(new InputError('Review not found.'), { status: 404 });
    return review;
  }
  save(review: Review) {
    this.write(`reviews/${review.id}.json`, review);
  }
  list() {
    return readdirSync(join(this.directory, 'reviews'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.get(f.slice(0, -5)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 100);
  }
  lock<T>(run: () => T): T {
    const path = join(this.directory, 'operation.lock');
    let fd: number;
    try {
      fd = openSync(path, 'wx', 0o600);
    } catch {
      throw Object.assign(
        new InputError(
          'Another Fuse operation is active. If a process crashed, inspect .git/fuse/operation.lock before removing it.',
        ),
        { status: 409 },
      );
    }
    try {
      writeFileSync(fd, `${process.pid}\n`);
      return run();
    } finally {
      closeSync(fd);
      unlinkSync(path);
    }
  }
}

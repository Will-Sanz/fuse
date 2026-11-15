// Locks shared between runs of the conflict check, which can overlap: a hook's
// background check, a check asked for by hand and another repository's check.
//
// - The workspace lock: one run at a time may reset, merge and test in a
//   repository's reusable worktree.
// - The database lock: two runs using the target's test database at once make
//   tests fail at random (one run's cleanup deletes the other's rows).
//
// Whichever run starts second waits. A lock is a directory, which mkdir creates
// atomically, holding the owner's pid. A lock whose owner has died is taken
// over, one waiter at a time.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DB_LOCK_DIR =
  process.env.FUSE_DETECT_DB_LOCK ?? path.join(fs.realpathSync(os.tmpdir()), 'fuse-detect-db.lock');
const POLL_MS = 1_000;
// An owner file still missing after this long means its creator died.
const UNOWNED_STALE_MS = 10_000;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function owner(lockDir) {
  try {
    const [pid, ...name] = fs.readFileSync(path.join(lockDir, 'owner'), 'utf8').trim().split(' ');
    return { pid: Number(pid), name: name.join(' ') };
  } catch {
    return null;
  }
}

function stale(lockDir) {
  const o = owner(lockDir);
  if (o) return !alive(o.pid);
  try {
    return Date.now() - fs.statSync(lockDir).mtimeMs > UNOWNED_STALE_MS;
  } catch {
    return false;
  }
}

/**
 * Removes the lock if its owner has died. Only one process reclaims at a time,
 * and it looks again once it is that one: another waiter may already have
 * removed the dead lock and taken a new one, which must not be deleted.
 */
function reclaim(lockDir) {
  const guard = `${lockDir}.reclaim`;
  try {
    fs.mkdirSync(guard);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    // Reclaiming takes milliseconds, so an old guard is from a process that died.
    try {
      if (Date.now() - fs.statSync(guard).mtimeMs > UNOWNED_STALE_MS)
        fs.rmSync(guard, { recursive: true, force: true });
    } catch {
      // already gone
    }
    sleep(50);
    return;
  }
  try {
    if (stale(lockDir)) fs.rmSync(lockDir, { recursive: true, force: true });
  } finally {
    fs.rmSync(guard, { recursive: true, force: true });
  }
}

/**
 * Waits for the lock at lockDir, then holds it until release() or exit.
 * @param lockDir the directory that is the lock; its parent must exist
 * @param name what is holding it, shown to anyone waiting
 * @param what what the lock protects, for the waiting message
 * @param pollMs how often to look again while waiting
 * @returns release function
 */
export function acquireLock(lockDir, name, what, log = (m) => console.error(m), pollMs = POLL_MS) {
  let told = false;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'owner'), `${process.pid} ${name}\n`);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (stale(lockDir)) {
        reclaim(lockDir);
        continue;
      }
      if (!told) {
        const o = owner(lockDir);
        log(`waiting for ${what}, in use by ${o ? `${o.name} (pid ${o.pid})` : 'another run'}`);
        told = true;
      }
      sleep(pollMs);
    }
  }
  const release = () => {
    if (owner(lockDir)?.pid === process.pid) fs.rmSync(lockDir, { recursive: true, force: true });
    process.off('exit', release);
  };
  process.on('exit', release);
  return release;
}

/** Waits for the target's test database, then holds it until release() or exit. */
export const acquireDbLock = (name, log) =>
  acquireLock(DB_LOCK_DIR, name, 'the test database', log);

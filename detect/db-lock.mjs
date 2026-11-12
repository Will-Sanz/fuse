// A lock on the target's test database, held by merge-check while tests run.
// Two runs using the database at once make tests fail at random (one run's
// cleanup deletes the other's rows), so whichever starts second waits.
//
// The lock is a directory, which mkdir creates atomically, holding the owner's
// pid. A lock whose owner has died is taken over.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOCK_DIR =
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

function owner() {
  try {
    const [pid, ...name] = fs.readFileSync(path.join(LOCK_DIR, 'owner'), 'utf8').trim().split(' ');
    return { pid: Number(pid), name: name.join(' ') };
  } catch {
    return null;
  }
}

function stale() {
  const o = owner();
  if (o) return !alive(o.pid);
  try {
    return Date.now() - fs.statSync(LOCK_DIR).mtimeMs > UNOWNED_STALE_MS;
  } catch {
    return false;
  }
}

/**
 * Waits for the test database, then holds it until release() or exit.
 * @param name what is holding it, shown to anyone waiting
 * @returns release function
 */
export function acquireDbLock(name, log = (m) => console.error(m)) {
  let told = false;
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR);
      fs.writeFileSync(path.join(LOCK_DIR, 'owner'), `${process.pid} ${name}\n`);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (stale()) {
        fs.rmSync(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
      if (!told) {
        const o = owner();
        log(
          `waiting for the test database, in use by ${
            o ? `${o.name} (pid ${o.pid})` : 'another run'
          }`,
        );
        told = true;
      }
      sleep(POLL_MS);
    }
  }
  const release = () => {
    if (owner()?.pid === process.pid) fs.rmSync(LOCK_DIR, { recursive: true, force: true });
    process.off('exit', release);
  };
  process.on('exit', release);
  return release;
}

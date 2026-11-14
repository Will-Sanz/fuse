#!/usr/bin/env node
// Runs one shell command in its own process group, so nothing it starts can
// outlive it: on a timeout, once it exits, and if the process that started this
// one dies, the whole group is killed. A check's server or test runner left
// behind could otherwise keep using the workspace or the test database after
// their locks are released.
//
// Usage: node run-group.mjs <timeout ms, 0 for none> <command>
// Passes the command's output through. Exit code: the command's; 124 when it
// timed out; 128 + the signal number when a signal killed it.

import { spawn } from 'node:child_process';
import os from 'node:os';

const [timeoutMs, command] = [Number(process.argv[2]), process.argv[3]];
const parent = process.ppid;
const child = spawn('/bin/bash', ['-c', command], {
  detached: true,
  stdio: ['ignore', 'inherit', 'inherit'],
});
const killGroup = () => {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // already gone
  }
};
let timedOut = false;
const timer =
  timeoutMs > 0
    ? setTimeout(() => {
        timedOut = true;
        killGroup();
      }, timeoutMs)
    : null;
// When the parent dies this process is handed to another, so its parent changes.
const watch = setInterval(() => {
  if (process.ppid !== parent) {
    killGroup();
    process.exit(1);
  }
}, 1_000);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
  process.on(signal, () => {
    killGroup();
    process.exit(1);
  });
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  clearInterval(watch);
  killGroup();
  if (timedOut) process.exit(124);
  if (signal) process.exit(128 + (os.constants.signals[signal] ?? 0));
  process.exit(code ?? 1);
});

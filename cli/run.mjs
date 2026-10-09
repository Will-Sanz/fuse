#!/usr/bin/env node
import { register } from 'tsx/esm/api';
register();
const { main } = await import('./fuse.ts');
try {
  process.exitCode = await main();
} catch (error) {
  const code = error.status === 409 ? 3 : 1;
  if (process.argv.includes('--json'))
    console.log(
      JSON.stringify({ schemaVersion: 1, error: { message: error.message, exitCode: code } }),
    );
  else console.error(`Fuse: ${error.message}`);
  process.exitCode = code;
}

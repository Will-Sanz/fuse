#!/usr/bin/env node
import { register } from 'tsx/esm/api';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
register({ tsconfig: fileURLToPath(new URL('../tsconfig.json', import.meta.url)) });
try {
  const env = fileURLToPath(new URL('../.env', import.meta.url));
  if (existsSync(env)) process.loadEnvFile(env);
  const { main } = await import('./fuse.ts');
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

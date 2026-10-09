#!/usr/bin/env node
import { register } from 'tsx/esm/api';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
register({ tsconfig: fileURLToPath(new URL('../tsconfig.json', import.meta.url)) });
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

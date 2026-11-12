import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { testBuilderCliArgs } from './packageTestConfig.mjs';

const require = createRequire(import.meta.url);
const cli = require.resolve('electron-builder/cli.js');
const cwd = fileURLToPath(new URL('..', import.meta.url));
const result = spawnSync(process.execPath, [cli, ...testBuilderCliArgs()], {
  cwd,
  stdio: 'inherit',
  env: { ...process.env, JARVIS_EDITION: 'test' },
});
process.exit(result.status ?? 1);

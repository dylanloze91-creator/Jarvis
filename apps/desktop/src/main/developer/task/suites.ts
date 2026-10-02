import {
  parseTestOutput,
  suiteCommand,
  testExcerpt,
  TEST_SUITES,
  type TestRunSummary,
  type TestSuiteId,
} from '@jarvis/core';
import type { Runner } from '../runner.js';
import type { Sandbox } from './sandbox.js';

export interface NodeTools {
  nodePath: string;
  npmCli: string;
}

/** Une série de la liste fixe, dans la copie isolée : `node npm-cli.js …`, sans shell, classée. */
export async function runSuite(
  run: Runner,
  sandbox: Sandbox,
  node: NodeTools,
  suite: TestSuiteId,
  options: { signal?: AbortSignal; onLine?: (line: string) => void; timeoutMs?: number } = {},
): Promise<TestRunSummary> {
  const started = Date.now();
  const command = suiteCommand(suite);
  const outcome = await run({
    program: node.nodePath,
    args: [node.npmCli, ...TEST_SUITES[suite].npmArgs],
    cwd: sandbox.path,
    display: command,
    env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
    timeoutMs: options.timeoutMs ?? 15 * 60_000,
    maxBytes: 600_000,
    context: await sandbox.context(),
    signal: options.signal,
    onLine: options.onLine,
  });
  const output = `${outcome.stdout}\n${outcome.stderr}`;
  const parsed = outcome.error
    ? { failures: [`impossible de lancer npm : ${outcome.error}`], summary: 'npm introuvable' }
    : parseTestOutput(output, { exitCode: outcome.code, root: sandbox.path });
  return {
    suite,
    command,
    exitCode: outcome.code,
    failures: outcome.timedOut ? [...parsed.failures, 'délai dépassé'] : parsed.failures,
    summary: outcome.timedOut ? `${parsed.summary}, délai dépassé` : parsed.summary,
    excerpt: testExcerpt(output),
    durationMs: Date.now() - started,
    timedOut: outcome.timedOut,
  };
}

export const SANDBOX_NPM_CI_ARGS = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];

/** Dépendances de la copie isolée, sans aucun script d'installation (décision 3). */
export async function installSandbox(
  run: Runner,
  sandbox: Sandbox,
  node: NodeTools,
  options: { signal?: AbortSignal; onLine?: (line: string) => void } = {},
) {
  return run({
    program: node.nodePath,
    args: [node.npmCli, ...SANDBOX_NPM_CI_ARGS],
    cwd: sandbox.path,
    display: `npm ${SANDBOX_NPM_CI_ARGS.join(' ')}`,
    env: { ...process.env, ONNXRUNTIME_NODE_INSTALL: 'skip', ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
    timeoutMs: 30 * 60_000,
    context: await sandbox.context(),
    signal: options.signal,
    onLine: options.onLine,
  });
}

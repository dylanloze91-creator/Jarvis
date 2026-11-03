import { describe, expect, it, vi } from 'vitest';
import type { RunOutcome } from '../runner.js';
import { createDeveloperToolManager } from './index.js';

describe('dev_search_code (fins de ligne CRLF)', () => {
  it('interprète les lignes git grep terminées par \\r', async () => {
    const run = vi.fn(
      async (): Promise<RunOutcome> => ({
        display: 'git grep',
        code: 0,
        stdout:
          'apps/desktop/src/main/tools/index.ts:3:export function createToolManager()\r\napps/desktop/src/main/tools/index.ts:4:  return tools;\r\n',
        stderr: '',
        timedOut: false,
        cancelled: false,
        truncated: false,
        error: null,
      }),
    );
    const manager = createDeveloperToolManager({
      getRoot: () => '/repo',
      run,
      logsDir: () => '/logs',
      repoUrl: 'https://example.com/x.git',
      getNode: async () => ({ nodePath: process.execPath, npmCli: '/tmp/npm-cli.js' }),
      freeBytes: async () => null,
    });
    const outcome = await manager.execute(
      {
        id: 'search',
        name: 'dev_search_code',
        arguments: {
          pattern: 'createToolManager',
          regex: false,
          ignoreCase: false,
          maxResults: 10,
          mode: 'matches',
        },
      },
      { requestConfirmation: async () => true },
    );
    expect(outcome.status).toBe('ok');
    expect(outcome.content).toContain('apps/desktop/src/main/tools/index.ts:3:');
    expect(outcome.content).not.toMatch(/Aucun résultat/);
  });
});

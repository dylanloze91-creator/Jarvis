import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolManager, parseSettings, type CategoryPolicies } from '@jarvis/core';
import { readFileTool } from './read-file.js';

const NEVER: CategoryPolicies = { apps: 'never', files: 'never', capture: 'never', shell: 'never' };

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('read_file sur settings.json', () => {
  it('le texte renvoyé au modèle et au journal ne contient aucune clé', async () => {
    const secrets = {
      apiKey: 'sk-live-llmkey0123456789abcdef',
      searchApiKey: 'tvly-dev-0123456789abcdef',
      marketDataApiKey: 'finnhubkey0123456789abcd',
      googleClientSecret: 'GOCSPX-googlesecret0123456789',
      siteBlockToken: 'siteblock-local-token-0123456789',
    };
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-read-secrets-'));
    dirs.push(dir);
    const file = join(dir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify(
        parseSettings({
          ...secrets,
          provider: 'openai',
          searchProvider: 'tavily',
          marketDataProvider: 'finnhub',
        }),
        null,
        2,
      ),
    );

    const manager = new ToolManager().register(readFileTool);
    const outcome = await manager.execute(
      { id: 'read-1', name: 'read_file', arguments: { path: file, maxChars: 100_000 } },
      { policies: NEVER, requestConfirmation: async () => true },
    );

    expect(outcome.status).toBe('ok');
    for (const secret of Object.values(secrets)) {
      expect(outcome.content).not.toContain(secret);
      expect(JSON.stringify(outcome)).not.toContain(secret);
    }
    expect(outcome.content).toContain('"searchApiKey": "[REDACTED]"');
    expect(outcome.content).toContain('"marketDataApiKey": "[REDACTED]"');
    expect(outcome.content).toContain('"searchProvider": "tavily"');
  });
});

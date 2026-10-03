import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ASK_MARKER } from '@jarvis/core';
import { createHarness } from '../controllerHarness.testkit.js';
import { FakeOllama, type ChatBody, type Reply } from '../models/fakeOllama.testkit.js';
import { createFixtureRepo } from '../task/taskWorkflow.testkit.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-question-'));
const repo = join(base, 'Jarvis');
const MODEL = 'scripte:question';
const fake = new FakeOllama();
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

function askScript(body: ChatBody): Reply {
  const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
  const done = body.messages.filter((m) => m.role === 'tool').length;
  if (!system.includes(ASK_MARKER)) return { content: 'hors sujet' };
  const steps = [
    { name: 'dev_search_files', arguments: { query: 'index' } },
    { name: 'dev_read_file', arguments: { path: 'src/index.ts' } },
    { name: 'dev_git_status', arguments: {} },
  ];
  const next = steps[done];
  if (next) return { call: next };
  return {
    content: `Voici.\n\`\`\`json\n${JSON.stringify({
      reponse: 'Le point d’entrée est `src/index.ts`, qui exporte un module vide.',
      fichiers: ['src/index.ts'],
      citations: [
        { chemin: 'src/index.ts', extrait: 'export {};' },
        { chemin: 'src/index.ts', extrait: 'export const INVENTE = 1;' },
        { chemin: '.env', extrait: 'SECRET=1' },
      ],
    })}\n\`\`\``,
  };
}

beforeAll(async () => {
  mkdirSync(join(base, 'home'), { recursive: true });
  createFixtureRepo(repo);
  await fake.start();
  fake.installed.set(MODEL, 3e9);
  fake.scripts.set(MODEL, askScript);
});
afterAll(async () => {
  await fake.stop();
  rmSync(base, { recursive: true, force: true });
});

describe('« Poser une question » sur le code (0.5.1)', () => {
  it('lecture seule : réponse, citations relues dans les fichiers, journal, copie intacte', async () => {
    const h = createHarness({ base, repo, fake, developer: { codeModel: MODEL } });
    await h.instance.validate(repo);
    const head = git('rev-parse', 'HEAD');
    const state = await h.instance.ask('Quel est le point d’entrée du projet ?');
    expect(state.task?.outcome).toBe('success');
    const ask = state.ask!;
    expect(ask.model).toBe(MODEL);
    expect(ask.checked.answer).toContain('src/index.ts');
    expect(ask.checked.citations.map((c) => c.status)).toEqual([
      'verified',
      'not-found',
      'refused',
    ]);
    expect(ask.checked.verified).toBe(1);
    expect(ask.checked.files).toEqual([{ path: 'src/index.ts', exists: true }]);
    const tools = new Set(
      fake.requests
        .filter((r) => r.path === '/api/chat')
        .flatMap((r) =>
          ((r.body as { tools?: Array<{ function: { name: string } }> }).tools ?? []).map(
            (t) => t.function.name,
          ),
        ),
    );
    expect([...tools].sort()).toEqual([
      'dev_git_diff',
      'dev_git_status',
      'dev_inspect_logs',
      'dev_read_file',
      'dev_search_code',
      'dev_search_files',
    ]);
    const logged = (await h.audit.list()).map((e) => e.toolName);
    expect(logged).toEqual(
      expect.arrayContaining(['dev_search_files', 'dev_read_file', 'dev_git_status']),
    );
    expect(h.cards).toHaveLength(0);
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(git('status', '--porcelain')).toBe('');
  }, 60_000);

  it('aucun modèle de code choisi : rien n’est envoyé, le message le dit', async () => {
    const h = createHarness({ base, repo, fake, developer: { codeModel: '' } });
    await h.instance.validate(repo);
    const before = fake.requests.length;
    const state = await h.instance.ask('Quel est le point d’entrée ?');
    expect(state.notice).toMatch(/aucun n’est choisi d’avance/);
    expect(fake.requests.slice(before).some((r) => r.path === '/api/chat')).toBe(false);
  });
});

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BENCH_BROKEN_READFILE,
  BENCH_FIXTURE,
  BENCH_TASKS,
  checkEdit,
  scoreToolCall,
} from './benchmarkTasks.js';
import { summarizeBench } from './benchmarkTypes.js';
import type { ToolLoopResult } from './toolLoop.js';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function project(overrides: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-bench-fixture-'));
  dirs.push(dir);
  for (const [path, content] of Object.entries({ ...BENCH_FIXTURE, ...overrides })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

function compile(dir: string): { ok: boolean; output: string } {
  try {
    execFileSync(process.execPath, [tsc, '-p', join(dir, 'tsconfig.json')], { stdio: 'pipe' });
    return { ok: true, output: '' };
  } catch (error) {
    return { ok: false, output: String((error as { stdout?: Buffer }).stdout ?? '') };
  }
}

const loop = (calls: ToolLoopResult['calls'], finalText = ''): ToolLoopResult => ({
  finalText,
  calls,
  rounds: 2,
  stoppedBy: 'answer',
  error: null,
  usage: { promptTokens: 0, promptMs: 0, outputTokens: 0, outputMs: 0, loadMs: 0, totalMs: 0 },
});

describe('projet du banc de code', () => {
  it('le projet d’origine compile ; le fichier cassé échoue sur DEFAULT_MAX_CHARS', () => {
    expect(compile(project()).ok).toBe(true);
    const broken = compile(project({ 'src/tools/readFile.ts': BENCH_BROKEN_READFILE }));
    expect(broken.ok).toBe(false);
    expect(broken.output).toMatch(/Cannot find name 'DEFAULT_MAX_CHARS'/);
  }, 60_000);

  it('la modification attendue compile et passe la vérification du texte', () => {
    const edited = BENCH_FIXTURE['src/tools/index.ts']!.replace(
      "import { readFileTool } from './readFile';",
      "import { readFileTool } from './readFile';\nimport { getJarvisVersionTool } from './version';",
    ).replace('return [readFileTool];', 'return [readFileTool, getJarvisVersionTool];');
    expect(checkEdit(edited)).toEqual({ ok: true, detail: 'import et entrée du tableau présents' });
    expect(compile(project({ 'src/tools/index.ts': edited })).ok).toBe(true);
    expect(checkEdit(BENCH_FIXTURE['src/tools/index.ts']!).ok).toBe(false);
    expect(
      checkEdit(
        edited.replace(
          '[readFileTool, getJarvisVersionTool]',
          '[getJarvisVersionTool, readFileTool]',
        ),
      ).ok,
    ).toBe(false);
  }, 60_000);
});

describe('notation', () => {
  it('appels d’outils : seuls les appels structurés réussis comptent', () => {
    expect(
      scoreToolCall(
        'tool-read',
        loop([
          {
            name: 'read_file',
            arguments: { path: 'src/tools/version.ts' },
            status: 'ok',
            content: '',
          },
        ]),
      ).ok,
    ).toBe(true);
    expect(scoreToolCall('tool-read', loop([], '{"name": "read_file"}')).ok).toBe(false);
    expect(
      scoreToolCall(
        'tool-list',
        loop([{ name: 'list_files', arguments: {}, status: 'ok', content: '' }]),
      ).ok,
    ).toBe(true);
    expect(
      scoreToolCall(
        'tool-find',
        loop(
          [
            {
              name: 'read_file',
              arguments: { path: 'src/tools/readFile.ts' },
              status: 'ok',
              content: '',
            },
          ],
          'Elle vaut 8000.',
        ),
      ).ok,
    ).toBe(true);
    expect(
      scoreToolCall(
        'tool-find',
        loop(
          [
            {
              name: 'read_file',
              arguments: { path: 'src/tools/readFile.ts' },
              status: 'ok',
              content: '',
            },
          ],
          'Je ne sais pas.',
        ),
      ).ok,
    ).toBe(false);
  });

  it('cinq tâches : trois appels d’outils, une modification, une correction ; résumé', () => {
    expect(BENCH_TASKS.map((task) => task.kind)).toEqual([
      'tool-call',
      'tool-call',
      'tool-call',
      'edit',
      'fix',
    ]);
    const base = { label: '', detail: '', durationMs: 1, outputTokPerSec: 10, calls: 1 };
    const summary = summarizeBench([
      { ...base, id: 'tool-read', kind: 'tool-call', ok: true },
      { ...base, id: 'tool-list', kind: 'tool-call', ok: true },
      { ...base, id: 'tool-find', kind: 'tool-call', ok: false },
      { ...base, id: 'edit', kind: 'edit', ok: true },
      { ...base, id: 'fix', kind: 'fix', ok: null },
    ]);
    expect(summary).toEqual({ toolCalls: '2/3', edit: true, fix: null, passed: false });
  });
});

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@jarvis/core';
import type * as ExecModule from './platform/exec.js';

vi.mock('../media/launchSpotifyDesktop.js', () => ({
  launchSpotifyDesktop: vi.fn(),
  windowsSpotifyExeCandidates: vi.fn(() => []),
}));

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

vi.mock('./platform/exec.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ExecModule>();
  return { ...actual, runPowerShell: vi.fn(), run: vi.fn() };
});

const { runPowerShell } = await import('./platform/exec.js');
const { closeApplicationTool, openApplicationTool } = await import('./applications.js');
const { getSystemErrorsTool } = await import('./system-errors.js');
const { readFileTool } = await import('./read-file.js');
const { getSystemInfoTool } = await import('./system.js');

const context: ToolContext = { requestConfirmation: async () => true };
const ok = { code: 0, signal: null, stdout: '', stderr: '', timedOut: false, truncated: false };
const originalPlatform = process.platform;

function lastScript(): string {
  const calls = vi.mocked(runPowerShell).mock.calls;
  return String(calls.at(-1)?.[0] ?? '');
}

describe('outils PowerShell (simulés, non exécutés sur Windows)', () => {
  beforeAll(() => Object.defineProperty(process, 'platform', { value: 'win32' }));
  afterAll(() => Object.defineProperty(process, 'platform', { value: originalPlatform }));
  beforeEach(() => {
    vi.mocked(runPowerShell).mockReset();
  });

  it('close_application ne met jamais le nom dans une chaîne à guillemets doubles', async () => {
    vi.mocked(runPowerShell).mockResolvedValue({ ...ok, stdout: 'notepad' });
    const name = 'x" -or $true) { Remove-Item C:\\ -Recurse } #$(calc)';
    await closeApplicationTool.run({ name }, context);

    const script = lastScript();
    expect(script).toContain(`'${name.replace(/'/g, "''")}'`);
    expect(script).not.toContain(`"*${name}*"`);
    expect(script).not.toMatch(/-like\s+"/);
  });

  it('open_application passe la recherche disque entre apostrophes', async () => {
    vi.mocked(runPowerShell)
      .mockResolvedValueOnce({ ...ok, code: 1 })
      .mockResolvedValueOnce({ ...ok, code: 1 });
    await openApplicationTool.run({ name: 'Mon$(calc)Appli' }, context);

    const script = lastScript();
    expect(script).toContain("$query = 'mon$(calc)appli'");
    expect(script).not.toContain('"*mon');
  });

  it('get_system_info n’annonce pas une charge de 0 sous Windows', async () => {
    const result = await getSystemInfoTool.run({}, context);
    expect(result.content).toContain('Charge moyenne (1 min) : non mesurée sous Windows');
  });

  it('get_system_errors reconnaît « aucun événement » quelle que soit la langue', async () => {
    vi.mocked(runPowerShell).mockResolvedValue({ ...ok, stdout: '[]' });
    const result = await getSystemErrorsTool.run({}, context);

    expect(lastScript()).toContain('NoMatchingEventsFound');
    expect(result.ok).toBe(true);
    expect(result.content).toBe('Aucune erreur ou avertissement récent dans le journal.');
  });
});

describe('read_file', () => {
  let dir = '';
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jarvis-read-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('ne dit pas « tronqué » pour un fichier accentué lu en entier', async () => {
    const path = join(dir, 'notes.txt');
    await writeFile(path, 'Réunion à déjeuner, café et crème brûlée.', 'utf8');
    const result = await readFileTool.run({ path }, context);

    expect(result.ok).toBe(true);
    expect(result.content).toBe('Réunion à déjeuner, café et crème brûlée.');
  });

  it('signale bien un fichier coupé à maxChars', async () => {
    const path = join(dir, 'long.txt');
    await writeFile(path, 'é'.repeat(500), 'utf8');
    const result = await readFileTool.run({ path, maxChars: 200 }, context);

    expect(result.content).toMatch(/fichier tronqué/);
  });
});

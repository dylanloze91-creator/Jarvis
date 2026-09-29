import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const picturesDir = await mkdtemp(join(tmpdir(), 'jarvis-shot-'));
const getSources = vi.fn();
const primary = { id: 42, scaleFactor: 1, size: { width: 800, height: 600 } };
const secondary = { id: 7, scaleFactor: 1, size: { width: 1024, height: 768 } };

vi.mock('electron', () => ({
  app: { getPath: () => picturesDir },
  desktopCapturer: { getSources },
  screen: {
    getAllDisplays: () => [secondary, primary],
    getPrimaryDisplay: () => primary,
  },
}));

const { captureScreen, takeScreenshotTool } = await import('./screenshot.js');

function source(displayId: string, png: string) {
  return {
    display_id: displayId,
    thumbnail: { isEmpty: () => false, toPNG: () => Buffer.from(png) },
  };
}

describe('take_screenshot', () => {
  beforeEach(() => {
    getSources.mockReset();
  });
  afterAll(async () => {
    await rm(picturesDir, { recursive: true, force: true });
  });

  it('capture l’écran principal sans index, même s’il n’est pas le premier listé', async () => {
    getSources.mockResolvedValue([source('7', 'secondaire'), source('42', 'principal')]);
    const result = await takeScreenshotTool.run({}, { requestConfirmation: async () => true });

    expect(result.ok).toBe(true);
    const path = (result.data as { path: string }).path;
    expect(await readFile(path, 'utf8')).toBe('principal');
    expect(getSources.mock.calls[0]?.[0]).toMatchObject({ thumbnailSize: { width: 800 } });
  });

  it('rend une erreur au lieu de rester « en cours » si la capture ne répond pas', async () => {
    getSources.mockReturnValue(new Promise(() => undefined));
    const result = await captureScreen(0, 30);

    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/n'a pas répondu/);
  });

  it('annonce le repli sans index au modèle', () => {
    expect(takeScreenshotTool.description).toMatch(/sans demander/);
    const display = (takeScreenshotTool.jsonSchema.properties as Record<string, unknown>).display;
    expect(display).toMatchObject({ default: 0 });
    expect(takeScreenshotTool.jsonSchema.required ?? []).not.toContain('display');
  });
});

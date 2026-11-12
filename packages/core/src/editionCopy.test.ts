import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyLiveIntoTest, type CopyHost } from './editionCopy.js';

describe('copie depuis Jarvis Live', () => {
  it('copie la liste, jamais l’historique, et n’écrit pas chez Live', async () => {
    const live = join('live');
    const test = join('test');
    const fs = memoryFs();
    fs.put(join(live, 'settings.json'), '{"hotkey":"Control+Space","model":"qwen2.5:3b"}\n');
    fs.put(join(live, 'personalization.json'), '{"prenom":"Dylan"}\n');
    fs.put(join(live, 'questionnaire.json'), '{"done":true}\n');
    fs.put(
      join(live, 'knowledge-index.json'),
      JSON.stringify({
        chunks: [
          { id: 'souvenir', source: 'memory', text: 'aime le thé' },
          { id: 'lecon', source: 'learning:lecon', learning: { id: 'lecon' }, text: 'secret appris' },
        ],
      }),
    );
    fs.put(join(live, 'memory', 'profile.json'), '[{"title":"thé"}]\n');
    fs.put(join(live, 'developer', 'projects', 'registry.json'), '{"projects":[]}\n');
    fs.put(join(live, 'developer', 'projects', 'photos', 'memory.json'), '{}\n');
    fs.put(join(live, 'developer', 'code-model.json'), '{"model":"jarvis-coder"}\n');
    fs.put(join(live, 'conversations', 'une.json'), '{"secret":"historique"}\n');
    fs.put(join(live, 'audit-log.json'), '[]\n');
    fs.put(join(live, 'learning', 'examples.json'), '[]\n');
    fs.put(join(live, 'wake-learning', 'index.json'), '{}\n');
    const before = fs.snapshot(live);

    const report = await copyLiveIntoTest({
      liveRoot: live,
      testRoot: test,
      host: fs.host,
      cipher: { tryDecrypt: () => 'clair-qui-ne-doit-pas-sortir' },
    });

    expect(fs.snapshot(live)).toEqual(before);
    expect(report.copied).toEqual(
      expect.arrayContaining([
        'settings.json',
        'personalization.json',
        'questionnaire.json',
        'knowledge-index.json',
        'memory/profile.json',
        'developer/projects/registry.json',
        'developer/projects/photos/memory.json',
        'developer/code-model.json',
      ]),
    );
    expect(report.copied.some((path) => path.startsWith('conversations'))).toBe(false);
    expect(report.copied.some((path) => path.startsWith('learning'))).toBe(false);
    expect(report.copied.some((path) => path.startsWith('wake-learning'))).toBe(false);
    expect(report.copied).not.toContain('audit-log.json');
    const settings = JSON.parse(fs.text(join(test, 'settings.json'))) as { hotkey: string; model: string };
    expect(settings.hotkey).toBe('Control+Alt+Space');
    expect(settings.model).toBe('qwen2.5:3b');
    const index = JSON.parse(fs.text(join(test, 'knowledge-index.json'))) as {
      chunks: Array<{ id: string }>;
    };
    expect(index.chunks.map((chunk) => chunk.id)).toEqual(['souvenir']);
    expect(fs.text(join(test, 'knowledge-index.json'))).not.toContain('secret appris');
    expect(fs.has(join(test, 'conversations', 'une.json'))).toBe(false);
  });

  it('recopie le coffre seulement s’il se déchiffre, sans écrire le clair', async () => {
    const live = join('live-coffre');
    const test = join('test-coffre');
    const fs = memoryFs();
    fs.put(join(live, 'coffre.bin'), 'chiffre');
    fs.put(join(live, 'google-token.bin'), 'jeton');
    fs.put(join(live, 'spotify-token.json'), '{"access":"x"}\n');
    const lines: string[] = [];
    const refused = await copyLiveIntoTest({
      liveRoot: live,
      testRoot: test,
      host: fs.host,
      cipher: { tryDecrypt: () => null },
      log: (line) => lines.push(line),
    });
    expect(refused.secrets).toBe('reconnect');
    expect(refused.guide).toMatch(/clés API/);
    expect(fs.has(join(test, 'coffre.bin'))).toBe(false);
    expect(fs.has(join(test, 'google-token.bin'))).toBe(false);
    expect(fs.has(join(test, 'spotify-token.json'))).toBe(false);
    expect(lines.join('\n')).not.toContain('chiffre');

    const ok = await copyLiveIntoTest({
      liveRoot: live,
      testRoot: join('test-coffre-ok'),
      host: fs.host,
      cipher: { tryDecrypt: () => 'clair secret' },
      log: (line) => lines.push(line),
    });
    expect(ok.secrets).toBe('imported');
    expect(fs.text(join('test-coffre-ok', 'coffre.bin'))).toBe('chiffre');
    expect(fs.has(join('test-coffre-ok', 'google-token.bin'))).toBe(false);
    expect(fs.has(join('test-coffre-ok', 'spotify-token.json'))).toBe(false);
    expect(lines.join('\n')).not.toContain('clair secret');
  });

  it('ne recopie jamais les jetons Spotify ni Google, même s’ils sont lisibles', async () => {
    const live = join('live-jetons');
    const test = join('test-jetons');
    const fs = memoryFs();
    fs.put(join(live, 'coffre.bin'), 'chiffre-coffre');
    fs.put(join(live, 'google-token.bin'), 'jeton-google-lisible');
    fs.put(join(live, 'spotify-token.json'), '{"refresh":"jeton-spotify-lisible"}\n');
    const lines: string[] = [];
    const report = await copyLiveIntoTest({
      liveRoot: live,
      testRoot: test,
      host: fs.host,
      cipher: { tryDecrypt: () => 'clair-du-coffre' },
      log: (line) => lines.push(line),
    });
    expect(report.copied).toContain('coffre.bin');
    expect(report.copied).not.toContain('google-token.bin');
    expect(report.copied).not.toContain('spotify-token.json');
    expect(fs.text(join(test, 'coffre.bin'))).toBe('chiffre-coffre');
    expect(fs.has(join(test, 'google-token.bin'))).toBe(false);
    expect(fs.has(join(test, 'spotify-token.json'))).toBe(false);
    expect(fs.text(join(live, 'google-token.bin'))).toBe('jeton-google-lisible');
    expect(fs.text(join(live, 'spotify-token.json'))).toContain('jeton-spotify-lisible');
    const journal = lines.join('\n');
    expect(journal).not.toContain('jeton-google-lisible');
    expect(journal).not.toContain('jeton-spotify-lisible');
    expect(journal).not.toContain('clair-du-coffre');
    expect(report.guide).toMatch(/Reconnecte-les dans Jarvis Test/);
  });

  it('refuse d’écrire si la destination est le dossier de Live', async () => {
    const live = join('meme');
    const fs = memoryFs();
    fs.put(join(live, 'settings.json'), '{"hotkey":"Control+Space"}\n');
    await expect(
      copyLiveIntoTest({ liveRoot: live, testRoot: live, host: fs.host }),
    ).rejects.toThrow(/Live/);
    expect(fs.text(join(live, 'settings.json'))).toContain('Control+Space');
  });
});

function memoryFs(): {
  put(path: string, text: string): void;
  text(path: string): string;
  has(path: string): boolean;
  snapshot(root: string): string[];
  host: CopyHost;
} {
  const files = new Map<string, string>();
  const put = (path: string, text: string): void => {
    files.set(path, text);
  };
  const host: CopyHost = {
    readFile: async (path) => {
      const hit = files.get(path);
      if (hit === undefined) throw new Error('absent');
      return Buffer.from(hit);
    },
    writeFile: async (path, data) => {
      files.set(path, new TextDecoder().decode(data));
    },
    mkdir: async () => undefined,
    readdir: async (path) => {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      const names = new Set<string>();
      const dirs = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const [name, ...more] = rest.split('/');
        if (!name) continue;
        names.add(name);
        if (more.length > 0) dirs.add(name);
      }
      if (names.size === 0 && ![...files.keys()].some((key) => key.startsWith(prefix))) {
        throw new Error('absent');
      }
      return [...names].map((name) => ({ name, isDirectory: dirs.has(name) }));
    },
  };
  return {
    put,
    text: (path) => files.get(path) ?? '',
    has: (path) => files.has(path),
    snapshot: (root) =>
      [...files.entries()]
        .filter(([path]) => path === root || path.startsWith(`${root}/`))
        .map(([path, text]) => `${path}=${text}`)
        .sort(),
    host,
  };
}

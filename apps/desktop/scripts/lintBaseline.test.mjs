import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Les fichiers qui faisaient échouer `npm run lint` en 0.4.21. */
const FILES_RED_IN_0421 = [
  'apps/desktop/src/main/knowledge.ts',
  'apps/desktop/src/main/youtube/downloadAudio.ts',
  'apps/desktop/src/renderer/src/voice/onnxRuntime.ts',
  'apps/desktop/src/renderer/src/voice/voiceDiagnostic.test.ts',
  'apps/desktop/src/renderer/src/voice/whisper/loaderCore.ts',
  'apps/desktop/src/renderer/src/voice/whisper/workerBackend.test.ts',
  'packages/core/src/media/playIntent.ts',
  'packages/core/src/speech/confirmWakeWordCandidate.ts',
  'packages/core/src/web/research.ts',
];

function describeMessages(results) {
  return results.flatMap((result) =>
    result.messages.map(
      (m) => `${result.filePath.slice(root.length + 1)}:${m.line} ${m.ruleId ?? ''} ${m.message}`,
    ),
  );
}

describe('lint : base verte', () => {
  const eslint = new ESLint({ cwd: root });

  it('le runtime voix copié par setup:voice est ignoré, pas le code', async () => {
    expect(
      await eslint.isPathIgnored(
        resolve(root, 'apps/desktop/voice-assets/ort/ort-wasm-simd-threaded.mjs'),
      ),
    ).toBe(true);
    expect(await eslint.isPathIgnored(resolve(root, 'apps/desktop/src/main/knowledge.ts'))).toBe(
      false,
    );
  });

  it('les fichiers en erreur en 0.4.21 passent, sans directive eslint-disable inutile', async () => {
    const results = await eslint.lintFiles(FILES_RED_IN_0421.map((file) => resolve(root, file)));
    expect(results).toHaveLength(FILES_RED_IN_0421.length);
    expect(describeMessages(results)).toEqual([]);
  }, 60_000);

  it('les règles restent actives ailleurs', async () => {
    const results = await eslint.lintText(
      'export const probe = /[\\x00-\\x08]/;\nlet once = 1;\nexport { once };\n',
      {
        filePath: resolve(root, 'packages/core/src/lint-probe.ts'),
      },
    );
    const rules = results[0].messages.map((m) => m.ruleId);
    expect(rules).toContain('no-control-regex');
    expect(rules).toContain('prefer-const');
  }, 60_000);
});

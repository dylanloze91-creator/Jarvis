import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ORT_WASM_MJS, REQUIRED_VOICE_ASSETS } from '@jarvis/core';

const registered: unknown[] = [];
vi.mock('electron', () => ({
  app: {},
  protocol: { registerSchemesAsPrivileged: (schemes: unknown[]) => registered.push(...schemes) },
}));

const desktopRoot = join(__dirname, '..', '..');
const require = createRequire(join(desktopRoot, 'package.json'));

function packageRoot(name: string): string {
  let dir = dirname(require.resolve(name));
  while (!existsSync(join(dir, 'package.json')) || JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name !== name) {
    dir = dirname(dir);
  }
  return dir;
}

describe('empaquetage de la voix', () => {
  it('un seul onnxruntime-web, celui qu’exige transformers.js (≥ 1.24.3 pour blob + wasmBinary)', () => {
    const ort = JSON.parse(readFileSync(join(packageRoot('onnxruntime-web'), 'package.json'), 'utf8'));
    const transformers = JSON.parse(
      readFileSync(join(packageRoot('@huggingface/transformers'), 'package.json'), 'utf8'),
    );
    expect(ort.version).toBe(transformers.dependencies['onnxruntime-web']);
    const [major, minor] = String(ort.version).split('.').map(Number);
    expect(major! * 100 + minor!).toBeGreaterThanOrEqual(124);
    expect(existsSync(join(desktopRoot, 'node_modules', 'onnxruntime-web'))).toBe(false);
  });

  it('Whisper et openWakeWord importent le même ort.wasm.min.mjs (ni JSEP ni WebGPU)', () => {
    const config = readFileSync(join(desktopRoot, 'electron.vite.config.ts'), 'utf8');
    expect(config).toContain("find: /^onnxruntime-web(\\/webgpu)?$/");
    expect(config).toContain("'ort.wasm.min.mjs'");
    expect(config).not.toMatch(/ort\.min\.mjs['"]/);
    const entry = readFileSync(join(packageRoot('onnxruntime-web'), 'dist', 'ort.wasm.min.mjs'), 'utf8');
    expect(entry).toContain(ORT_WASM_MJS);
    expect(entry).not.toContain('ort-wasm-simd-threaded.jsep.mjs');
  });

  it('plus de Porcupine ni de dépendance @picovoice', () => {
    const pkg = readFileSync(join(desktopRoot, 'package.json'), 'utf8');
    expect(pkg).not.toMatch(/picovoice|porcupine/i);
    expect(readFileSync(join(desktopRoot, 'electron-builder.yml'), 'utf8')).not.toMatch(/picovoice|porcupine/i);
  });

  it('extraResources copie voice-assets/{ort,whisper,openwakeword} à côté de app.asar', () => {
    const yml = readFileSync(join(desktopRoot, 'electron-builder.yml'), 'utf8');
    for (const host of ['ort', 'whisper', 'openwakeword']) {
      expect(yml).toContain(`  - from: voice-assets/${host}\n    to: ${host}\n`);
    }
    expect(yml).toContain("  - '!**/*.onnx'\n");
    expect(yml).toContain("  - '!**/*.wasm'\n");
  });

  it('after-pack refuse un paquet sans preprocessor_config.json et accepte un paquet complet', async () => {
    const { default: afterPack } = require(join(desktopRoot, 'scripts', 'after-pack.cjs')) as {
      default: (context: { appOutDir: string }) => Promise<void>;
    };
    const appOutDir = mkdtempSync(join(tmpdir(), 'jarvis-afterpack-'));
    try {
      for (const asset of REQUIRED_VOICE_ASSETS) {
        const file = join(appOutDir, 'resources', asset.host, ...asset.path.split('/'));
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, Buffer.alloc(asset.minBytes));
      }
      await expect(afterPack({ appOutDir })).resolves.toBeUndefined();
      rmSync(join(appOutDir, 'resources', 'whisper', 'Xenova', 'whisper-base', 'preprocessor_config.json'));
      await expect(afterPack({ appOutDir })).rejects.toThrow(
        /manquant : whisper[\\/]Xenova[\\/]whisper-base[\\/]preprocessor_config\.json/,
      );
    } finally {
      rmSync(appOutDir, { recursive: true, force: true });
    }
  });

  it('la CSP autorise jarvis-oww, blob: et la compilation WebAssembly', () => {
    const html = readFileSync(join(desktopRoot, 'src', 'renderer', 'index.html'), 'utf8');
    const csp = html.match(/content="(default-src[^"]+)"/)?.[1] ?? '';
    expect(csp).toMatch(/script-src [^;]*'wasm-unsafe-eval'/);
    expect(csp).toMatch(/script-src [^;]*jarvis-oww:/);
    expect(csp).toMatch(/script-src [^;]*blob:/);
    expect(csp).toMatch(/connect-src [^;]*jarvis-oww:/);
    expect(csp).not.toMatch(/jsdelivr|unpkg/);
  });

  it('enregistre jarvis-oww comme schéma standard, sécurisé, fetch, CORS et flux', async () => {
    const { registerVoiceAssetsScheme } = await import('./voiceAssetsProtocol');
    registerVoiceAssetsScheme();
    expect(registered).toEqual([
      {
        scheme: 'jarvis-oww',
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
      },
    ]);
  });
});

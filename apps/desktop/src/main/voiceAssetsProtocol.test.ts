import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { REQUIRED_VOICE_ASSETS } from '@jarvis/core';

vi.mock('electron', () => ({ app: {}, protocol: {} }));

const {
  inspectVoiceAssets,
  resolveVoiceAssetPath,
  serveVoiceAsset,
  voiceAssetsRoot,
} = await import('./voiceAssetsProtocol');

const WINDOWS_RESOURCES = 'C:\\Users\\Jean Dupont\\AppData\\Local\\Programs\\Jarvis\\resources';

describe('chemins Windows (installateur NSIS par utilisateur)', () => {
  it('sert les extraResources à côté de app.asar une fois installé', () => {
    expect(
      voiceAssetsRoot({
        packaged: true,
        resourcesPath: WINDOWS_RESOURCES,
        appPath: `${WINDOWS_RESOURCES}\\app.asar`,
        pathModule: path.win32,
      }),
    ).toBe(WINDOWS_RESOURCES);
  });

  it('lit voice-assets/ en dev', () => {
    expect(
      voiceAssetsRoot({
        packaged: false,
        resourcesPath: 'C:\\electron\\resources',
        appPath: 'D:\\dev\\Jarvis\\apps\\desktop',
        pathModule: path.win32,
      }),
    ).toBe('D:\\dev\\Jarvis\\apps\\desktop\\voice-assets');
  });

  it('convertit une URL jarvis-oww en chemin avec antislashs, espace compris', () => {
    expect(
      resolveVoiceAssetPath(
        WINDOWS_RESOURCES,
        'jarvis-oww://whisper/Xenova/whisper-base/onnx/encoder_model_quantized.onnx',
        path.win32,
      ),
    ).toBe(`${WINDOWS_RESOURCES}\\whisper\\Xenova\\whisper-base\\onnx\\encoder_model_quantized.onnx`);
    expect(
      resolveVoiceAssetPath(WINDOWS_RESOURCES, 'jarvis-oww://ort/ort-wasm-simd-threaded.wasm', path.win32),
    ).toBe(`${WINDOWS_RESOURCES}\\ort\\ort-wasm-simd-threaded.wasm`);
    expect(
      resolveVoiceAssetPath(WINDOWS_RESOURCES, 'jarvis-oww://openwakeword/hey_jarvis_v0.1.onnx', path.win32),
    ).toBe(`${WINDOWS_RESOURCES}\\openwakeword\\hey_jarvis_v0.1.onnx`);
  });

  it('refuse lecteur, UNC et remontée encodés', () => {
    for (const url of [
      'jarvis-oww://whisper/..%5C..%5Capp.asar',
      'jarvis-oww://ort/C:%5CWindows%5Cwin.ini',
      'jarvis-oww://ort/%5C%5Cserveur%5Cpartage',
      'jarvis-oww://whisper/%2e%2e/%2e%2e/secret',
      'jarvis-oww://whisper/C:/Windows/win.ini',
    ]) {
      expect(resolveVoiceAssetPath(WINDOWS_RESOURCES, url, path.win32), url).toBeNull();
    }
  });
});

describe('serveVoiceAsset (fichiers réels)', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'jarvis voix '));
    await mkdir(path.join(root, 'whisper', 'Xenova', 'whisper-base'), { recursive: true });
    await mkdir(path.join(root, 'ort'), { recursive: true });
    await writeFile(
      path.join(root, 'whisper', 'Xenova', 'whisper-base', 'tokenizer_config.json'),
      '{"tokenizer_class":"WhisperTokenizer"}',
    );
    await writeFile(path.join(root, 'ort', 'ort-wasm-simd-threaded.wasm'), Buffer.from([0, 97, 115, 109]));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('renvoie le JSON avec content-length, type et CORS', async () => {
    const response = await serveVoiceAsset(
      { url: 'jarvis-oww://whisper/Xenova/whisper-base/tokenizer_config.json', method: 'GET' },
      root,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('content-length')).toBe('38');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual({ tokenizer_class: 'WhisperTokenizer' });
  });

  it('sert le WASM en application/wasm (compilation en flux)', async () => {
    const response = await serveVoiceAsset(
      { url: 'jarvis-oww://ort/ort-wasm-simd-threaded.wasm', method: 'GET' },
      root,
    );
    expect(response.headers.get('content-type')).toBe('application/wasm');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 97, 115, 109]));
  });

  it('répond à HEAD sans corps, avec la taille', async () => {
    const response = await serveVoiceAsset(
      { url: 'jarvis-oww://ort/ort-wasm-simd-threaded.wasm', method: 'HEAD' },
      root,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('4');
    expect(response.body).toBeNull();
  });

  it('404 pour un fichier absent, 400 pour une URL hors dossier, 405 pour POST', async () => {
    expect(
      (await serveVoiceAsset({ url: 'jarvis-oww://whisper/Xenova/whisper-base/config.json', method: 'GET' }, root))
        .status,
    ).toBe(404);
    expect(
      (await serveVoiceAsset({ url: 'jarvis-oww://whisper/..%5Csecret', method: 'GET' }, root)).status,
    ).toBe(400);
    expect(
      (await serveVoiceAsset({ url: 'jarvis-oww://ort/ort-wasm-simd-threaded.wasm', method: 'POST' }, root))
        .status,
    ).toBe(405);
  });

  it('inventorie chaque fichier requis sur le disque', async () => {
    const report = await inspectVoiceAssets(root);
    expect(report).toHaveLength(REQUIRED_VOICE_ASSETS.length);
    const tokenizerConfig = report.find((file) => file.path.endsWith('tokenizer_config.json'));
    expect(tokenizerConfig).toMatchObject({ exists: true, size: 38 });
    const encoder = report.find((file) => file.path.endsWith('encoder_model_quantized.onnx'));
    expect(encoder).toMatchObject({ exists: false, size: 0 });
  });
});

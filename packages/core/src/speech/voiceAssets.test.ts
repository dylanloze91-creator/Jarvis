import { describe, expect, it } from 'vitest';
import {
  OPENWAKEWORD_MODEL_FILES,
  REQUIRED_VOICE_ASSETS,
  VOICE_ASSETS_PROTOCOL,
  WHISPER_LOCAL_MODEL_ROOT,
  WHISPER_MODEL_REPO,
  parseVoiceAssetUrl,
  voiceAssetContentType,
  voiceAssetUrl,
} from './voiceAssets.js';

describe('fichiers voix embarqués', () => {
  it('construit une URL jarvis-oww par hôte, en dev comme une fois installé', () => {
    expect(voiceAssetUrl('ort', 'ort-wasm-simd-threaded.wasm')).toBe(
      'jarvis-oww://ort/ort-wasm-simd-threaded.wasm',
    );
    expect(voiceAssetUrl('openwakeword', '/hey_jarvis_v0.1.onnx')).toBe(
      'jarvis-oww://openwakeword/hey_jarvis_v0.1.onnx',
    );
    expect(WHISPER_LOCAL_MODEL_ROOT).toBe(`${VOICE_ASSETS_PROTOCOL}://whisper/`);
  });

  it('découpe une URL de modèle Whisper imbriquée', () => {
    expect(
      parseVoiceAssetUrl(`jarvis-oww://whisper/${WHISPER_MODEL_REPO}/onnx/encoder_model_quantized.onnx`),
    ).toEqual({
      host: 'whisper',
      segments: ['Xenova', 'whisper-base', 'onnx', 'encoder_model_quantized.onnx'],
    });
  });

  it('refuse toute sortie du dossier, y compris les séparateurs Windows encodés', () => {
    for (const url of [
      'jarvis-oww://whisper/../secret.txt',
      'jarvis-oww://whisper/Xenova/%2e%2e/%2e%2e/secret.txt',
      'jarvis-oww://whisper/..%5C..%5CWindows%5Cwin.ini',
      'jarvis-oww://whisper/Xenova%5Cwhisper-base%5Cconfig.json',
      'jarvis-oww://ort/C:%5CWindows%5Cwin.ini',
      'jarvis-oww://ort/.hidden',
      'jarvis-oww://ort/',
      'jarvis-oww://whisper/Xenova//config.json',
      'jarvis-oww://models/hey_jarvis_v0.1.onnx',
      'jarvis-oww://etc/passwd',
      'file:///C:/Windows/win.ini',
      'jarvis-oww://ort/%E0%A4%A',
    ]) {
      expect(parseVoiceAssetUrl(url), url).toBeNull();
    }
  });

  it('annonce le bon type MIME pour la compilation WebAssembly en flux', () => {
    expect(voiceAssetContentType('ort-wasm-simd-threaded.wasm')).toBe('application/wasm');
    expect(voiceAssetContentType('ort-wasm-simd-threaded.mjs')).toBe('text/javascript');
    expect(voiceAssetContentType('config.json')).toBe('application/json');
    expect(voiceAssetContentType('encoder_model_quantized.onnx')).toBe('application/octet-stream');
  });

  it('liste les fichiers dont dépend le chargement de Whisper et d’openWakeWord', () => {
    const paths = REQUIRED_VOICE_ASSETS.map((asset) => `${asset.host}/${asset.path}`);
    expect(paths).toContain('whisper/Xenova/whisper-base/preprocessor_config.json');
    expect(paths).toContain('whisper/Xenova/whisper-base/tokenizer_config.json');
    expect(paths).toContain('whisper/Xenova/whisper-base/tokenizer.json');
    expect(paths).toContain('ort/ort-wasm-simd-threaded.wasm');
    for (const file of OPENWAKEWORD_MODEL_FILES) expect(paths).toContain(`openwakeword/${file}`);
    expect(paths.filter((p) => p.startsWith('ort/'))).toHaveLength(2);
    expect(paths).toContain('vosk/vosk-model-small-fr-0.22.tar.gz');
    expect(voiceAssetContentType('vosk-model-small-fr-0.22.tar.gz')).toBe('application/gzip');
    for (const asset of REQUIRED_VOICE_ASSETS) {
      expect(parseVoiceAssetUrl(voiceAssetUrl(asset.host, asset.path)), asset.path).not.toBeNull();
    }
  });
});

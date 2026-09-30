/**
 * Fichiers voix embarqués : un seul runtime ONNX (WebAssembly), le modèle
 * Whisper et les modèles openWakeWord. Ils vivent hors asar (dossier
 * `voice-assets/` en dev, `resources/` dans l'installateur) et le renderer
 * les lit uniquement par le protocole `jarvis-oww:` du processus principal,
 * en dev comme une fois installé : une seule façon de charger la voix.
 *
 * `jarvis-oww://<hôte>/<chemin>` correspond au fichier
 * `<racine>/<hôte>/<chemin>` sur le disque.
 */
export const VOICE_ASSETS_PROTOCOL = 'jarvis-oww';

export type VoiceAssetHost = 'ort' | 'whisper' | 'openwakeword' | 'vosk';
export const VOICE_ASSET_HOSTS: readonly VoiceAssetHost[] = ['ort', 'whisper', 'openwakeword', 'vosk'];

/**
 * Modèle Vosk français (Kaldi, Apache 2.0, alphacephei.com) : il repère
 * « Jarvis » seul, dans un Web Worker (vosk-browser, sans onnxruntime).
 * Archive `.tar.gz` d'un dossier, format attendu par vosk-browser.
 */
export const VOSK_MODEL_NAME = 'vosk-model-small-fr-0.22';
export const VOSK_MODEL_ARCHIVE = `${VOSK_MODEL_NAME}.tar.gz`;

/**
 * Build WebAssembly seul (ni JSEP ni WebGPU) d'onnxruntime-web, celui que
 * charge `ort.wasm.min.mjs`. Partagé par Whisper et openWakeWord.
 */
export const ORT_WASM_MJS = 'ort-wasm-simd-threaded.mjs';
export const ORT_WASM_BINARY = 'ort-wasm-simd-threaded.wasm';

/** Seul modèle Whisper embarqué (quantifié q8, ~75 Mo). */
export const WHISPER_MODEL_REPO = 'Xenova/whisper-base';

export const OPENWAKEWORD_MODEL_FILES = [
  'melspectrogram.onnx',
  'embedding_model.onnx',
  'hey_jarvis_v0.1.onnx',
] as const;
export type OpenWakeWordModelFile = (typeof OPENWAKEWORD_MODEL_FILES)[number];

export type VoiceAssetKind = 'json' | 'onnx' | 'wasm' | 'mjs' | 'archive';

export interface VoiceAssetSpec {
  host: VoiceAssetHost;
  /** Chemin relatif à l'hôte, séparateur `/`. */
  path: string;
  kind: VoiceAssetKind;
  /** En dessous, le fichier est considéré tronqué. */
  minBytes: number;
}

/**
 * Tout ce que la voix lit au démarrage. `preprocessor_config.json` et
 * `tokenizer*.json` sont indispensables : sans eux transformers.js charge
 * un pipeline sans processeur ni tokenizer.
 */
export const REQUIRED_VOICE_ASSETS: readonly VoiceAssetSpec[] = [
  { host: 'ort', path: ORT_WASM_MJS, kind: 'mjs', minBytes: 1_000 },
  { host: 'ort', path: ORT_WASM_BINARY, kind: 'wasm', minBytes: 1_000_000 },
  { host: 'whisper', path: `${WHISPER_MODEL_REPO}/config.json`, kind: 'json', minBytes: 20 },
  { host: 'whisper', path: `${WHISPER_MODEL_REPO}/generation_config.json`, kind: 'json', minBytes: 20 },
  { host: 'whisper', path: `${WHISPER_MODEL_REPO}/preprocessor_config.json`, kind: 'json', minBytes: 20 },
  { host: 'whisper', path: `${WHISPER_MODEL_REPO}/tokenizer.json`, kind: 'json', minBytes: 1_000 },
  { host: 'whisper', path: `${WHISPER_MODEL_REPO}/tokenizer_config.json`, kind: 'json', minBytes: 20 },
  {
    host: 'whisper',
    path: `${WHISPER_MODEL_REPO}/onnx/encoder_model_quantized.onnx`,
    kind: 'onnx',
    minBytes: 1_000_000,
  },
  {
    host: 'whisper',
    path: `${WHISPER_MODEL_REPO}/onnx/decoder_model_merged_quantized.onnx`,
    kind: 'onnx',
    minBytes: 1_000_000,
  },
  ...OPENWAKEWORD_MODEL_FILES.map(
    (file): VoiceAssetSpec => ({ host: 'openwakeword', path: file, kind: 'onnx', minBytes: 100_000 }),
  ),
  { host: 'vosk', path: VOSK_MODEL_ARCHIVE, kind: 'archive', minBytes: 30_000_000 },
];

export function voiceAssetUrl(host: VoiceAssetHost, relativePath: string): string {
  return `${VOICE_ASSETS_PROTOCOL}://${host}/${relativePath.replace(/^\/+/, '')}`;
}

/** Racine passée à `env.localModelPath` de transformers.js. */
export const WHISPER_LOCAL_MODEL_ROOT = `${VOICE_ASSETS_PROTOCOL}://whisper/`;

const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/**
 * Découpe une URL `jarvis-oww:` en hôte + segments sûrs, ou `null`. Refuse
 * `..`, les séparateurs Windows encodés (`%5C`), les segments vides et tout
 * hôte inconnu : le résultat peut être joint à une racine sans en sortir.
 */
export function parseVoiceAssetUrl(
  requestUrl: string,
): { host: VoiceAssetHost; segments: string[] } | null {
  if (/\.\.|%2e|%5c|\\/i.test(requestUrl)) return null;
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${VOICE_ASSETS_PROTOCOL}:`) return null;
  const host = url.hostname.toLowerCase() as VoiceAssetHost;
  if (!VOICE_ASSET_HOSTS.includes(host)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
  if (!decoded) return null;
  const segments = decoded.split('/');
  if (!segments.every((segment) => SAFE_SEGMENT.test(segment) && !segment.includes('..'))) {
    return null;
  }
  return { host, segments };
}

export function voiceAssetContentType(file: string): string {
  const lower = file.toLowerCase();
  if (lower.endsWith('.wasm')) return 'application/wasm';
  if (lower.endsWith('.mjs') || lower.endsWith('.js')) return 'text/javascript';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'application/gzip';
  return 'application/octet-stream';
}

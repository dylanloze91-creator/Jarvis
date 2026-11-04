/**
 * Fichiers Piper embarqués (binaire précompilé + modèles ONNX). Téléchargés par
 * `apps/desktop/scripts/setup-piper.mjs`, copiés dans l'installateur via
 * `extraResources`, jamais commités.
 */
export const PIPER_RELEASE = '2023.11.14-2';

export const PIPER_LINUX_X64_ARCHIVE_SHA256 =
  'a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992';
export const PIPER_WINDOWS_X64_ARCHIVE_SHA256 =
  'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea';

export const PIPER_LINUX_X64_URL = `https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE}/piper_linux_x86_64.tar.gz`;
export const PIPER_WINDOWS_X64_URL = `https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE}/piper_windows_amd64.zip`;

const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

export interface PiperModelAsset {
  /** Nom de fichier dans `voice-assets/piper/models/`. */
  onnx: string;
  json: string;
  onnxUrl: string;
  jsonUrl: string;
  onnxSha256: string;
  jsonSha256: string;
  minOnnxBytes: number;
}

/** Empreintes relevées le 2026-11-02 sur les fichiers Hugging Face officiels. */
export const PIPER_MODEL_ASSETS: readonly PiperModelAsset[] = [
  {
    onnx: 'fr_FR-siwis-medium.onnx',
    json: 'fr_FR-siwis-medium.onnx.json',
    onnxUrl: `${HF}/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx`,
    jsonUrl: `${HF}/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json`,
    onnxSha256: '641d1ab097da2b81128c076810edb052b385decc8be3381814802a64a73baf99',
    jsonSha256: '39479916c2db192b5ac9764daddd0c744d83e023ad890c6976c0633ae4df8959',
    minOnnxBytes: 60_000_000,
  },
  {
    onnx: 'fr_FR-upmc-medium.onnx',
    json: 'fr_FR-upmc-medium.onnx.json',
    onnxUrl: `${HF}/fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx`,
    jsonUrl: `${HF}/fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx.json`,
    onnxSha256: '9abb3800c199148897a9ed64e100d224f3de83579f100044174ad19418f1786f',
    jsonSha256: 'e8636ec15dfd5d72db37a02cb5320a20f2b8d339f2a0e4337da64c58a33a5868',
    minOnnxBytes: 70_000_000,
  },
];

export interface PiperAssetCheck {
  relativePath: string;
  minBytes: number;
}

export type PiperBinaryTarget = 'linux-x64' | 'win-x64';

/**
 * Binaire Piper à préparer dans `voice-assets/piper/bin/`.
 * `JARVIS_PIPER_TARGET=win-x64` force le binaire Windows (ex. `package:win` sur Linux).
 */
export function resolvePiperBinaryTarget(options: {
  platform: string;
  targetOverride?: string;
}): PiperBinaryTarget {
  const platform = options.platform;
  const raw = (options.targetOverride ?? '').trim().toLowerCase();
  if (raw === 'win-x64' || raw === 'win32' || raw === 'windows' || raw === 'win') return 'win-x64';
  if (raw === 'linux-x64' || raw === 'linux') return 'linux-x64';
  if (platform === 'win32') return 'win-x64';
  if (platform === 'linux') return 'linux-x64';
  return 'linux-x64';
}

/** Fichiers Windows Piper requis dans l'installateur (`resources/piper/`). */
export const PIPER_WINDOWS_BUNDLE_CHECKS: readonly PiperAssetCheck[] = [
  { relativePath: 'bin/win-x64/piper/piper.exe', minBytes: 100_000 },
  { relativePath: 'bin/win-x64/piper/espeak-ng.dll', minBytes: 10_000 },
  { relativePath: 'bin/win-x64/piper/onnxruntime.dll', minBytes: 1_000_000 },
  { relativePath: 'bin/win-x64/piper/espeak-ng-data/fr_dict', minBytes: 1_000 },
];

/** Fichiers attendus pour le diagnostic (binaire + deux modèles). */
export function requiredPiperAssetChecks(platform: string, arch: string): PiperAssetCheck[] {
  const bin =
    platform === 'win32'
      ? arch === 'arm64'
        ? 'bin/win-arm64/piper/piper.exe'
        : 'bin/win-x64/piper/piper.exe'
      : platform === 'darwin'
        ? 'bin/macos/piper/piper'
        : 'bin/linux-x64/piper/piper';
  const checks: PiperAssetCheck[] = [{ relativePath: bin, minBytes: 100_000 }];
  for (const model of PIPER_MODEL_ASSETS) {
    checks.push({ relativePath: `models/${model.onnx}`, minBytes: model.minOnnxBytes });
    checks.push({ relativePath: `models/${model.json}`, minBytes: 100 });
  }
  return checks;
}

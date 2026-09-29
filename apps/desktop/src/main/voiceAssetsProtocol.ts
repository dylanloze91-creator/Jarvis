import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { app, protocol } from 'electron';
import {
  REQUIRED_VOICE_ASSETS,
  VOICE_ASSETS_PROTOCOL,
  parseVoiceAssetUrl,
  voiceAssetContentType,
  type VoiceAssetHost,
  type VoiceAssetKind,
} from '@jarvis/core';

type PathModule = Pick<typeof path, 'join' | 'relative' | 'isAbsolute' | 'sep'>;

/**
 * À appeler avant `app.whenReady()`. `standard` + `secure` : URL parsées
 * comme http(s) et contexte sécurisé ; `supportFetchAPI` + `corsEnabled` :
 * `fetch()` depuis la page `file://` (origine opaque) ; `stream` : corps
 * lus au fil de l'eau (ONNX de 53 Mo).
 */
export function registerVoiceAssetsScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: VOICE_ASSETS_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

/**
 * Dossier qui contient `ort/`, `whisper/` et `openwakeword/` : les
 * extraResources de l'installateur (`C:\Users\…\AppData\Local\Programs\Jarvis\resources`)
 * ou `apps/desktop/voice-assets` en dev.
 */
export function voiceAssetsRoot(input: {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
  pathModule?: PathModule;
}): string {
  const p = input.pathModule ?? path;
  return input.packaged ? input.resourcesPath : p.join(input.appPath, 'voice-assets');
}

/** Chemin disque d'une URL `jarvis-oww:`, ou `null` si elle sortirait de `root`. */
export function resolveVoiceAssetPath(
  root: string,
  requestUrl: string,
  pathModule: PathModule = path,
): string | null {
  const parsed = parseVoiceAssetUrl(requestUrl);
  if (!parsed) return null;
  const target = pathModule.join(root, parsed.host, ...parsed.segments);
  const relative = pathModule.relative(root, target);
  if (!relative || relative.startsWith('..') || pathModule.isAbsolute(relative)) return null;
  return target;
}

export interface VoiceAssetFs {
  stat: (file: string) => Promise<{ isFile(): boolean; size: number }>;
  openStream: (file: string) => ReadableStream<Uint8Array>;
}

const nodeFs: VoiceAssetFs = {
  stat,
  openStream: (file) => Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>,
};

/**
 * Réponse pour une requête `jarvis-oww:`. `content-length` est toujours
 * présent (progression exacte côté transformers.js), `HEAD` ne lit rien,
 * et le fichier est diffusé en flux au lieu d'être chargé en mémoire.
 */
export async function serveVoiceAsset(
  request: Pick<Request, 'url' | 'method'>,
  root: string,
  fs: VoiceAssetFs = nodeFs,
  pathModule: PathModule = path,
): Promise<Response> {
  const cors = { 'access-control-allow-origin': '*' };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: cors });
  }
  const file = resolveVoiceAssetPath(root, request.url, pathModule);
  if (!file) return new Response('Requête refusée', { status: 400, headers: cors });
  let info: { isFile(): boolean; size: number };
  try {
    info = await fs.stat(file);
  } catch {
    return new Response('Fichier introuvable', { status: 404, headers: cors });
  }
  if (!info.isFile()) return new Response('Fichier introuvable', { status: 404, headers: cors });
  const headers = {
    ...cors,
    'content-type': voiceAssetContentType(file),
    'content-length': String(info.size),
    'cache-control': 'no-store',
  };
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(fs.openStream(file), { status: 200, headers });
}

/** À appeler après `app.whenReady()`. */
export function registerVoiceAssetsProtocol(): void {
  const root = currentVoiceAssetsRoot();
  protocol.handle(VOICE_ASSETS_PROTOCOL, (request) => serveVoiceAsset(request, root));
}

export interface VoiceAssetFileStatus {
  host: VoiceAssetHost;
  path: string;
  kind: VoiceAssetKind;
  exists: boolean;
  size: number;
  minBytes: number;
}

/** Vue disque des fichiers voix, pour le diagnostic « Tester la voix ». */
export async function inspectVoiceAssets(
  root: string,
  fs: Pick<VoiceAssetFs, 'stat'> = nodeFs,
  pathModule: PathModule = path,
): Promise<VoiceAssetFileStatus[]> {
  return Promise.all(
    REQUIRED_VOICE_ASSETS.map(async (asset) => {
      const file = pathModule.join(root, asset.host, ...asset.path.split('/'));
      try {
        const info = await fs.stat(file);
        return { ...asset, exists: info.isFile(), size: info.isFile() ? info.size : 0 };
      } catch {
        return { ...asset, exists: false, size: 0 };
      }
    }),
  );
}

export function currentVoiceAssetsRoot(): string {
  return voiceAssetsRoot({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
}

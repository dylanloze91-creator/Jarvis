/**
 * La fenêtre cachée de la webcam (Electron). Session à part (`yeux-webcam`) : la caméra y est
 * autorisée, en vidéo seulement ; tout le reste y est refusé (micro, notifications, écran…).
 * La session par défaut, celle de la fenêtre de Jarvis, n'est pas touchée : elle refuse toujours la caméra.
 */
import { BrowserWindow, session } from 'electron';
import { WEBCAM_PARTITION, type FenetreCapture } from './webcam.js';

/** Demande d'accès : seulement la vidéo, jamais l'audio. */
export function webcamAutorise(permission: string, mediaTypes: readonly string[] | undefined): boolean {
  if (permission !== 'media') return false;
  const types = mediaTypes ?? [];
  return types.length > 0 && types.every((type) => type === 'video');
}

let sessionPrete = false;

/**
 * `getUserMedia` exige un contexte sûr : `about:blank` n'en est pas un. La page vide est servie
 * par le schéma déjà privilégié `jarvis-oww:` (sûr, standard), mais SEULEMENT dans la session de
 * la webcam, et seulement cette adresse fixe : rien d'autre n'y est servi.
 */
export const WEBCAM_PAGE = 'jarvis-oww://webcam/';
const PAGE_VIDE = '<!doctype html><meta charset="utf-8"><title>webcam</title>';

function preparerSession(): Electron.Session {
  const s = session.fromPartition(WEBCAM_PARTITION, { cache: false });
  if (!sessionPrete) {
    s.setPermissionRequestHandler((_wc, permission, callback, details) => {
      callback(webcamAutorise(permission, (details as { mediaTypes?: string[] }).mediaTypes));
    });
    s.setPermissionCheckHandler((_wc, permission, _origin, details) => {
      return permission === 'media' && (details as { mediaType?: string }).mediaType === 'video';
    });
    s.protocol.handle('jarvis-oww', (request) =>
      request.url === WEBCAM_PAGE
        ? new Response(PAGE_VIDE, {
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'content-security-policy': "default-src 'none'; script-src 'none'",
            },
          })
        : new Response(null, { status: 404 }),
    );
    sessionPrete = true;
  }
  return s;
}

export function ouvrirFenetreWebcam(): FenetreCapture {
  const fenetre = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      session: preparerSession(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      javascript: true,
    },
  });
  // Aucune navigation possible : la page reste vide, seul le script de capture y tourne.
  fenetre.webContents.on('will-navigate', (event) => event.preventDefault());
  fenetre.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const prete = fenetre.loadURL(WEBCAM_PAGE);
  return {
    executer: async (script) => {
      await prete;
      if (fenetre.isDestroyed()) throw new Error('fenêtre fermée');
      return fenetre.webContents.executeJavaScript(script, true);
    },
    fermer: () => {
      if (!fenetre.isDestroyed()) fenetre.destroy();
    },
  };
}

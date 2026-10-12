import { join } from 'node:path';
import { BrowserWindow, screen, shell } from 'electron';
import { IpcChannel } from '../shared/ipc.js';

const WIDTH = 720;
const DEFAULT_HEIGHT = 520;
const MIN_HEIGHT = 132;
const MAX_HEIGHT = 700;
const DASHBOARD_WIDTH = 1360;
const DASHBOARD_HEIGHT = 860;
const WIDE_MIN = 1100;

/** Barre de titre Windows native (réduire, agrandir, fermer) + redimensionnement par les bords. */
const NATIVE_WIN_CAPTION = process.platform === 'win32';
const TITLE_BAR_OVERLAY_HEIGHT = 36;

export type WindowChrome = 'compact' | 'dashboard';

export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Position d'affichage : overlay en haut au centre, tableau de bord centré. */
export function overlayPosition(
  area: WorkArea,
  windowWidth: number,
  windowHeight: number,
): { x: number; y: number } {
  const dashboard = windowWidth > WIDTH + 40;
  return {
    x: Math.round(area.x + (area.width - windowWidth) / 2),
    y: Math.round(
      area.y +
        (dashboard
          ? Math.max(24, (area.height - windowHeight) / 2)
          : Math.max(64, area.height * 0.16)),
    ),
  };
}

export function isExternalHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Rechargement de l'interface elle-même (serveur Vite en dev, index.html empaqueté). */
export function isSameAppDocument(target: string, current: string): boolean {
  try {
    const next = new URL(target);
    const now = new URL(current);
    if (next.protocol === 'file:' || now.protocol === 'file:') {
      return next.protocol === now.protocol && next.pathname === now.pathname;
    }
    return next.origin === now.origin;
  } catch {
    return false;
  }
}

export interface OverlayWindow {
  browserWindow: BrowserWindow;
  toggle(): void;
  show(): void;
  hide(): void;
  setHideOnBlur(enabled: boolean): void;
  resize(height: number): void;
  setChrome(mode: WindowChrome): void;
}

/**
 * Fenêtre unique de l'assistant : sans cadre, translucide, au-dessus des autres
 * et absente de la barre des tâches. Par défaut elle reste visible si une autre
 * application prend le focus ; on ne la masque que via Ctrl+Espace, Échap,
 * le bouton fermer, ou le réglage optionnel « masquer au clic ailleurs ».
 */
export function createOverlayWindow(hideOnBlur: boolean): OverlayWindow {
  const browserWindow = new BrowserWindow({
    width: WIDTH,
    height: DEFAULT_HEIGHT,
    useContentSize: true,
    show: false,
    frame: !NATIVE_WIN_CAPTION,
    transparent: !NATIVE_WIN_CAPTION,
    resizable: NATIVE_WIN_CAPTION,
    movable: true,
    maximizable: NATIVE_WIN_CAPTION,
    minimizable: NATIVE_WIN_CAPTION,
    fullscreenable: false,
    skipTaskbar: !NATIVE_WIN_CAPTION,
    alwaysOnTop: !NATIVE_WIN_CAPTION,
    backgroundColor: NATIVE_WIN_CAPTION ? '#090f1b' : '#00000000',
    hasShadow: NATIVE_WIN_CAPTION,
    thickFrame: NATIVE_WIN_CAPTION,
    titleBarStyle: NATIVE_WIN_CAPTION ? 'hidden' : undefined,
    titleBarOverlay: NATIVE_WIN_CAPTION
      ? {
          color: '#090f1b',
          symbolColor: '#f4f7fb',
          height: TITLE_BAR_OVERLAY_HEIGHT,
        }
      : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Fenêtre masquée = écoute du mot de réveil : pas de minuteurs ralentis
      // (reprise du micro, fin de dictée) quand elle est en arrière-plan.
      backgroundThrottling: false,
    },
  });

  if (!NATIVE_WIN_CAPTION) {
    browserWindow.setAlwaysOnTop(true, 'screen-saver');
    browserWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  browserWindow.on('close', (event) => {
    event.preventDefault();
    browserWindow.hide();
  });

  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Un lien cliqué dans une réponse ne doit pas remplacer l'interface de
  // Jarvis par la page web (fenêtre sans cadre : aucun moyen de revenir).
  browserWindow.webContents.on('will-navigate', (event, url) => {
    if (isSameAppDocument(url, browserWindow.webContents.getURL())) return;
    event.preventDefault();
    if (isExternalHttpUrl(url)) void shell.openExternal(url);
  });

  let hideOnBlurEnabled = hideOnBlur;
  browserWindow.on('blur', () => {
    if (hideOnBlurEnabled && !browserWindow.webContents.isDevToolsOpened()) {
      browserWindow.hide();
    }
  });

  const position = (): void => {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const [windowWidth = WIDTH, windowHeight = DEFAULT_HEIGHT] = browserWindow.getSize();
    const { x, y } = overlayPosition(display.workArea, windowWidth, windowHeight);
    browserWindow.setPosition(x, y);
  };

  const show = (): void => {
    position();
    browserWindow.show();
    browserWindow.focus();
    browserWindow.webContents.send(IpcChannel.windowShown);
  };

  return {
    browserWindow,
    show,
    hide: () => browserWindow.hide(),
    toggle: () => (browserWindow.isVisible() ? browserWindow.hide() : show()),
    setHideOnBlur: (enabled) => {
      hideOnBlurEnabled = enabled;
    },
    resize: (height) => {
      if (NATIVE_WIN_CAPTION) return;
      const [currentWidth] = browserWindow.getContentSize();
      // Le tableau de bord occupe une fenêtre large : un resize « overlay »
      // tardif ne doit pas la rétrécir.
      if (currentWidth === undefined || currentWidth > WIDTH + 40) return;
      const clamped = Math.round(Math.min(Math.max(height, MIN_HEIGHT), MAX_HEIGHT));
      const [, current] = browserWindow.getContentSize();
      if (current === clamped) return;
      // Une fenêtre non redimensionnable ignore setContentSize sur plusieurs
      // plateformes : on lève la contrainte le temps de l'ajustement.
      browserWindow.setResizable(true);
      browserWindow.setContentSize(WIDTH, clamped, false);
      browserWindow.setResizable(false);
    },
    setChrome: (mode) => {
      const cursor = screen.getCursorScreenPoint();
      const display = screen.getDisplayNearestPoint(cursor);
      const { x, y, width, height } = display.workArea;
      browserWindow.setResizable(true);
      if (mode === 'compact') {
        browserWindow.setMinimumSize(WIDTH, MIN_HEIGHT);
        if (NATIVE_WIN_CAPTION) {
          browserWindow.setMaximizable(true);
          browserWindow.setResizable(true);
          if (!browserWindow.isMaximized()) {
            browserWindow.setContentSize(WIDTH, DEFAULT_HEIGHT);
          }
        } else {
          browserWindow.setMaximizable(false);
          browserWindow.setContentSize(WIDTH, DEFAULT_HEIGHT);
          browserWindow.setResizable(false);
        }
        browserWindow.setPosition(
          Math.round(x + (width - WIDTH) / 2),
          Math.round(y + Math.max(64, height * 0.16)),
        );
        return;
      }
      const nextWidth = Math.min(DASHBOARD_WIDTH, Math.max(WIDTH, width - 48));
      const nextHeight = Math.min(DASHBOARD_HEIGHT, Math.max(DEFAULT_HEIGHT, height - 48));
      browserWindow.setMaximizable(true);
      browserWindow.setMinimumSize(Math.min(WIDE_MIN, nextWidth), Math.min(680, nextHeight));
      browserWindow.setContentSize(nextWidth, nextHeight);
      browserWindow.setPosition(
        Math.round(x + (width - nextWidth) / 2),
        Math.round(y + Math.max(24, (height - nextHeight) / 2)),
      );
    },
  };
}

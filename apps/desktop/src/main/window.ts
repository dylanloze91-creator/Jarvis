import { join } from 'node:path';
import { BrowserWindow, screen, shell } from 'electron';

const WIDTH = 720;
const DEFAULT_HEIGHT = 520;
const MIN_HEIGHT = 132;

export interface OverlayWindow {
  browserWindow: BrowserWindow;
  toggle(): void;
  show(): void;
  hide(): void;
  setHideOnBlur(enabled: boolean): void;
  resize(height: number): void;
}

/**
 * Fenêtre unique de l'assistant : sans cadre, translucide, au-dessus des autres
 * et absente de la barre des tâches. Elle se comporte comme un lanceur, pas
 * comme une application classique.
 */
export function createOverlayWindow(hideOnBlur: boolean): OverlayWindow {
  const browserWindow = new BrowserWindow({
    width: WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: WIDTH,
    maxWidth: WIDTH,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  browserWindow.setAlwaysOnTop(true, 'screen-saver');
  browserWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
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
    const { x, y, width, height } = display.workArea;
    const [, windowHeight] = browserWindow.getSize();
    browserWindow.setPosition(
      Math.round(x + (width - WIDTH) / 2),
      Math.round(y + Math.max(64, height * 0.18 - (windowHeight ?? DEFAULT_HEIGHT) / 4)),
    );
  };

  const show = (): void => {
    position();
    browserWindow.show();
    browserWindow.focus();
    browserWindow.webContents.send('window:shown');
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
      const clamped = Math.round(Math.min(Math.max(height, MIN_HEIGHT), 760));
      const [, current] = browserWindow.getSize();
      if (current === clamped) return;
      browserWindow.setSize(WIDTH, clamped);
    },
  };
}

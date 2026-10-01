import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';
import type { WorkArea } from './window.js';

export const INDICATOR_WIDTH = 184;
export const INDICATOR_HEIGHT = 48;
const MARGIN = 16;

/** Coin haut-droit de la zone de travail (barre des tâches exclue), sur l'écran donné. */
export function indicatorPosition(area: WorkArea, width = INDICATOR_WIDTH, margin = MARGIN): { x: number; y: number } {
  return { x: Math.round(area.x + area.width - width - margin), y: Math.round(area.y + margin) };
}

export interface MainWindowState {
  visible: boolean;
  minimized: boolean;
  focused: boolean;
}

/** L'indicateur ne sert que si la fenêtre principale n'est pas sous les yeux de l'utilisateur. */
export function shouldShowIndicator(main: MainWindowState | null): boolean {
  if (!main) return true;
  return !main.visible || main.minimized || !main.focused;
}

/**
 * Petit indicateur « Jarvis écoute » en haut à droite, pendant la captation
 * d'une commande, quand la fenêtre principale est cachée, réduite ou sans
 * le focus. Traversé par la souris, jamais focalisable, absent de la barre
 * des tâches et d'Alt-Tab. Une page à part (`indicator.html`, preload
 * réduit) : elle n'ouvre pas le micro, elle reçoit seulement le niveau.
 */
export class ListeningIndicatorWindow {
  private window: BrowserWindow | null = null;
  private active = false;
  private ready: Promise<void> | null = null;
  private readonly refresh = (): void => this.apply();

  constructor(
    private readonly getMain: () => BrowserWindow | null,
    private readonly loadPage: (window: BrowserWindow) => Promise<void>,
  ) {}

  /** Écoute les changements de la fenêtre principale pendant une captation. */
  attachToMain(main: BrowserWindow): void {
    for (const event of ['show', 'hide', 'focus', 'blur', 'minimize', 'restore'] as const) {
      main.on(event as 'show', this.refresh);
    }
    // Une page rechargée ou plantée ne dira jamais « fin de captation ».
    main.webContents.on('did-start-loading', () => this.setActive(false));
    main.webContents.on('render-process-gone', () => this.setActive(false));
    main.on('closed', () => {
      this.setActive(false);
      if (this.window && !this.window.isDestroyed()) this.window.destroy();
    });
  }

  setActive(active: boolean): void {
    this.active = active;
    this.apply();
  }

  setLevel(level: number): void {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) return;
    this.window.webContents.send('indicator:level', Math.max(0, Math.min(1, level)));
  }

  private mainState(): MainWindowState | null {
    const main = this.getMain();
    if (!main || main.isDestroyed()) return null;
    return { visible: main.isVisible(), minimized: main.isMinimized(), focused: main.isFocused() };
  }

  private apply(): void {
    if (!this.active || !shouldShowIndicator(this.mainState())) {
      if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide();
      return;
    }
    const window = this.ensureWindow();
    void this.ready?.then(() => {
      if (!this.active || window.isDestroyed() || !shouldShowIndicator(this.mainState())) return;
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const { x, y } = indicatorPosition(display.workArea);
      window.setBounds({ x, y, width: INDICATOR_WIDTH, height: INDICATOR_HEIGHT });
      window.setAlwaysOnTop(true, 'screen-saver');
      window.showInactive();
    });
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = new BrowserWindow({
      width: INDICATOR_WIDTH,
      height: INDICATOR_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      // WS_EX_TOOLWINDOW : ni barre des tâches ni Alt-Tab.
      ...(process.platform === 'win32' ? { type: 'toolbar' } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/indicator.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    window.setIgnoreMouseEvents(true);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window = window;
    this.ready = this.loadPage(window).catch(() => undefined);
    return window;
  }
}

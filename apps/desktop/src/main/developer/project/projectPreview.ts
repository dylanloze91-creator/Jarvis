import { BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Aperçu local d’un projet web/jeu à côté de la discussion (5.0.4). */
export class ProjectPreviewWindow {
  private win: BrowserWindow | null = null;
  private projectId: string | null = null;

  close(): void {
    this.win?.close();
    this.win = null;
    this.projectId = null;
  }

  open(projectId: string, projectRoot: string, template: string | null): boolean {
    const index = join(projectRoot, 'index.html');
    if (!existsSync(index)) {
      this.close();
      return false;
    }
    const playable = template === 'web-game' || existsSync(join(projectRoot, 'src', 'game.ts'));
    if (!playable) {
      this.close();
      return false;
    }
    this.close();
    this.projectId = projectId;
    this.win = new BrowserWindow({
      width: 720,
      height: 480,
      title: `Aperçu — ${projectId}`,
      autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    void this.win.loadURL(pathToFileURL(index).href);
    this.win.on('closed', () => {
      this.win = null;
      this.projectId = null;
    });
    return true;
  }

  isOpen(projectId: string): boolean {
    return this.projectId === projectId && this.win !== null && !this.win.isDestroyed();
  }

  async capturePng(): Promise<Buffer | null> {
    if (!this.win || this.win.isDestroyed()) return null;
    const image = await this.win.webContents.capturePage();
    return image.toPNG();
  }
}

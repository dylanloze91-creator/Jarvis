import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import type { NodeTools } from '../task/suites.js';
import type { Runner } from '../runner.js';
import { serveStaticDir } from './localStaticServer.js';

export interface WebGameRuntimeResult {
  ok: boolean;
  detail: string;
  consoleErrors: string[];
}

/** Build Vite + ouverture Electron cachée : erreurs console remontées à la boucle de correction. */
export async function verifyWebGameRuntime(
  run: Runner,
  node: NodeTools,
  projectRoot: string,
  timeoutMs = 25_000,
): Promise<WebGameRuntimeResult> {
  const build = await run({
    program: node.nodePath,
    args: [node.npmCli, 'run', 'build'],
    cwd: projectRoot,
    display: 'npm run build',
    timeoutMs: 10 * 60_000,
    maxBytes: 400_000,
  });
  if (build.code !== 0) {
    return {
      ok: false,
      detail: `Build échoué : ${build.stderr.split('\n').slice(-3).join(' ')}`,
      consoleErrors: [],
    };
  }
  const dist = join(projectRoot, 'dist');
  if (!existsSync(join(dist, 'index.html'))) {
    return { ok: false, detail: 'Build sans dist/index.html.', consoleErrors: [] };
  }
  const server = await serveStaticDir(dist);
  const errors: string[] = [];
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  win.webContents.on('console-message', (_e, _level, message) => {
    if (/error|failed|blocked/i.test(message)) errors.push(message.slice(0, 240));
  });
  win.webContents.on('did-fail-load', (_event, code, description) => {
    errors.push(`Chargement Electron échoué (${code}) : ${description}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    errors.push(`Le renderer Electron s’est arrêté : ${details.reason}.`);
  });
  try {
    await Promise.race([
      win.loadURL(server.url),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Chargement > ${timeoutMs} ms`)), timeoutMs),
      ),
    ]);
    const visualDeadline = Date.now() + Math.min(8_000, timeoutMs);
    let visual = 'loading';
    while (Date.now() < visualDeadline && visual === 'loading' && errors.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      visual = await win.webContents.executeJavaScript(
        `(() => {
        const c = document.querySelector('canvas');
        if (!c || c.width < 2 || c.height < 2) return 'loading';
        const ctx = c.getContext('2d');
        if (!ctx) return 'no-ctx';
        const w = c.width, h = c.height;
        const d = ctx.getImageData(0, 0, w, h).data;
        if (!d.length) return 'loading';
        const first = d.slice(0, 4).join(',');
        for (let i = 4; i < d.length; i += 4) if (d.slice(i, i + 4).join(',') !== first) return 'ok';
        return document.readyState === 'complete' ? 'uniform-canvas' : 'loading';
      })()`,
      );
    }
    if (visual !== 'ok') {
      errors.push(
        visual === 'no-ctx'
          ? 'Canvas sans contexte 2D après chargement.'
          : visual === 'uniform-canvas'
            ? 'Canvas entier uniforme après 8 secondes (écran noir probable).'
            : 'Aucun canvas jouable détecté après 8 secondes.',
      );
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    win.destroy();
    await server.close();
  }
  if (errors.length) {
    return {
      ok: false,
      detail: errors[0]!,
      consoleErrors: errors,
    };
  }
  return { ok: true, detail: 'Build et aperçu local OK.', consoleErrors: [] };
}

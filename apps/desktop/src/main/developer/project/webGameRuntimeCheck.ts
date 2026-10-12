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
  try {
    await Promise.race([
      win.loadURL(server.url),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Chargement > ${timeoutMs} ms`)), timeoutMs),
      ),
    ]);
    await new Promise((r) => setTimeout(r, 800));
    const blank = await win.webContents.executeJavaScript(
      `(() => {
        const c = document.querySelector('canvas');
        if (!c) return 'no-canvas';
        const ctx = c.getContext('2d');
        if (!ctx) return 'no-ctx';
        const w = Math.min(32, c.width), h = Math.min(32, c.height);
        const d = ctx.getImageData(0, 0, w, h).data;
        const first = d.slice(0, 4).join(',');
        for (let i = 4; i < d.length; i += 4) if (d.slice(i, i + 4).join(',') !== first) return 'ok';
        return 'blank-canvas';
      })()`,
    );
    if (blank === 'blank-canvas' || blank === 'no-canvas') {
      errors.push(
        blank === 'no-canvas'
          ? 'Aucun canvas détecté après chargement.'
          : 'Canvas uniforme (écran noir probable).',
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

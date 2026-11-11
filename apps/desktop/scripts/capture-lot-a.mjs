#!/usr/bin/env node
/** Captures d’aperçu du lot A (Vite, hors Electron). */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.UI_BASE_URL ?? 'http://127.0.0.1:43173';
const OUT = process.env.CAPTURE_DIR ?? join(process.cwd(), 'rapports/lot-a-fiabilite-captures');
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const shots = [
  { scene: 'health', layout: 'dashboard', file: 'bilan.png', waitText: 'Ollama ne répond pas' },
  { scene: 'backup', layout: 'dashboard', file: 'sauvegarde.png', waitText: 'Sauvegarder maintenant' },
  { scene: 'know', layout: 'dashboard', file: 'savoir.png', waitText: 'Ce que Jarvis sait de moi' },
  { scene: 'dashboard-v2', layout: 'dashboard', file: 'accueil-bandeau.png', waitText: '2 choses à régler' },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
  defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
});

try {
  await mkdir(OUT, { recursive: true });
  for (const shot of shots) {
    const page = await browser.newPage();
    await page.goto(`${BASE}/?scene=${shot.scene}&layout=${shot.layout}`, { waitUntil: 'networkidle0', timeout: 120_000 });
    await page.waitForFunction(
      (text) => (document.body.textContent || '').includes(text),
      { timeout: 45_000 },
      shot.waitText,
    );
    await page.screenshot({ path: join(OUT, shot.file) });
    await page.close();
  }
} finally {
  await browser.close();
}

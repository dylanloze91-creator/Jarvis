#!/usr/bin/env node
/** Captures d’aperçu 5.0.70 — interface simple (Vite 43173). */
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.UI_BASE_URL ?? 'http://127.0.0.1:43173';
const OUT = process.env.CAPTURE_DIR ?? join(process.cwd(), 'rapports/interface-simple-5070-captures');
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const shots = [
  { scene: 'onboarding', layout: 'dashboard', file: 'onboarding.png', wait: 'Comment je t’appelle' },
  { scene: 'onboarding-summary', layout: 'dashboard', file: 'onboarding-summary.png', wait: 'Voici ce que je vais changer' },
  { scene: 'settings-v2', layout: 'dashboard', file: 'settings-v2.png', wait: 'Rechercher un réglage' },
  { scene: 'settings-search', layout: 'dashboard', file: 'settings-search.png', wait: 'Rechercher un réglage' },
  { scene: 'dashboard-v2', layout: 'dashboard', file: 'dashboard-v2.png', wait: 'JARVIS' },
  { scene: 'settings', layout: 'compact', file: 'settings-compact-before.png', wait: 'Rechercher un réglage' },
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
    await page.goto(`${BASE}/?scene=${shot.scene}&layout=${shot.layout}`, {
      waitUntil: 'networkidle0',
      timeout: 120_000,
    });
    await page.waitForSelector('[data-ui-ready="yes"]', { timeout: 45_000 }).catch(() => undefined);
    await page.waitForFunction(
      (text) => (document.body.textContent || '').includes(text),
      { timeout: 45_000 },
      shot.wait,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const path = join(OUT, shot.file);
    await page.screenshot({ path, type: 'png' });
    await page.close();
    const info = await stat(path);
    console.log(`OK ${path} (${info.size})`);
  }
} finally {
  await browser.close();
}

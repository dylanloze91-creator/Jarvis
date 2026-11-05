#!/usr/bin/env node
/** Captures d’aperçu 5.0.70 — interface simple (Vite 43173). */
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.UI_BASE_URL ?? 'http://127.0.0.1:43173';
const OUT = process.env.CAPTURE_DIR ?? join(process.cwd(), 'rapports/interface-simple-5070-captures');
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const shots = [
  { scene: 'onboarding', layout: 'compact', file: 'onboarding.png', waitText: 'Question 1' },
  {
    scene: 'onboarding-summary',
    layout: 'compact',
    file: 'onboarding-summary.png',
    waitText: 'Voici ce que je vais changer',
  },
  {
    scene: 'settings-v2',
    layout: 'dashboard',
    file: 'settings-v2.png',
    waitSelector: 'input[aria-label="Rechercher un réglage"]',
  },
  {
    scene: 'settings-search',
    layout: 'dashboard',
    file: 'settings-search.png',
    waitSelector: 'input[aria-label="Rechercher un réglage"]',
    search: 'spotify',
  },
  { scene: 'dashboard-v2', layout: 'dashboard', file: 'dashboard-v2.png', waitText: 'JARVIS' },
  {
    scene: 'settings',
    layout: 'compact',
    file: 'settings-compact-before.png',
    waitSelector: 'input[aria-label="Rechercher un réglage"]',
  },
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
    if (shot.waitSelector) {
      await page.waitForSelector(shot.waitSelector, { timeout: 45_000 });
    } else if (shot.waitText) {
      await page.waitForFunction(
        (text) => (document.body.textContent || '').toLowerCase().includes(text.toLowerCase()),
        { timeout: 45_000 },
        shot.waitText,
      );
    }
    if (shot.search) {
      const input = await page.waitForSelector('input[aria-label="Rechercher un réglage"]', { timeout: 10_000 });
      await input.type(shot.search);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const path = join(OUT, shot.file);
    await page.screenshot({ path, type: 'png' });
    await page.close();
    const info = await stat(path);
    if (info.size < 8000) {
      throw new Error(`${path} trop petit (${info.size} octets)`);
    }
    console.log(`OK ${path} (${info.size})`);
  }
} finally {
  await browser.close();
}

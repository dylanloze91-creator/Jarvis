#!/usr/bin/env node
/**
 * Capture les trois vues de l'interface (vide, conversation, réglages)
 * depuis le renderer Vite. Utilise Chrome headless déjà présent.
 */
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.UI_BASE_URL ?? 'http://127.0.0.1:43173';
const MEDIA = '/cursor/stores/bc-3a2e3f44-8967-432c-8f56-deb24a216831/media';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const shots = [
  { scene: 'empty', file: `${MEDIA}/ui-empty.png`, wait: 'Bonjour, je suis Jarvis' },
  { scene: 'chat', file: `${MEDIA}/ui-chat.png`, wait: 'actualités importantes' },
  { scene: 'settings', file: `${MEDIA}/ui-settings.png`, wait: 'web_research' },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
  defaultViewport: { width: 720, height: 820, deviceScaleFactor: 1 },
});

try {
  for (const shot of shots) {
    const page = await browser.newPage();
    await page.goto(`${BASE}/?scene=${shot.scene}`, { waitUntil: 'networkidle0', timeout: 60_000 });
    await page.waitForSelector('[data-ui-ready="yes"]', { timeout: 30_000 });
    await page.waitForFunction(
      (text) => (document.body.textContent || '').toLowerCase().includes(text.toLowerCase()),
      { timeout: 30_000 },
      shot.wait,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    await mkdir(dirname(shot.file), { recursive: true });
    await page.screenshot({ path: shot.file, type: 'png' });
    await page.close();
    const info = await stat(shot.file);
    if (info.size < 10_000) {
      throw new Error(`${shot.file} trop petit (${info.size} octets) — capture probablement vide.`);
    }
    console.log(`OK ${shot.file} (${info.size} octets)`);
  }
} finally {
  await browser.close();
}

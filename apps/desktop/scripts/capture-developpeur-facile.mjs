#!/usr/bin/env node
/**
 * Captures des cinq écrans de Jarvis Développeur facile depuis l'aperçu Vite
 * (`npx vite --config vite.ui.config.ts`, port 43173).
 */
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const BASE = process.env.UI_BASE_URL ?? 'http://127.0.0.1:43173';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const OUT = join(REPO, 'rapports/developpeur-facile-captures');

const names = ['1-tout-de-suite', '2-ce-que-j-ai-trouve', '3-il-construit-et-raconte', '4-une-question-a-la-fois', '5-c-est-pret'];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
  defaultViewport: { width: 720, height: 900, deviceScaleFactor: 1 },
});

try {
  await mkdir(OUT, { recursive: true });
  for (const [index, name] of names.entries()) {
    const page = await browser.newPage();
    await page.goto(`${BASE}/?scene=developer-facile-${index + 1}`, { waitUntil: 'networkidle0', timeout: 120_000 });
    await page.waitForSelector('[data-ui-ready="yes"]', { timeout: 60_000 });
    await page.waitForSelector('[data-chat-mission="facile"]', { timeout: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const file = join(OUT, `${name}.png`);
    await page.screenshot({ path: file, type: 'png' });
    await page.close();
    const info = await stat(file);
    if (info.size < 8000) throw new Error(`${file} trop petit (${info.size} octets).`);
    console.log(`OK ${file} (${info.size} octets)`);
  }
} finally {
  await browser.close();
}

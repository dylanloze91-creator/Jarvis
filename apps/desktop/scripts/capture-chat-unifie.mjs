#!/usr/bin/env node
/**
 * Captures des scènes Phase 1 chat unifié (5.0.68) depuis le renderer Vite.
 */
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const BASE = process.env.UI_BASE_URL ?? 'http://127.0.0.1:43173';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');

const shots = [
  {
    scene: 'chat-mission-proposal',
    file: join(REPO, 'rapports/chat-unifie-proposal.png'),
    selector: '[data-chat-mission="proposal"]',
  },
  {
    scene: 'chat-mission-track',
    file: join(REPO, 'rapports/chat-unifie-track.png'),
    selector: '[data-chat-mission="track"]',
  },
  {
    scene: 'chat-mission-report',
    file: join(REPO, 'rapports/chat-unifie-report.png'),
    selector: '[data-chat-mission="report"]',
  },
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
    await page.goto(`${BASE}/?scene=${shot.scene}`, { waitUntil: 'networkidle0', timeout: 120_000 });
    await page.waitForSelector('[data-ui-ready="yes"]', { timeout: 60_000 });
    await page.waitForSelector(shot.selector, { timeout: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await mkdir(dirname(shot.file), { recursive: true });
    await page.screenshot({ path: shot.file, type: 'png' });
    await page.close();
    const info = await stat(shot.file);
    if (info.size < 8000) {
      throw new Error(`${shot.file} trop petit (${info.size} octets).`);
    }
    console.log(`OK ${shot.file} (${info.size} octets)`);
  }
} finally {
  await browser.close();
}

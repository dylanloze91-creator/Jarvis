#!/usr/bin/env node
/**
 * Recopie les PNG et régénère setupGuideSteps.ts depuis le store projet.
 * Usage (chemins par défaut) : node scripts/sync-setup-tuto-from-store.mjs
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, '..');
const store =
  process.env.JARVIS_PROJECT_STORE ??
  '/cursor/stores/bc-3a2e3f44-8967-432c-8f56-deb24a216831';
const mdPath = join(store, 'docs/tuto-images-jarvis.md');
const pngSrc = join(store, 'media/tuto');
const pngDst = join(desktopRoot, 'src/renderer/src/assets/setup-tuto');
const stepsOut = join(desktopRoot, 'src/renderer/src/setupGuide/setupGuideSteps.ts');

mkdirSync(pngDst, { recursive: true });
for (const name of readdirSync(pngSrc).filter((f) => f.endsWith('.png'))) {
  copyFileSync(join(pngSrc, name), join(pngDst, name));
}

const md = readFileSync(mdPath, 'utf8');
let section = '';
const steps = [];
for (const line of md.split(/\r?\n/)) {
  if (line.startsWith('## ')) {
    section = line.slice(3).trim();
    continue;
  }
  const stepMatch = /^\*\*Étape ([^*]+)\*\* — (.+)$/.exec(line.trim());
  if (stepMatch) {
    steps.push({ id: stepMatch[1], text: stepMatch[2], section, image: null });
    continue;
  }
  const imgMatch = /^!\[[^\]]*\]\(.+\/([^/)]+)\.png\)/.exec(line.trim());
  if (imgMatch && steps.length && !steps[steps.length - 1].image) {
    steps[steps.length - 1].image = `${imgMatch[1]}.png`;
  }
}

if (steps.length !== 39 || steps.some((s) => !s.image)) {
  console.error('Étapes invalides', steps.length);
  process.exit(1);
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const body = steps
  .map(
    (s) =>
      `  { id: "${esc(s.id)}", section: "${esc(s.section)}", text: "${esc(s.text)}", image: "${s.image}" },`,
  )
  .join('\n');

writeFileSync(
  stepsOut,
  `/** Généré depuis docs/tuto-images-jarvis.md — ne pas éditer à la main. */\nexport type SetupGuideStep = { id: string; section: string; text: string; image: string };\n\nexport const SETUP_GUIDE_STEPS: SetupGuideStep[] = [\n${body}\n];\n`,
  'utf8',
);
console.log(`Sync OK : ${steps.length} images, ${stepsOut}`);

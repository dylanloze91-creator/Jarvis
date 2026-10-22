/**
 * Régénère le jeu depuis des dossiers déjà écrits.
 * --root : journal de production, lignes réelles si elles passent les contrôles.
 * --campaign : campagne isolée, étiquetée synthétique, hors du jeu réel.
 * N’entraîne pas et ne télécharge rien.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { buildFinetuneDataset, loadDatasetTree, writeDatasetDir } from '../dist/index.js';

function args(name) {
  const values = [];
  const all = process.argv.slice(2);
  for (let i = 0; i < all.length; i += 1) {
    if (all[i] === name && all[i + 1]) values.push(all[++i]);
  }
  return values;
}

const out = args('--out')[0];
if (!out) {
  console.error('usage: node scripts/export-dataset.mjs --out <dossier> [--root <userData>] [--campaign <dossier>]');
  process.exit(2);
}

const sources = [];
const lecture = [];

for (const root of args('--root')) {
  const loaded = await loadDatasetTree(root);
  lecture.push({ role: 'production', root, notes: loaded.notes, sources: loaded.sources.length });
  sources.push(...loaded.sources);
  if (loaded.sources.length === 0) {
    sources.push({
      id: `production-${lecture.length}`,
      kind: 'execution-log',
      origin: root,
      group: 'production',
      category: 'analysis',
      fields: [],
      verified: false,
      auditNote: 'aucun journal de production lisible',
      context: 'dossier de production',
      task: 'missions, index, bancs et exemples du poste',
    });
  }
}

for (const root of args('--campaign')) {
  const loaded = await loadDatasetTree(root);
  lecture.push({ role: 'campagne', root, notes: loaded.notes, sources: loaded.sources.length });
  for (const source of loaded.sources) {
    source.synthetic = true;
    source.origin = `campagne:${source.origin}`;
    sources.push(source);
  }
}

const build = buildFinetuneDataset(sources);
const written = await writeDatasetDir(out, build);
await mkdir(out, { recursive: true });
await writeFile(
  `${out}/lecture.json`,
  `${JSON.stringify({ lecture, readyForFinetune: build.manifest.readyForFinetune, reason: build.manifest.reason, kept: build.manifest.kept, collected: build.manifest.collected }, null, 2)}\n`,
  'utf8',
);
if (!written.ok) {
  console.error(written.errors.join('\n'));
  process.exit(1);
}
console.log(
  JSON.stringify({
    readyForFinetune: build.manifest.readyForFinetune,
    reason: build.manifest.reason,
    collected: build.manifest.collected,
    kept: build.manifest.kept,
    rejected: build.manifest.rejected,
    analysis: build.manifest.analysis,
    splits: build.manifest.splits,
    byCategory: build.manifest.byCategory,
  }),
);

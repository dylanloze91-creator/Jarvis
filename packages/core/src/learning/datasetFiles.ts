/**
 * Lecture et écriture du jeu. Ce fichier n’est pas exporté par l’index :
 * la fenêtre ne doit pas embarquer node:fs.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BenchResult } from '../developer/benchmarkTypes.js';
import type { MissionState } from '../developer/engine/mission.js';
import {
  checkDatasetFiles,
  datasetSourceFromExample,
  datasetSourceFromMission,
  datasetSourceFromRecord,
  datasetSourcesFromBench,
  renderDataset,
  type DatasetBuild,
  type DatasetFiles,
  type DatasetSource,
} from './dataset.js';
import type { LearningRecord } from './continuous.js';
import type { LocalLearningExample } from './types.js';

export interface DatasetLoad {
  sources: DatasetSource[];
  notes: string[];
}

/** Écrit le jeu. Un dossier déjà rempli est copié avant remplacement, puis le contrôle doit passer. */
export async function writeDatasetDir(dir: string, build: DatasetBuild): Promise<{ ok: boolean; errors: string[] }> {
  const files = renderDataset(build);
  const checked = checkDatasetFiles(files);
  if (!checked.ok) return checked;
  const manifestPath = join(dir, 'manifest.json');
  let backup: string | null = null;
  try {
    await readFile(manifestPath, 'utf8');
    backup = join(dir, 'backup-previous');
    await rm(backup, { recursive: true, force: true });
    await mkdir(backup, { recursive: true });
    for (const name of Object.keys(files)) {
      try {
        const current = await readFile(join(dir, name));
        await writeFile(join(backup, name), current);
      } catch {
        /* fichier absent dans l’ancien jeu */
      }
    }
  } catch {
    backup = null;
  }
  await mkdir(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(dir, name), contents, 'utf8');
  }
  const written: DatasetFiles = { ...files };
  for (const name of Object.keys(files) as (keyof DatasetFiles)[]) {
    written[name] = await readFile(join(dir, name), 'utf8');
  }
  const again = checkDatasetFiles(written);
  if (!again.ok && backup) {
    for (const name of Object.keys(files)) {
      try {
        const previous = await readFile(join(backup, name));
        await writeFile(join(dir, name), previous);
      } catch {
        await rm(join(dir, name), { force: true });
      }
    }
  }
  return again;
}

/** Relit les journaux, l’index et les bancs déjà sur le disque. N’invente aucune ligne. */
export async function loadDatasetTree(root: string): Promise<DatasetLoad> {
  const sources: DatasetSource[] = [];
  const notes: string[] = [];
  const files: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6 || files.length > 200) return;
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.git' || name === 'release' || name.startsWith('backup-')) continue;
      const path = join(dir, name);
      let info: { isDirectory(): boolean; isFile(): boolean; size: number };
      try {
        info = await stat(path);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        await walk(path, depth + 1);
        continue;
      }
      if (!info.isFile() || !name.endsWith('.json') || info.size > 2_000_000) continue;
      files.push(path);
    }
  }
  await walk(root, 0);
  notes.push(`${files.length} fichier(s) json lu(s) sous ${root}`);
  for (const path of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    } catch {
      notes.push(`illisible: ${path}`);
      continue;
    }
    if (path.endsWith('knowledge-index.json') && parsed && typeof parsed === 'object' && Array.isArray((parsed as { chunks?: unknown[] }).chunks)) {
      for (const chunk of (parsed as { chunks: { learning?: LearningRecord }[] }).chunks) {
        if (chunk.learning?.id && chunk.learning.type) sources.push(datasetSourceFromRecord(chunk.learning));
      }
      continue;
    }
    if (path.endsWith(join('learning', 'examples.json')) && Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === 'object' && typeof (item as LocalLearningExample).user === 'string') {
          sources.push(datasetSourceFromExample(item as LocalLearningExample));
        }
      }
      continue;
    }
    if (path.includes(join('missions', '')) && parsed && typeof parsed === 'object' && typeof (parsed as MissionState).request === 'string' && typeof (parsed as MissionState).id === 'string') {
      sources.push(datasetSourceFromMission(parsed as MissionState));
      continue;
    }
    if (path.includes(join('bench', '')) && parsed && typeof parsed === 'object' && Array.isArray((parsed as BenchResult).tasks)) {
      sources.push(...datasetSourcesFromBench(parsed as BenchResult));
    }
  }
  return { sources, notes };
}

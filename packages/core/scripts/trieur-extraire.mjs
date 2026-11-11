#!/usr/bin/env node
/**
 * Extraction des phrases utilisateur pour l'examen du trieur (5.0.68).
 *
 *   npm run trieur:extraire --workspace @jarvis/core -- --conversations <dossier> --dir C:\\dev\\jarvis-data\\trieur
 *   npm run trieur:extraire --workspace @jarvis/core -- --export-claude <dossier ou zip claude.ai> --dir C:\\dev\\jarvis-data\\trieur
 *
 * `--examen <nom>` écrit `a-trier-<nom>.jsonl` (examen à part, ex. phrases dites à Jarvis) sans toucher à `a-trier.jsonl`.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const here = new URL('.', import.meta.url);
let trieur;
let claudeExport;
try {
  trieur = await import(new URL('../dist/trieur/extract.js', here).href);
  claudeExport = await import(new URL('../dist/trieur/claudeExport.js', here).href);
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}

function parseArgs(argv) {
  let conversations = '';
  let exportClaude = '';
  let dir = 'C:\\dev\\jarvis-data\\trieur';
  let examName = '';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`valeur manquante après ${arg}`);
      i += 1;
      return v;
    };
    if (arg === '--conversations') conversations = next();
    else if (arg === '--export-claude') exportClaude = next();
    else if (arg === '--dir') dir = next();
    else if (arg === '--examen') examName = next();
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage : trieur:extraire -- --conversations <dossier Jarvis> | --export-claude <dossier ou .zip claude.ai> [--dir <données>] [--examen <nom>]',
      );
      process.exit(0);
    }
  }
  if (!conversations && !exportClaude) {
    throw new Error('indiquez --conversations et/ou --export-claude');
  }
  return {
    conversations: conversations ? resolve(conversations) : '',
    exportClaude: exportClaude ? resolve(exportClaude) : '',
    dir: resolve(dir),
    examName,
  };
}

async function findConversationsJsonInDir(dirPath) {
  const direct = join(dirPath, 'conversations.json');
  try {
    return await readFile(direct, 'utf8');
  } catch {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        return await readFile(join(dirPath, entry.name, 'conversations.json'), 'utf8');
      } catch {
        // dossier sans conversations.json
      }
    }
  }
  throw new Error(`conversations.json introuvable dans ${dirPath}`);
}

async function readConversationsJsonFromZip(zipPath) {
  const fromUnzip = spawnSync('unzip', ['-p', zipPath, 'conversations.json'], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (fromUnzip.status === 0 && fromUnzip.stdout) return fromUnzip.stdout;

  const tempDir = await mkdtemp(join(tmpdir(), 'jarvis-claude-export-'));
  try {
    const tar = spawnSync('tar', ['-xf', zipPath, '-C', tempDir], { encoding: 'utf8' });
    if (tar.status !== 0) {
      throw new Error('impossible de lire le zip (essayez de le décompresser dans un dossier)');
    }
    return await findConversationsJsonInDir(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function loadClaudeExport(exportPath) {
  const info = await stat(exportPath);
  const raw = info.isDirectory()
    ? await findConversationsJsonInDir(exportPath)
    : exportPath.toLowerCase().endsWith('.zip')
      ? await readConversationsJsonFromZip(exportPath)
      : await readFile(exportPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('conversations.json doit être un tableau');
  return parsed;
}

const options = parseArgs(process.argv.slice(2));
const files = (await import(new URL('../dist/trieur/files.js', here).href)).trieurFileNames(options.dir, options.examName || undefined);
await mkdir(options.dir, { recursive: true });

const groups = [];

if (options.conversations) {
  let jsonFiles = [];
  try {
    jsonFiles = (await readdir(options.conversations)).filter((name) => name.endsWith('.json'));
  } catch {
    console.error(`Dossier introuvable : ${options.conversations}`);
    process.exit(1);
  }
  const conversations = [];
  for (const file of jsonFiles) {
    try {
      conversations.push(JSON.parse(await readFile(join(options.conversations, file), 'utf8')));
    } catch {
      // fichier corrompu ignoré
    }
  }
  groups.push(trieur.extractFromConversations(conversations));
}

if (options.exportClaude) {
  try {
    const claudeConversations = await loadClaudeExport(options.exportClaude);
    groups.push(claudeExport.extractFromClaudeExport(claudeConversations));
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(1);
  }
}

const lines = groups.length === 1 ? groups[0] : claudeExport.mergeToSortLines(...groups);
const body = `${lines.map((line) => JSON.stringify(line)).join('\n')}${lines.length ? '\n' : ''}`;
await writeFile(files.toSort, body, 'utf8');
console.log(`${lines.length} phrase(s) écrites dans ${files.toSort}`);

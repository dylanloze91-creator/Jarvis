import { spawn } from 'node:child_process';
import { z } from 'zod';
import { defineTool } from '@jarvis/core';
import { findAlias, normalizeAppName } from './platform/app-aliases.js';
import { psQuote, run, runPowerShell } from './platform/exec.js';

export const openApplicationTool = defineTool({
  name: 'open_application',
  description:
    'Ouvre une application par son nom courant (« Chrome », « Photoshop », « Bloc-notes »…), en la résolvant sur le système plutôt que de demander un chemin absolu.',
  risk: 'confirm',
  category: 'apps',
  isDestructive: false,
  schema: z.object({
    name: z.string().min(1).max(120).describe("Nom courant de l'application à ouvrir."),
  }),
  summarize: ({ name }) => `Ouvrir l'application « ${name} ».`,
  execute: async ({ name }) => {
    if (process.platform === 'win32') return openWindows(name);
    if (process.platform === 'darwin') return openMac(name);
    if (process.platform === 'linux') return openLinux(name);
    return {
      ok: false,
      content: `Ouverture d'application non prise en charge sur ${process.platform}.`,
    };
  },
});

export const closeApplicationTool = defineTool({
  name: 'close_application',
  description:
    "Ferme une application par son nom courant. Tente d'abord une fermeture propre ; `forceKill` termine le processus immédiatement (perte de travail non sauvegardé possible).",
  risk: 'confirm',
  category: 'apps',
  isDestructive: (input: { forceKill?: boolean }) => Boolean(input.forceKill),
  schema: z.object({
    name: z
      .string()
      .min(1)
      .max(120)
      .describe("Nom courant de l'application ou du processus à fermer."),
    forceKill: z
      .boolean()
      .default(false)
      .describe('Terminer le processus immédiatement au lieu de demander une fermeture propre.'),
  }),
  summarize: ({ name, forceKill }) =>
    forceKill
      ? `Terminer immédiatement le processus « ${name} » (travail non sauvegardé perdu).`
      : `Fermer l'application « ${name} ».`,
  execute: async ({ name, forceKill }) => {
    if (process.platform === 'win32') return closeWindows(name, forceKill);
    return closePosix(name, forceKill);
  },
});

// --- Windows ---------------------------------------------------------------

async function openWindows(name: string) {
  const alias = findAlias(name);
  const candidate = alias?.win ?? name;

  const directTry = await runPowerShell(`Start-Process ${psQuote(candidate)} -ErrorAction Stop`, {
    timeoutMs: 10_000,
  });
  if (directTry.code === 0) {
    return { ok: true, content: `Application lancée : ${candidate}` };
  }

  const query = normalizeAppName(name).replace(/\s+/g, '*');
  const searchScript = `
$roots = @($env:ProgramFiles, \${env:ProgramFiles(x86)}, "$env:LOCALAPPDATA\\Programs", $env:LOCALAPPDATA) | Where-Object { $_ }
$match = Get-ChildItem -Path $roots -Recurse -Depth 3 -Filter "*${query}*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($match) { Start-Process -FilePath $match.FullName -ErrorAction Stop; Write-Output $match.FullName }
else { throw "introuvable" }
`.trim();

  const searchTry = await runPowerShell(searchScript, { timeoutMs: 20_000 });
  if (searchTry.code === 0 && searchTry.stdout.trim()) {
    return { ok: true, content: `Application lancée : ${searchTry.stdout.trim()}` };
  }

  return {
    ok: false,
    content: `Application « ${name} » introuvable sur cette machine. Vérifie le nom ou indique le chemin exact via run_command.`,
  };
}

async function closeWindows(name: string, forceKill: boolean) {
  const alias = findAlias(name);
  const processHint = alias?.win?.replace(/\.exe$/i, '') ?? name;
  const script = `
$targets = Get-Process | Where-Object { $_.ProcessName -like "*${processHint}*" -or $_.MainWindowTitle -like "*${name}*" }
if (-not $targets) { throw "introuvable" }
foreach ($p in $targets) {
  if (${forceKill ? '$true' : '$false'}) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  } else {
    $closed = $p.CloseMainWindow()
    if (-not $closed) { Stop-Process -Id $p.Id -ErrorAction SilentlyContinue }
  }
}
($targets | Select-Object -ExpandProperty ProcessName -Unique) -join ', '
`.trim();

  const result = await runPowerShell(script, { timeoutMs: 10_000 });
  if (result.code !== 0) {
    return { ok: false, content: `Aucun processus correspondant à « ${name} » n'a été trouvé.` };
  }
  return { ok: true, content: `Fermé : ${result.stdout.trim() || name}` };
}

// --- macOS -------------------------------------------------------------

async function openMac(name: string) {
  const alias = findAlias(name);
  const candidate = alias?.mac ?? name;
  const result = await run('open', ['-a', candidate], { timeoutMs: 10_000 });
  if (result.code === 0) return { ok: true, content: `Application lancée : ${candidate}` };
  return {
    ok: false,
    content: `Application « ${name} » introuvable (${result.stderr || 'échec de open -a'}).`,
  };
}

async function closePosix(name: string, forceKill: boolean) {
  if (process.platform === 'darwin') {
    const alias = findAlias(name);
    const candidate = alias?.mac ?? name;
    const script = forceKill
      ? `tell application "${candidate.replace(/"/g, '\\"')}" to quit`
      : `tell application "${candidate.replace(/"/g, '\\"')}" to quit`;
    const result = await run('osascript', ['-e', script], { timeoutMs: 10_000 });
    if (result.code === 0) return { ok: true, content: `Fermé : ${candidate}` };
    return {
      ok: false,
      content: `Impossible de fermer « ${name} » (${result.stderr || 'erreur osascript'}).`,
    };
  }
  return closeLinux(name, forceKill);
}

// --- Linux ---------------------------------------------------------------

async function openLinux(name: string) {
  const alias = findAlias(name);
  const candidates = alias?.linux ?? [normalizeAppName(name).replace(/\s+/g, '-')];

  for (const candidate of candidates) {
    const found = await run('which', [candidate], { timeoutMs: 5_000 });
    if (found.code === 0 && found.stdout.trim()) {
      const exe = found.stdout.trim();
      const child = spawn(exe, [], { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true, content: `Application lancée : ${exe}` };
    }
  }

  return {
    ok: false,
    content: `Application « ${name} » introuvable sur ce système Linux (essayé : ${candidates.join(', ')}). Sur Windows, la résolution est plus large (recherche dans les dossiers d'installation).`,
  };
}

async function closeLinux(name: string, forceKill: boolean) {
  const alias = findAlias(name);
  const candidates = alias?.linux ?? [normalizeAppName(name).replace(/\s+/g, '-'), name];
  const pattern = candidates.join('|');

  const pgrep = await run('pgrep', ['-if', pattern], { timeoutMs: 5_000 });
  const pids = pgrep.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (pids.length === 0) {
    return { ok: false, content: `Aucun processus correspondant à « ${name} » n'a été trouvé.` };
  }

  const signal = forceKill ? '-KILL' : '-TERM';
  const result = await run('kill', [signal, ...pids], { timeoutMs: 5_000 });
  if (result.code !== 0 && result.code !== null) {
    return {
      ok: false,
      content: `Échec de la fermeture de « ${name} » : ${result.stderr || 'erreur inconnue'}`,
    };
  }
  return {
    ok: true,
    content: `Signal envoyé à ${pids.length} processus correspondant à « ${name} ».`,
  };
}

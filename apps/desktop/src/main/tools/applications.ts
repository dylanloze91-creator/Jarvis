import { spawn } from 'node:child_process';
import { z } from 'zod';
import { defineTool } from '@jarvis/core';
import { launchSpotifyDesktop } from '../media/launchSpotifyDesktop.js';
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
    if (isSpotifyAppName(name)) return openSpotify();
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

function isSpotifyAppName(name: string): boolean {
  return findAlias(name)?.names.includes('spotify') === true || normalizeAppName(name) === 'spotify';
}

async function openSpotify() {
  const launched = await launchSpotifyDesktop();
  if (launched.ok) {
    return { ok: true, content: `Application lancée : Spotify (${launched.detail}).` };
  }
  return {
    ok: false,
    content: `Impossible d'ouvrir Spotify : ${launched.detail}`,
  };
}

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
$query = ${psQuote(query)}
$roots = @($env:ProgramFiles, \${env:ProgramFiles(x86)}, "$env:LOCALAPPDATA\\Programs", $env:LOCALAPPDATA) | Where-Object { $_ }
$match = Get-ChildItem -Path $roots -Recurse -Depth 3 -Filter ('*' + $query + '*.exe') -ErrorAction SilentlyContinue | Select-Object -First 1
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

/**
 * 5.0.64 (revue, point 5) : un seul délai pour toute la fermeture, quel que soit
 * le nombre de processus. Avant, chaque processus attendait jusqu'à 3 s l'un après
 * l'autre : Discord, Teams, Spotify ou VS Code (5 à 10 processus) dépassaient les
 * 15 s du script, et Jarvis répondait « aucun processus » à tort.
 */
export const CLOSE_WINDOWS_WAIT_MS = 5_000;
/** Marge pour le démarrage de PowerShell et `Get-Process` au-dessus du délai partagé. */
export const CLOSE_WINDOWS_SCRIPT_MARGIN_MS = 10_000;

/**
 * Script PowerShell de `close_application`, exporté pour les tests (qui ne
 * lancent jamais PowerShell). Le nom vient du modèle : uniquement en chaîne
 * entre apostrophes (`psQuote`), jamais interpolé dans des guillemets doubles
 * (où `$(...)` s'exécuterait).
 *
 * - `$deadline` est calculé une fois pour tous les processus ; la boucle s'arrête
 *   dès qu'ils ont tous disparu ou quand le délai partagé est écoulé.
 * - `HasExited` et `Stop-Process` peuvent lever une erreur d'accès (processus lancé
 *   en administrateur) : elle est attrapée et le processus est rapporté dans
 *   `DENIED=`, au lieu de faire échouer tout le script.
 */
export function buildCloseWindowsScript(
  name: string,
  processHint: string,
  forceKill: boolean,
): string {
  return `
$hint = [WildcardPattern]::Escape(${psQuote(processHint)})
$title = [WildcardPattern]::Escape(${psQuote(name)})
$targets = @(Get-Process | Where-Object { $_.ProcessName -like ('*' + $hint + '*') -or $_.MainWindowTitle -like ('*' + $title + '*') })
if ($targets.Count -eq 0) { throw "introuvable" }
$denied = @{}
function Test-Exited($proc) {
  try { return [bool]$proc.HasExited } catch { return $null }
}
foreach ($p in $targets) {
  try {
    if (${forceKill ? '$true' : '$false'}) {
      Stop-Process -Id $p.Id -Force -ErrorAction Stop
    } else {
      $closed = $p.CloseMainWindow()
      if (-not $closed) { Stop-Process -Id $p.Id -ErrorAction Stop }
    }
  } catch {
    if ((Test-Exited $p) -ne $true) { $denied[$p.Id] = $p.ProcessName }
  }
}
$deadline = [DateTime]::UtcNow.AddMilliseconds(${CLOSE_WINDOWS_WAIT_MS})
while ($true) {
  $pending = @($targets | Where-Object { -not $denied.ContainsKey($_.Id) -and (Test-Exited $_) -eq $false })
  if ($pending.Count -eq 0 -or [DateTime]::UtcNow -ge $deadline) { break }
  Start-Sleep -Milliseconds 200
}
$gone = @(); $still = @()
foreach ($p in $targets) {
  if ($denied.ContainsKey($p.Id)) { continue }
  $exited = Test-Exited $p
  if ($null -eq $exited) { $denied[$p.Id] = $p.ProcessName }
  elseif ($exited) { $gone += $p.ProcessName }
  else { $still += $p.ProcessName }
}
'GONE=' + (($gone | Select-Object -Unique) -join ', ')
'STILL=' + (($still | Select-Object -Unique) -join ', ')
'DENIED=' + (($denied.Values | Select-Object -Unique) -join ', ')
`.trim();
}

export async function closeWindows(name: string, forceKill: boolean) {
  const alias = findAlias(name);
  const processHint = alias?.win?.replace(/\.exe$/i, '') ?? name;
  const script = buildCloseWindowsScript(name, processHint, forceKill);

  const result = await runPowerShell(script, {
    timeoutMs: CLOSE_WINDOWS_WAIT_MS + CLOSE_WINDOWS_SCRIPT_MARGIN_MS,
  });
  if (result.timedOut) {
    return {
      ok: false,
      content: `La fermeture de « ${name} » a dépassé le délai (${Math.round((CLOSE_WINDOWS_WAIT_MS + CLOSE_WINDOWS_SCRIPT_MARGIN_MS) / 1000)} s) : Windows n'a pas répondu à temps. Vérifie si l'application est encore ouverte.`,
    };
  }
  if (result.code !== 0) {
    return { ok: false, content: `Aucun processus correspondant à « ${name} » n'a été trouvé.` };
  }
  return describeCloseResult(name, result.stdout);
}

/**
 * 5.0.64 : « Fermé » n'est dit que si le processus a disparu. `CloseMainWindow()`
 * ne fait que demander la fermeture : une application avec un document non
 * enregistré reste ouverte sur sa boîte de dialogue, et Jarvis répondait « Fermé ».
 * `DENIED=` (revue, point 5) : processus dont l'état n'a pas pu être lu ou qui n'ont
 * pas pu être arrêtés (accès refusé) ; dit tel quel, jamais « fermé ».
 */
export function describeCloseResult(name: string, stdout: string): { ok: boolean; content: string } {
  const gone = /^GONE=(.*)$/m.exec(stdout)?.[1]?.trim() ?? '';
  const still = /^STILL=(.*)$/m.exec(stdout)?.[1]?.trim() ?? '';
  const denied = /^DENIED=(.*)$/m.exec(stdout)?.[1]?.trim() ?? '';
  if (!gone && !still && !denied) return { ok: true, content: `Fermé : ${stdout.trim() || name}` };
  const stillNames = new Set(
    still
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  );
  const closedNames = gone
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !stillNames.has(part));
  const parts: string[] = [];
  if (still) {
    parts.push(
      `« ${still} » est toujours ouvert : l'application attend sans doute une réponse (document à enregistrer ?).`,
    );
  }
  if (denied) {
    parts.push(
      `Accès refusé pour « ${denied} » : ce programme tourne sans doute en administrateur, Jarvis ne peut pas le fermer.`,
    );
  }
  if (closedNames.length)
    parts.push(`Fermé : ${closedNames.join(', ')}${parts.length ? '.' : ''}`);
  return { ok: !still && !denied, content: parts.join(' ') };
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

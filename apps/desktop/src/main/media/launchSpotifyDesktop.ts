import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { shell } from 'electron';
import { psQuote, run, runPowerShell } from '../tools/platform/exec.js';

export interface LaunchSpotifyResult {
  ok: boolean;
  detail: string;
}

/**
 * Emplacements classiques du client Windows. `Start-Process Spotify.exe`
 * échoue souvent : Win32 → `%APPDATA%\Spotify`, Store → WindowsApps
 * (le `Spotify.exe` racine est souvent un alias 0 octet).
 */
export function windowsSpotifyExeCandidates(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const appData = env.APPDATA ?? '';
  const local = env.LOCALAPPDATA ?? '';
  const home = env.USERPROFILE ?? '';
  const programFiles = env.ProgramFiles ?? env['ProgramFiles'] ?? '';
  const programFilesX86 = env['ProgramFiles(x86)'] ?? '';
  return [
    join(appData, 'Spotify', 'Spotify.exe'),
    join(local, 'Spotify', 'Spotify.exe'),
    join(home, 'AppData', 'Roaming', 'Spotify', 'Spotify.exe'),
    join(local, 'Microsoft', 'WindowsApps', 'Spotify.exe'),
    join(programFiles, 'Spotify', 'Spotify.exe'),
    join(programFilesX86, 'Spotify', 'Spotify.exe'),
    join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Spotify.lnk'),
    join(env.ProgramData ?? 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Spotify.lnk'),
  ].filter((path) => /Spotify\.(exe|lnk)$/i.test(path) && path.replace(/[/\\]+$/u, '').length > 12);
}

async function isUsableFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function windowsAppsPackageExes(localAppData: string): Promise<string[]> {
  const root = join(localAppData, 'Microsoft', 'WindowsApps');
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /spotify/i.test(entry.name))
      .map((entry) => join(root, entry.name, 'Spotify.exe'));
  } catch {
    return [];
  }
}

export async function launchSpotifyDesktop(): Promise<LaunchSpotifyResult> {
  if (process.platform === 'win32') return launchWindows();
  if (process.platform === 'darwin') {
    const result = await run('open', ['-a', 'Spotify'], { timeoutMs: 10_000 });
    if (result.code === 0) return { ok: true, detail: 'open -a Spotify' };
    return { ok: false, detail: result.stderr || 'open -a Spotify a échoué' };
  }
  const which = await run('which', ['spotify'], { timeoutMs: 5_000 });
  if (which.code === 0 && which.stdout.trim()) {
    spawn(which.stdout.trim(), [], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, detail: which.stdout.trim() };
  }
  return { ok: false, detail: 'client Spotify introuvable' };
}

async function launchWindows(): Promise<LaunchSpotifyResult> {
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    ...windowsSpotifyExeCandidates(),
    ...(await windowsAppsPackageExes(local)),
  ];

  for (const exe of candidates) {
    if (exe.toLowerCase().endsWith('.lnk')) continue;
    if (!(await isUsableFile(exe))) continue;
    const started = await runPowerShell(`Start-Process -FilePath ${psQuote(exe)}`, {
      timeoutMs: 10_000,
    });
    if (started.code === 0) return { ok: true, detail: exe };
  }

  const resolved = await resolveSpotifyPathViaPowerShell();
  for (const exe of resolved) {
    const started = await runPowerShell(`Start-Process -FilePath ${psQuote(exe)}`, {
      timeoutMs: 10_000,
    });
    if (started.code === 0) return { ok: true, detail: exe };
  }

  const startApps = await runPowerShell(
    `$app = Get-StartApps | Where-Object { $_.Name -like '*Spotify*' } | Select-Object -First 1
if ($app) { Start-Process ("shell:AppsFolder\\" + $app.AppID); Write-Output $app.AppID }
else { throw 'introuvable' }`,
    { timeoutMs: 15_000 },
  );
  if (startApps.code === 0 && startApps.stdout.trim()) {
    return { ok: true, detail: `AppsFolder:${startApps.stdout.trim()}` };
  }

  try {
    await shell.openExternal('spotify:');
    return { ok: true, detail: 'spotify:' };
  } catch {
    // Protocole non enregistré.
  }

  const protocol = await runPowerShell(`Start-Process ${psQuote('spotify:')}`, {
    timeoutMs: 10_000,
  });
  if (protocol.code === 0) return { ok: true, detail: 'spotify:' };

  const byName = await runPowerShell(`Start-Process ${psQuote('Spotify.exe')}`, {
    timeoutMs: 10_000,
  });
  if (byName.code === 0) return { ok: true, detail: 'Spotify.exe' };

  return {
    ok: false,
    detail:
      "Spotify.exe introuvable (AppData\\Spotify, WindowsApps, menu Démarrer, protocole spotify:). Installe l'application de bureau Windows.",
  };
}

async function resolveSpotifyPathViaPowerShell(): Promise<string[]> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$found = @()
foreach ($root in @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Spotify.exe',
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Spotify.exe'
)) {
  $p = (Get-ItemProperty $root).'(default)'
  if ($p) { $found += $p }
}
$w = New-Object -ComObject WScript.Shell
Get-ChildItem -Path @("$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs", "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs") -Filter '*Spotify*.lnk' -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
  $target = $w.CreateShortcut($_.FullName).TargetPath
  if ($target) { $found += $target }
}
Get-AppxPackage *Spotify* | ForEach-Object {
  Get-ChildItem $_.InstallLocation -Filter Spotify.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 2 | ForEach-Object { $found += $_.FullName }
}
$found | Where-Object { $_ -and (Test-Path $_) -and ((Get-Item $_).Length -gt 0) } | Select-Object -Unique
`.trim();
  const result = await runPowerShell(script, { timeoutMs: 15_000 });
  if (result.code !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

import { z } from 'zod';
import { defineTool } from '@jarvis/core';
import { run, runPowerShell } from './platform/exec.js';

export const getActiveWindowTool = defineTool({
  name: 'get_active_window',
  description:
    "Retourne le titre de la fenêtre active et la liste des applications qui ont une fenêtre ouverte. À utiliser quand l'utilisateur demande ce qu'il a d'ouvert ou sur quoi il travaille.",
  risk: 'safe',
  schema: z.object({}),
  execute: async () => {
    if (process.platform === 'win32') return activeWindowWindows();
    if (process.platform === 'darwin') return activeWindowMac();
    if (process.platform === 'linux') return activeWindowLinux();
    return {
      ok: false,
      content: `Détection de la fenêtre active non prise en charge sur cette plateforme (${process.platform}).`,
    };
  },
});

async function activeWindowWindows() {
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
}
'@
$h = [Win32]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][Win32]::GetWindowText($h, $sb, 512)
$active = $sb.ToString()
$open = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object ProcessName,MainWindowTitle
[PSCustomObject]@{ active = $active; open = $open } | ConvertTo-Json -Compress -Depth 3
`.trim();

  const result = await runPowerShell(script, { timeoutMs: 10_000 });
  if (result.code !== 0 || result.timedOut) {
    return {
      ok: false,
      content: `Impossible d'interroger la fenêtre active : ${result.stderr || 'erreur PowerShell'}.`,
    };
  }
  try {
    const parsed = JSON.parse(result.stdout) as {
      active: string;
      open:
        | { ProcessName: string; MainWindowTitle: string }[]
        | { ProcessName: string; MainWindowTitle: string };
    };
    const openList = Array.isArray(parsed.open) ? parsed.open : parsed.open ? [parsed.open] : [];
    return summarize(
      parsed.active || null,
      openList.map((w) => `${w.ProcessName} — ${w.MainWindowTitle}`),
    );
  } catch (error) {
    return { ok: false, content: `Réponse inattendue de PowerShell : ${describeError(error)}` };
  }
}

async function activeWindowMac() {
  const script =
    'tell application "System Events" to get {name of first application process whose frontmost is true, name of front window of (first application process whose frontmost is true)}';
  const result = await run('osascript', ['-e', script], { timeoutMs: 10_000 });
  if (result.code !== 0) {
    return {
      ok: false,
      content: `Impossible d'interroger la fenêtre active : ${result.stderr || 'erreur osascript'}.`,
    };
  }
  return summarize(result.stdout.trim() || null, []);
}

async function activeWindowLinux() {
  const idResult = await run('xdotool', ['getactivewindow'], { timeoutMs: 5_000 });
  if (idResult.code !== 0) {
    return {
      ok: false,
      content:
        "Impossible de détecter la fenêtre active : `xdotool` est absent ou aucune fenêtre n'a le focus sur ce serveur d'affichage.",
    };
  }
  const windowId = idResult.stdout.trim();
  const nameResult = await run('xdotool', ['getwindowname', windowId], { timeoutMs: 5_000 });
  const active = nameResult.code === 0 ? nameResult.stdout.trim() : null;

  let openTitles: string[] = [];
  const listResult = await run('xdotool', ['search', '--name', '', 'getwindowname', '%@'], {
    timeoutMs: 5_000,
  });
  if (listResult.code === 0) {
    openTitles = listResult.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  return summarize(active, openTitles);
}

function summarize(active: string | null, open: string[]) {
  const uniqueOpen = [...new Set(open.filter(Boolean))];
  const lines = [
    `Fenêtre active : ${active || 'aucune détectée'}`,
    uniqueOpen.length > 0
      ? `Fenêtres ouvertes (${uniqueOpen.length}) :\n${uniqueOpen.map((w) => `- ${w}`).join('\n')}`
      : 'Aucune autre fenêtre détectée.',
  ];
  return { ok: true, content: lines.join('\n\n'), data: { active, open: uniqueOpen } };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

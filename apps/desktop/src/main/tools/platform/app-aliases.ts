export interface AppAlias {
  /** Toutes les façons dont l'utilisateur peut nommer l'application, en minuscules sans accents. */
  names: string[];
  /** Nom de l'exécutable Windows, résolu via App Paths ou %PATH%. */
  win?: string;
  /** Nom de l'application telle qu'enregistrée par macOS (`open -a`). */
  mac?: string;
  /** Noms de binaires candidats sur Linux, essayés dans l'ordre. */
  linux?: string[];
}

/**
 * Table de correspondance entre noms courants (français et anglais) et
 * exécutables réels. Volontairement non exhaustive : les applications
 * absentes retombent sur la résolution générique (recherche dans les
 * dossiers d'installation usuels, ou `which` sur Linux).
 */
export const APP_ALIASES: AppAlias[] = [
  {
    names: ['chrome', 'google chrome'],
    win: 'chrome.exe',
    mac: 'Google Chrome',
    linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
  },
  { names: ['firefox'], win: 'firefox.exe', mac: 'Firefox', linux: ['firefox'] },
  {
    names: ['edge', 'microsoft edge'],
    win: 'msedge.exe',
    mac: 'Microsoft Edge',
    linux: ['microsoft-edge', 'microsoft-edge-stable'],
  },
  {
    names: ['bloc-notes', 'bloc notes', 'notepad'],
    win: 'notepad.exe',
    mac: 'TextEdit',
    linux: ['gedit', 'xed', 'gnome-text-editor', 'kate'],
  },
  {
    names: ['explorateur', 'explorateur de fichiers', 'explorer', 'file explorer'],
    win: 'explorer.exe',
    mac: 'Finder',
    linux: ['nautilus', 'dolphin', 'pcmanfm', 'nemo'],
  },
  {
    names: ['calculatrice', 'calculator'],
    win: 'calc.exe',
    mac: 'Calculator',
    linux: ['gnome-calculator', 'kcalc', 'xcalc'],
  },
  { names: ['word', 'microsoft word'], win: 'winword.exe', mac: 'Microsoft Word' },
  { names: ['excel', 'microsoft excel'], win: 'excel.exe', mac: 'Microsoft Excel' },
  {
    names: ['powerpoint', 'microsoft powerpoint'],
    win: 'powerpnt.exe',
    mac: 'Microsoft PowerPoint',
  },
  { names: ['outlook', 'microsoft outlook'], win: 'outlook.exe', mac: 'Microsoft Outlook' },
  { names: ['photoshop', 'adobe photoshop'], win: 'Photoshop.exe', mac: 'Adobe Photoshop 2024' },
  { names: ['spotify'], win: 'Spotify.exe', mac: 'Spotify', linux: ['spotify'] },
  {
    names: ['vscode', 'visual studio code', 'code', 'vs code'],
    win: 'Code.exe',
    mac: 'Visual Studio Code',
    linux: ['code'],
  },
  { names: ['paint', 'mspaint'], win: 'mspaint.exe', linux: ['pinta', 'gimp'] },
  {
    names: ['terminal', 'invite de commandes', 'command prompt', 'cmd'],
    win: 'cmd.exe',
    mac: 'Terminal',
    linux: ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'],
  },
  {
    names: ['powershell', 'windows powershell'],
    win: 'powershell.exe',
  },
  { names: ['discord'], win: 'Discord.exe', mac: 'Discord', linux: ['discord'] },
  { names: ['slack'], win: 'slack.exe', mac: 'Slack', linux: ['slack'] },
  { names: ['steam'], win: 'steam.exe', mac: 'Steam', linux: ['steam'] },
  { names: ['vlc'], win: 'vlc.exe', mac: 'VLC', linux: ['vlc'] },
];

export function normalizeAppName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function findAlias(name: string): AppAlias | undefined {
  const normalized = normalizeAppName(name);
  return APP_ALIASES.find((alias) => alias.names.includes(normalized));
}

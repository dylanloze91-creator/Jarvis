/** Copie de travail de Jarvis : où la chercher, et comment savoir si c'est la bonne. */
export const JARVIS_REPO_URL = 'https://github.com/dylanloze91-creator/Jarvis.git';
/** Dossier court, hors OneDrive (décision 2). */
export const SUGGESTED_REPO_PATH = 'C:\\dev\\Jarvis';

export type DevCheckStatus = 'ok' | 'warn' | 'fail';

export interface DevCheck {
  id: string;
  label: string;
  status: DevCheckStatus;
  detail: string;
  /** Commande à lancer soi-même (jamais lancée par Jarvis). */
  command?: string;
}

export interface CheckReport {
  ok: boolean;
  checks: DevCheck[];
}

export interface RepoFacts {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  hasGit: boolean;
  rootPackageName?: string | null;
  desktopPackageName?: string | null;
  desktopVersion?: string | null;
  originUrl?: string | null;
  branch?: string | null;
  head?: string | null;
  dirtyFiles?: number | null;
  hasNodeModules?: boolean;
}

export function candidateRepoPaths(env: { platform: string; home: string }): string[] {
  const { home } = env;
  if (env.platform === 'win32') {
    return [
      SUGGESTED_REPO_PATH,
      `${home}\\dev\\Jarvis`,
      `${home}\\source\\repos\\Jarvis`,
      `${home}\\Documents\\Jarvis`,
      `${home}\\Jarvis`,
      'D:\\dev\\Jarvis',
    ];
  }
  return [`${home}/dev/Jarvis`, `${home}/Jarvis`, `${home}/src/Jarvis`];
}

export function compareVersions(a: string, b: string): number {
  const parts = (value: string) =>
    value
      .replace(/^v/, '')
      .split(/[-+]/)[0]!
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function normalizeRemote(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^git@([^:]+):/, '$1/')
    .replace(/^(https?|ssh|git):\/\/([^@/]+@)?/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
}

export function isJarvisRemote(url: string | null | undefined): boolean {
  return Boolean(url) && normalizeRemote(url!) === normalizeRemote(JARVIS_REPO_URL);
}

/** OneDrive synchronise Documents chez beaucoup d'utilisateurs : 1,1 Go de dépendances y seraient envoyés. */
export function isOneDrivePath(path: string, oneDriveRoots: string[] = []): boolean {
  const lower = path.toLowerCase().replace(/\//g, '\\');
  if (/\\onedrive( - [^\\]+)?(\\|$)/.test(lower)) return true;
  return oneDriveRoots.some(
    (root) => root && lower.startsWith(root.toLowerCase().replace(/\//g, '\\')),
  );
}

export function validateRepo(
  facts: RepoFacts,
  installedVersion: string,
  oneDriveRoots: string[] = [],
): CheckReport {
  const checks: DevCheck[] = [];
  const add = (
    id: string,
    label: string,
    status: DevCheckStatus,
    detail: string,
    command?: string,
  ) => checks.push({ id, label, status, detail, ...(command ? { command } : {}) });

  if (!facts.exists || !facts.isDirectory) {
    add(
      'folder',
      'Dossier',
      'fail',
      `« ${facts.path} » n’existe pas encore. Jarvis peut cloner le code ici, avec ta confirmation.`,
    );
    return { ok: false, checks };
  }
  add('folder', 'Dossier', 'ok', facts.path);
  if (!facts.hasGit) {
    add('git', 'Dépôt Git', 'fail', 'Ce dossier n’est pas un dépôt Git (pas de dossier .git).');
  } else {
    add(
      'git',
      'Dépôt Git',
      'ok',
      `Branche ${facts.branch ?? '?'}${facts.head ? `, commit ${facts.head.slice(0, 7)}` : ''}${facts.dirtyFiles ? `, ${facts.dirtyFiles} fichier(s) modifié(s)` : ''}`,
    );
  }
  const isJarvis =
    facts.rootPackageName === 'jarvis' && facts.desktopPackageName === '@jarvis/desktop';
  add(
    'package',
    'Code de Jarvis',
    isJarvis ? 'ok' : 'fail',
    isJarvis
      ? 'package.json « jarvis » et « @jarvis/desktop » trouvés.'
      : 'Ce n’est pas le code de Jarvis (package.json attendus absents).',
  );
  if (!facts.desktopVersion) {
    add('version', 'Version', 'fail', 'Version de @jarvis/desktop introuvable.');
  } else if (compareVersions(facts.desktopVersion, installedVersion) < 0) {
    add(
      'version',
      'Version',
      'fail',
      `Copie en ${facts.desktopVersion}, plus ancienne que le Jarvis installé (${installedVersion}). Mets-la à jour (git pull) avant de travailler dessus.`,
      'git pull',
    );
  } else {
    add(
      'version',
      'Version',
      'ok',
      `${facts.desktopVersion} (Jarvis installé : ${installedVersion})`,
    );
  }
  if (!facts.originUrl)
    add('remote', 'Dépôt d’origine', 'warn', 'Pas de dépôt distant « origin ».');
  else
    add(
      'remote',
      'Dépôt d’origine',
      isJarvisRemote(facts.originUrl) ? 'ok' : 'warn',
      isJarvisRemote(facts.originUrl)
        ? 'github.com/dylanloze91-creator/Jarvis'
        : `Autre dépôt : ${facts.originUrl}`,
    );
  if (isOneDrivePath(facts.path, oneDriveRoots))
    add(
      'onedrive',
      'Synchronisation',
      'warn',
      'Ce dossier est dans OneDrive : préfère C:\\dev\\Jarvis (dépendances lourdes, fichiers verrouillés).',
    );
  add(
    'dependencies',
    'Dépendances',
    facts.hasNodeModules ? 'ok' : 'warn',
    facts.hasNodeModules
      ? 'node_modules présent.'
      : 'Pas encore installées : « Installer les dépendances » lance npm ci, avec ta confirmation.',
  );
  return { ok: checks.every((check) => check.status !== 'fail'), checks };
}

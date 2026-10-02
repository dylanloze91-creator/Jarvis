import { compareVersions, type CheckReport, type DevCheck } from './repoCheck.js';

export const MIN_NODE_VERSION = '20.19.0';
export const RECOMMENDED_NODE_MAJOR = 22;
/** Code, dépendances (~1,1 Go), une copie isolée et de la marge. */
export const MIN_FREE_BYTES = 5 * 1024 ** 3;

export const INSTALL_COMMANDS = {
  git: 'winget install --id Git.Git -e',
  node: 'winget install --id OpenJS.NodeJS.LTS -e',
  longPaths: 'git config --global core.longpaths true',
} as const;

export interface EnvironmentFacts {
  platform: string;
  /** Sortie brute de `git --version`, ou null si Git est introuvable. */
  gitVersion: string | null;
  nodeVersion: string | null;
  npmVersion: string | null;
  freeBytes: number | null;
  /** Dossier dont le disque a été mesuré. */
  diskPath: string;
  longPaths: boolean | null;
}

export function parseToolVersion(output: string | null): string | null {
  const match = output?.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;
  return `${Math.round(bytes / 1024 ** 2).toLocaleString('fr-FR')} Mo`;
}

export function checkEnvironment(facts: EnvironmentFacts): CheckReport {
  const checks: DevCheck[] = [];
  const git = parseToolVersion(facts.gitVersion);
  checks.push(
    git
      ? { id: 'git', label: 'Git', status: 'ok', detail: `Git ${git}` }
      : {
          id: 'git',
          label: 'Git',
          status: 'fail',
          detail: 'Git n’est pas installé (ou pas dans le PATH). Installe-le toi-même :',
          command: INSTALL_COMMANDS.git,
        },
  );
  const node = parseToolVersion(facts.nodeVersion);
  if (!node) {
    checks.push({
      id: 'node',
      label: 'Node.js',
      status: 'fail',
      detail: 'Node.js n’est pas installé. Installe la version LTS toi-même :',
      command: INSTALL_COMMANDS.node,
    });
  } else if (compareVersions(node, MIN_NODE_VERSION) < 0) {
    checks.push({
      id: 'node',
      label: 'Node.js',
      status: 'fail',
      detail: `Node ${node} est trop ancien (minimum ${MIN_NODE_VERSION}). Mets à jour :`,
      command: INSTALL_COMMANDS.node,
    });
  } else if (Number.parseInt(node, 10) < RECOMMENDED_NODE_MAJOR) {
    checks.push({
      id: 'node',
      label: 'Node.js',
      status: 'warn',
      detail: `Node ${node} fonctionne ; la version ${RECOMMENDED_NODE_MAJOR} LTS est conseillée.`,
      command: INSTALL_COMMANDS.node,
    });
  } else {
    checks.push({ id: 'node', label: 'Node.js', status: 'ok', detail: `Node ${node}` });
  }
  const npm = parseToolVersion(facts.npmVersion);
  checks.push(
    npm
      ? { id: 'npm', label: 'npm', status: 'ok', detail: `npm ${npm}` }
      : {
          id: 'npm',
          label: 'npm',
          status: 'fail',
          detail: 'npm est introuvable (il s’installe avec Node.js).',
          command: INSTALL_COMMANDS.node,
        },
  );
  if (facts.freeBytes === null) {
    checks.push({
      id: 'disk',
      label: 'Disque',
      status: 'warn',
      detail: `Espace libre inconnu sur ${facts.diskPath}.`,
    });
  } else {
    const ok = facts.freeBytes >= MIN_FREE_BYTES;
    checks.push({
      id: 'disk',
      label: 'Disque',
      status: ok ? 'ok' : 'fail',
      detail: `${formatBytes(facts.freeBytes)} libres sur ${facts.diskPath}${ok ? '' : ` : il faut au moins ${formatBytes(MIN_FREE_BYTES)}`}.`,
    });
  }
  if (facts.platform === 'win32' && git && facts.longPaths === false) {
    checks.push({
      id: 'longpaths',
      label: 'Chemins longs',
      status: 'warn',
      detail: 'Git n’accepte pas encore les chemins longs de node_modules. À lancer toi-même :',
      command: INSTALL_COMMANDS.longPaths,
    });
  }
  return { ok: checks.every((check) => check.status !== 'fail'), checks };
}

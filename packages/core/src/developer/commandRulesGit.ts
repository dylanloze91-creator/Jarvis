import { finding, type Finding, type SegmentContext } from './commandSafetyTypes.js';

/** Clés de configuration qui peuvent lancer un programme, changer les accès ou cacher un alias. */
const DANGEROUS_GIT_CONFIG =
  /^(alias\.|core\.(sshcommand|hookspath|fsmonitor|pager|editor|askpass|gitproxy|worktree)|credential|url\.|https?\.|protocol\.|diff\.external|diff\..*\.(textconv|command)|filter\.|gpg\.|sequence\.editor|merge\..*\.driver|remote\..*\.(pushurl|receivepack|uploadpack|proxy|url)|include\.|includeif\.|uploadpack\.|receive\.)/;

const READ_ONLY = new Set([
  'status',
  'log',
  'diff',
  'show',
  'rev-parse',
  'ls-files',
  'ls-tree',
  'grep',
  'blame',
  'describe',
  'shortlog',
  'cat-file',
  'rev-list',
  'show-ref',
  'for-each-ref',
  'name-rev',
  'whatchanged',
  'version',
  'help',
  'count-objects',
  'check-ignore',
  'merge-base',
  'var',
  'show-branch',
]);

const VALUE_GLOBALS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--super-prefix',
  '--config-env',
]);
const FLAG_GLOBALS = new Set([
  '--no-pager',
  '-p',
  '--paginate',
  '-P',
  '--bare',
  '--no-replace-objects',
  '--literal-pathspecs',
  '--glob-pathspecs',
  '--noglob-pathspecs',
  '--icase-pathspecs',
  '--no-optional-locks',
  '--no-lazy-fetch',
]);

const SANDBOX_BRANCH = /^jarvis-dev\/[A-Za-z0-9._/-]+$/;

function configKey(value: string): string {
  return (value.split('=')[0] ?? '').trim().toLowerCase();
}

export function gitRules(args: string[], ctx: SegmentContext): Finding[] {
  const out: Finding[] = [];
  let otherRepo = false;
  let i = 0;
  while (i < args.length && args[i]!.startsWith('-')) {
    const raw = args[i]!;
    const [name, inline] = raw.includes('=')
      ? [raw.slice(0, raw.indexOf('=')), raw.slice(raw.indexOf('=') + 1)]
      : [raw, null];
    if (raw === '--version' || raw === '--help' || raw === '-h')
      return [finding('confirm', 'information sur git')];
    if (VALUE_GLOBALS.has(name)) {
      const value = inline ?? args[i + 1] ?? '';
      if (name === '-c' || name === '--config-env') {
        if (DANGEROUS_GIT_CONFIG.test(configKey(value))) {
          out.push(
            finding(
              'denied',
              `configuration git « ${configKey(value)} » : peut lancer un programme ou changer les accès`,
            ),
          );
        } else {
          out.push(finding('always-confirm', 'configuration git temporaire'));
        }
      } else {
        otherRepo = true;
        out.push(finding('always-confirm', 'agit sur un autre dossier ou dépôt git'));
      }
      i += inline === null ? 2 : 1;
      continue;
    }
    if (!FLAG_GLOBALS.has(raw))
      out.push(finding('always-confirm', `option git inconnue « ${raw} »`));
    i += 1;
  }

  const sub = (args[i] ?? '').toLowerCase();
  const rest = args.slice(i + 1);
  const lower = rest.map((value) => value.toLowerCase());
  const has = (...flags: string[]): boolean => lower.some((value) => flags.includes(value));
  const sandboxOk =
    ctx.insideSandbox === true &&
    ctx.single &&
    ctx.plain &&
    !otherRepo &&
    SANDBOX_BRANCH.test(ctx.branch ?? '');
  const destructive = (what: string): Finding =>
    sandboxOk
      ? finding('always-confirm', `${what} (branche ${ctx.branch} de la copie isolée)`)
      : finding('denied', `${what} : seulement sur une branche jarvis-dev/* de la copie isolée`);

  if (!sub) return [...out, finding('confirm', 'git sans sous-commande')];
  if (
    lower.some(
      (value) =>
        value.startsWith('--upload-pack') ||
        value.startsWith('--receive-pack') ||
        (value === '-u' && sub === 'clone'),
    )
  ) {
    out.push(finding('denied', 'option git qui lance un programme distant'));
  }
  if (
    sub === 'grep' &&
    lower.some((value) => value === '-o' || value.startsWith('--open-files-in-pager'))
  ) {
    out.push(finding('denied', 'git grep qui ouvre un programme'));
  }
  for (let k = 0; k < rest.length; k += 1) {
    if (
      (lower[k] === '-c' || lower[k] === '--config') &&
      rest[k + 1] &&
      DANGEROUS_GIT_CONFIG.test(configKey(rest[k + 1]!))
    ) {
      out.push(
        finding(
          'denied',
          `configuration git « ${configKey(rest[k + 1]!)} » : peut lancer un programme ou changer les accès`,
        ),
      );
    }
  }

  switch (sub) {
    case 'push':
      return [
        ...out,
        finding('denied', 'publication sur GitHub (git push) : Jarvis ne publie jamais'),
      ];
    case 'send-email':
      return [...out, finding('denied', 'envoi de code par e-mail')];
    case 'credential':
    case 'credential-store':
    case 'credential-cache':
    case 'credential-manager':
    case 'credential-manager-core':
      return [...out, finding('denied', 'identifiants git (secrets)')];
    case 'lfs':
      return [
        ...out,
        lower[0] === 'push'
          ? finding('denied', 'publication (git lfs push)')
          : finding('always-confirm', 'git lfs'),
      ];
    case 'filter-branch':
    case 'filter-repo':
    case 'replace':
    case 'update-ref':
    case 'fast-import':
    case 'rebase':
      return [...out, finding('denied', `réécriture de l’historique (git ${sub})`)];
    case 'reflog':
      return [
        ...out,
        has('expire', 'delete')
          ? finding('denied', 'efface l’historique de secours (reflog)')
          : finding('confirm', 'lecture git'),
      ];
    case 'gc':
      return [
        ...out,
        lower.some((value) => value.startsWith('--prune'))
          ? finding('denied', 'efface définitivement des versions (gc --prune)')
          : finding('always-confirm', 'maintenance git'),
      ];
    case 'commit':
      return [
        ...out,
        has('--amend')
          ? finding('denied', 'réécriture de l’historique (commit --amend)')
          : finding('confirm', 'crée un point de reprise (commit)'),
      ];
    case 'reset': {
      if (has('--hard', '--merge', '--keep'))
        return [...out, destructive('efface les modifications (git reset --hard)')];
      const target = rest.find(
        (value, index) => !value.startsWith('-') && !rest.slice(0, index).includes('--'),
      );
      if (target && /^(head[~^@]|[0-9a-f]{7,40}$|origin\/|@\{|.*[~^]\d*$)/i.test(target)) {
        return [...out, destructive('déplace la branche (git reset vers une version)')];
      }
      return [...out, finding('confirm', 'retire des fichiers de l’index')];
    }
    case 'clean':
      return [
        ...out,
        lower.some((value) => /^-[a-z]*f/.test(value) || value === '--force')
          ? destructive('supprime les fichiers non suivis (git clean -f)')
          : finding('confirm', 'liste les fichiers non suivis'),
      ];
    case 'checkout': {
      const discard =
        rest.includes('-B') ||
        has('-f', '--force', '.', '--ours', '--theirs') ||
        rest.includes('--');
      return [
        ...out,
        discard
          ? destructive('écrase des fichiers ou une branche (git checkout)')
          : finding('confirm', 'change de branche'),
      ];
    }
    case 'restore':
      return [
        ...out,
        lower.length > 0 &&
        lower.every((value) => value === '--staged' || value === '-s' || !value.startsWith('-')) &&
        has('--staged') &&
        !has('--worktree', '-w')
          ? finding('confirm', 'retire des fichiers de l’index')
          : destructive('efface des modifications (git restore)'),
      ];
    case 'switch':
      return [
        ...out,
        rest.includes('-C') || has('--force-create', '--discard-changes', '-f', '--force')
          ? destructive('écrase une branche ou des modifications (git switch)')
          : finding('confirm', 'change de branche'),
      ];
    case 'stash':
      if (has('drop', 'clear'))
        return [...out, destructive('efface des modifications mises de côté')];
      return [
        ...out,
        has('pop', 'apply', 'branch')
          ? finding('always-confirm', 'réapplique des modifications')
          : finding('confirm', 'met des modifications de côté'),
      ];
    case 'branch':
      return [...out, ...branchRules(rest, lower, ctx, sandboxOk)];
    case 'tag':
      return [
        ...out,
        rest.length === 0 || has('-l', '--list')
          ? finding('confirm', 'liste les étiquettes')
          : finding('always-confirm', 'crée ou supprime une étiquette locale'),
      ];
    case 'remote':
      return [
        ...out,
        rest.length === 0 || has('-v', '--verbose', 'get-url', 'show')
          ? finding('confirm', 'lecture git')
          : finding('always-confirm', 'modifie les dépôts distants'),
      ];
    case 'config':
      return [...out, ...configRules(rest, lower)];
    case 'worktree':
      return [...out, ...worktreeRules(rest, lower, destructive)];
    case 'clone':
      return [
        ...out,
        finding('always-confirm', 'télécharge un dépôt (réseau) et écrit un dossier'),
      ];
    case 'fetch':
    case 'pull':
    case 'submodule':
      return [...out, finding('always-confirm', `réseau (git ${sub})`)];
    case 'add':
    case 'init':
      return [...out, finding('confirm', `git ${sub}`)];
    case 'rm':
      return [
        ...out,
        lower.some((value) => /^-[a-z]*r/.test(value))
          ? destructive('suppression récursive (git rm -r)')
          : finding('always-confirm', 'supprime un fichier suivi'),
      ];
    case 'mv':
    case 'merge':
    case 'cherry-pick':
    case 'revert':
    case 'am':
    case 'apply':
    case 'notes':
    case 'archive':
    case 'bundle':
    case 'format-patch':
    case 'mergetool':
    case 'difftool':
      return [...out, finding('always-confirm', `modifie le dépôt ou lance un outil (git ${sub})`)];
    default:
      if (READ_ONLY.has(sub)) {
        return [
          ...out,
          has('--ext-diff')
            ? finding('always-confirm', 'diff externe')
            : finding('confirm', 'lecture git'),
        ];
      }
      return [
        ...out,
        finding(
          'denied',
          `sous-commande git inconnue « ${sub} » : peut être un alias (par exemple de push)`,
        ),
      ];
  }
}

function branchRules(
  rest: string[],
  lower: string[],
  ctx: SegmentContext,
  sandboxOk: boolean,
): Finding[] {
  const targets = rest.filter((value) => !value.startsWith('-'));
  const force =
    rest.includes('-D') ||
    rest.includes('-M') ||
    rest.includes('-C') ||
    lower.includes('-f') ||
    lower.includes('--force');
  const deletes = rest.includes('-d') || rest.includes('-D') || lower.includes('--delete');
  if (force || deletes) {
    const allSandbox = targets.length > 0 && targets.every((name) => SANDBOX_BRANCH.test(name));
    return allSandbox && (sandboxOk || ctx.insideSandbox === true)
      ? [finding('always-confirm', 'supprime ou force une branche jarvis-dev/*')]
      : [finding('denied', 'supprime ou force une branche qui n’est pas jarvis-dev/*')];
  }
  if (rest.includes('-m') || lower.includes('--move'))
    return [finding('always-confirm', 'renomme une branche')];
  if (targets.length === 0) return [finding('confirm', 'liste les branches')];
  return [finding('confirm', 'crée une branche')];
}

function configRules(rest: string[], lower: string[]): Finding[] {
  const key = configKey(rest.find((value) => !value.startsWith('-')) ?? '');
  const reads = lower.some((value) =>
    ['--get', '--get-all', '--get-regexp', '--list', '-l', '--show-origin'].includes(value),
  );
  if (/^credential|token|password|secret/.test(key))
    return [finding('denied', 'configuration git liée aux identifiants')];
  if (reads || !key) return [finding('confirm', 'lecture de la configuration git')];
  if (DANGEROUS_GIT_CONFIG.test(key))
    return [
      finding(
        'denied',
        `configuration git « ${key} » : peut lancer un programme ou changer les accès`,
      ),
    ];
  return [finding('always-confirm', 'modifie la configuration git')];
}

function worktreeRules(
  rest: string[],
  lower: string[],
  destructive: (what: string) => Finding,
): Finding[] {
  const action = lower[0] ?? '';
  if (action === 'list' || action === '') return [finding('confirm', 'liste les copies isolées')];
  if (action === 'add') {
    return rest.some((value) => SANDBOX_BRANCH.test(value))
      ? [finding('confirm', 'crée une copie isolée jarvis-dev/*')]
      : [finding('always-confirm', 'crée une copie de travail hors jarvis-dev/*')];
  }
  if (action === 'remove')
    return [
      lower.includes('--force') || lower.includes('-f')
        ? destructive('supprime une copie isolée de force')
        : finding('always-confirm', 'supprime une copie isolée'),
    ];
  return [finding('always-confirm', `git worktree ${action}`)];
}

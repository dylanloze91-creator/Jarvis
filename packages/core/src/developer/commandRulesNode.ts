import {
  finding,
  isSafeRelativePath,
  maxLevel,
  type Finding,
  type SegmentContext,
} from './commandSafetyTypes.js';

export const KNOWN_WORKSPACES = new Set([
  '@jarvis/core',
  '@jarvis/desktop',
  'packages/core',
  'apps/desktop',
]);
/** Scripts autorisés automatiquement (dans le bac à sable seulement). */
export const AUTO_SCRIPTS = new Set(['test', 'typecheck', 'lint']);

const ACCOUNT = new Set([
  'publish',
  'unpublish',
  'deprecate',
  'owner',
  'author',
  'access',
  'team',
  'token',
  'adduser',
  'add-user',
  'login',
  'logout',
  'whoami',
  'profile',
  'org',
  'hook',
  'star',
  'unstar',
  'dist-tag',
  'dist-tags',
  'trust',
]);
const INSTALL = new Set([
  'i',
  'in',
  'ins',
  'inst',
  'insta',
  'instal',
  'install',
  'isnt',
  'isnta',
  'isntal',
  'isntall',
  'add',
  'ci',
  'clean-install',
  'ic',
  'install-clean',
  'isntall-clean',
  'install-ci-test',
  'cit',
  'it',
  'install-test',
  'un',
  'uninstall',
  'remove',
  'rm',
  'r',
  'unlink',
  'up',
  'update',
  'upgrade',
  'udpate',
  'link',
  'ln',
  'rebuild',
  'rb',
  'dedupe',
  'ddp',
  'prune',
  'audit',
  'pack',
  'version',
  'init',
  'create',
  'innit',
  'set-script',
]);
const READ = new Set([
  'ls',
  'list',
  'll',
  'la',
  'outdated',
  'view',
  'info',
  'show',
  'v',
  'explain',
  'why',
  'help',
  'doctor',
  'prefix',
  'root',
  'bin',
  'fund',
  'search',
  'find',
  's',
  'se',
  'query',
  'sbom',
  'ping',
]);
const RUN = new Set(['run', 'run-script', 'rum', 'urn']);
const TEST = new Set(['t', 'tst', 'test']);
const VALUE_OPTIONS = new Set([
  '-w',
  '--workspace',
  '--prefix',
  '-C',
  '--userconfig',
  '--globalconfig',
  '--registry',
  '--script-shell',
  '--node-options',
  '--cache',
  '--loglevel',
]);
const SAFE_OPTIONS = new Set([
  '--workspaces',
  '-ws',
  '--if-present',
  '--silent',
  '-s',
  '--no-audit',
  '--no-fund',
  '--include-workspace-root',
]);

const PUBLISH_PACKAGES = new Set([
  'np',
  'release-it',
  'semantic-release',
  'gh-pages',
  'vercel',
  'netlify',
  'netlify-cli',
  'surge',
  'firebase',
  'firebase-tools',
  'clasp',
  'wrangler',
  'publish',
  'pkg-publish',
  'electron-publish',
  'ovsx',
  'vsce',
  '@vscode/vsce',
]);
const DELETE_PACKAGES = new Set(['rimraf', 'del-cli', 'trash-cli', 'trash', 'rm-rf', 'premove']);
const SAFE_TEST_PATH = /\.test\.(ts|tsx|mts|cts|js|mjs)$/;
const SAFE_TSCONFIG = /^[\w./-]*tsconfig[\w.-]*\.json$/;

interface NpmCall {
  sub: string;
  rest: string[];
  options: Array<{ name: string; value: string | null }>;
}

function splitNpm(args: string[]): NpmCall {
  const options: NpmCall['options'] = [];
  let sub = '';
  const rest: string[] = [];
  let passthrough = false;
  for (let i = 0; i < args.length; i += 1) {
    const raw = args[i]!;
    if (passthrough || raw === '--') {
      passthrough = true;
      rest.push(raw);
      continue;
    }
    if (raw.startsWith('-')) {
      const eq = raw.indexOf('=');
      const name = eq > 0 ? raw.slice(0, eq) : raw;
      if (eq < 0 && VALUE_OPTIONS.has(name)) {
        options.push({ name, value: args[i + 1] ?? '' });
        i += 1;
      } else {
        options.push({ name, value: eq > 0 ? raw.slice(eq + 1) : null });
      }
      continue;
    }
    if (!sub) sub = raw.toLowerCase();
    else rest.push(raw);
  }
  return { sub, rest, options };
}

function optionFindings(options: NpmCall['options']): Finding[] {
  const out: Finding[] = [];
  for (const { name, value } of options) {
    const lower = `${name}=${value ?? ''}`.toLowerCase();
    if (/_auth|_password|authtoken|:_|token=/.test(lower))
      out.push(finding('denied', 'option npm qui contient un jeton'));
    else if (
      ['--script-shell', '--node-options', '--userconfig', '--globalconfig', '--registry'].includes(
        name.toLowerCase(),
      )
    ) {
      out.push(finding('always-confirm', `option npm « ${name} » qui change ce qui s’exécute`));
    }
  }
  return out;
}

function workspaceOk(options: NpmCall['options']): boolean {
  return options.every(({ name, value }) => {
    const lower = name.toLowerCase();
    if (lower === '-w' || lower === '--workspace')
      return value !== null && KNOWN_WORKSPACES.has(value);
    return SAFE_OPTIONS.has(lower);
  });
}

/** Test, lint ou typecheck : automatique seulement dans le bac à sable, sous forme exacte. */
function testLike(name: string, exact: boolean, ctx: SegmentContext): Finding {
  if (!exact)
    return finding(
      'always-confirm',
      `« ${name} » avec des options ou arguments hors de la liste fixe`,
    );
  if (ctx.insideSandbox === true && ctx.plain)
    return finding('auto', `${name} : liste fixe, dans la copie isolée`);
  if (ctx.insideSandbox === true)
    return finding('confirm', `${name} : forme inhabituelle (guillemets, variables…)`);
  return finding('confirm', `${name} hors de la copie isolée : à confirmer`);
}

export function npmRules(program: string, args: string[], ctx: SegmentContext): Finding[] {
  const { sub, rest, options } = splitNpm(args);
  const out = optionFindings(options);
  const lowerRest = rest.map((value) => value.toLowerCase());
  if (!sub)
    return [
      ...out,
      finding(
        options.some((o) => ['-v', '--version', '-h', '--help'].includes(o.name))
          ? 'confirm'
          : 'always-confirm',
        `${program} sans commande`,
      ),
    ];
  if (
    ACCOUNT.has(sub) ||
    (sub === 'npm' && lowerRest.includes('publish')) ||
    (lowerRest.includes('publish') && program !== 'npm')
  ) {
    return [
      ...out,
      finding(
        'denied',
        `publication ou compte du registre (${program} ${sub}) : Jarvis ne publie jamais`,
      ),
    ];
  }
  if (TEST.has(sub)) return [...out, ...scriptRules(program, 'test', rest, options, ctx)];
  if (
    RUN.has(sub) ||
    (program !== 'npm' &&
      !INSTALL.has(sub) &&
      !READ.has(sub) &&
      !['exec', 'dlx', 'x', 'config'].includes(sub))
  ) {
    const script = RUN.has(sub) ? (rest[0] ?? '') : sub;
    const extra = RUN.has(sub) ? rest.slice(1) : rest;
    return [...out, ...scriptRules(program, script, extra, options, ctx)];
  }
  if (['exec', 'x', 'dlx'].includes(sub)) return [...out, ...npxRules(rest, ctx)];
  if (sub === 'config' || sub === 'c' || sub === 'get' || sub === 'set') {
    const key = (sub === 'get' || sub === 'set' ? rest[0] : rest[1]) ?? '';
    if (/auth|token|password|_pass|cert|key/i.test(key))
      return [...out, finding('denied', 'configuration npm liée aux jetons')];
    const reads = sub === 'get' || ['get', 'list', 'ls'].includes(lowerRest[0] ?? '');
    return [
      ...out,
      finding(
        reads ? 'confirm' : 'always-confirm',
        reads ? 'lecture de la configuration npm' : 'modifie la configuration npm',
      ),
    ];
  }
  if (INSTALL.has(sub))
    return [
      ...out,
      finding(
        'always-confirm',
        `installe ou modifie les dépendances (réseau, scripts d’installation) : ${program} ${sub}`,
      ),
    ];
  if (READ.has(sub)) return [...out, finding('confirm', `lecture (${program} ${sub})`)];
  if (sub === 'cache')
    return [...out, finding(lowerRest[0] === 'clean' ? 'always-confirm' : 'confirm', 'cache npm')];
  if (['start', 'restart', 'stop'].includes(sub))
    return [...out, finding('always-confirm', `lance un script (${program} ${sub})`)];
  return [...out, finding('always-confirm', `commande ${program} inconnue « ${sub} »`)];
}

function scriptRules(
  program: string,
  script: string,
  extra: string[],
  options: NpmCall['options'],
  ctx: SegmentContext,
): Finding[] {
  const name = script.toLowerCase();
  if (!name) return [finding('confirm', 'liste les scripts')];
  if (/publish|release|deploy/.test(name))
    return [finding('denied', `script de publication « ${script} » : Jarvis ne publie jamais`)];
  const out: Finding[] = [];
  const body = ctx.packageScripts?.[script];
  if (body !== undefined) {
    // Le corps vient du package.json de l'utilisateur (fichier du cœur, modifié seulement avec sa
    // confirmation) : seul un contenu refusé remonte, pas les enchaînements qu'il contient.
    const remaining = { ...ctx.packageScripts };
    delete remaining[script];
    const inner = ctx.recurse(body, { packageScripts: remaining });
    if (maxLevel(inner) === 'denied') {
      return [
        finding(
          'denied',
          `le script « ${script} » contient : ${inner.find((f) => f.level === 'denied')?.reason}`,
        ),
      ];
    }
  }
  if (AUTO_SCRIPTS.has(name)) {
    const extraOk =
      extra.length === 0 ||
      (name === 'test' &&
        extra.length === 2 &&
        extra[0] === '--' &&
        isSafeRelativePath(extra[1]!) &&
        SAFE_TEST_PATH.test(extra[1]!));
    return [...out, testLike(`${program} run ${script}`, extraOk && workspaceOk(options), ctx)];
  }
  if (name === 'build') {
    const coreOnly = options.some(
      (o) =>
        ['-w', '--workspace'].includes(o.name) &&
        ['@jarvis/core', 'packages/core'].includes(o.value ?? ''),
    );
    return [
      ...out,
      coreOnly
        ? finding('confirm', 'compile le cœur (local)')
        : finding('always-confirm', 'build complet : setup:voice télécharge des fichiers (réseau)'),
    ];
  }
  if (name.startsWith('package'))
    return [...out, finding('always-confirm', 'construit l’installateur en local (jamais publié)')];
  if (name === 'dev' || name === 'preview')
    return [...out, finding('always-confirm', 'lance l’application')];
  if (name === 'format')
    return [...out, finding('always-confirm', 'réécrit des fichiers (Prettier)')];
  return [...out, finding('always-confirm', `script « ${script} » hors de la liste fixe`)];
}

export function npxRules(args: string[], ctx: SegmentContext): Finding[] {
  const out: Finding[] = [];
  let i = 0;
  while (i < args.length && args[i]!.startsWith('-')) {
    const raw = args[i]!.toLowerCase();
    if (raw === '--yes' || raw === '-y')
      out.push(finding('always-confirm', 'télécharge un paquet sans demander'));
    if (raw === '-c' || raw === '--call')
      return [
        ...out,
        finding('always-confirm', 'npx -c'),
        ...ctx.recurse(args.slice(i + 1).join(' ')),
      ];
    if (raw === '-p' || raw === '--package') i += 1;
    i += 1;
  }
  const pkg = args[i] ?? '';
  const rest = args.slice(i + 1);
  const name = pkg.replace(/^(@[^/]+\/[^@]+|[^@]+)@.*$/, '$1').toLowerCase();
  if (!name) return [...out, finding('always-confirm', 'npx sans paquet')];
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(name)) return [...out, ...npmRules(name, rest, ctx)];
  if (name === 'git') return [...out, ...ctx.recurse(['git', ...rest].join(' '))];
  const known = packageBinaryRules(name, rest, ctx);
  if (known) return [...out, ...known];
  return [
    ...out,
    finding('always-confirm', `paquet « ${name} » : exécute du code téléchargé ou local`),
  ];
}

/** Binaires de node_modules/.bin, lancés par npx ou directement dans un script. */
export function packageBinaryRules(
  name: string,
  rest: string[],
  ctx: SegmentContext,
): Finding[] | null {
  if (
    PUBLISH_PACKAGES.has(name) ||
    (['lerna', 'changeset', '@changesets/cli'].includes(name) &&
      rest.some((v) => v.toLowerCase() === 'publish'))
  ) {
    return [finding('denied', `outil de publication « ${name} » : Jarvis ne publie jamais`)];
  }
  if (name === 'electron-builder') return electronBuilderRules(rest);
  if (
    DELETE_PACKAGES.has(name) ||
    (name === 'shx' && ['rm', 'rmdir'].includes((rest[0] ?? '').toLowerCase()))
  ) {
    return [finding('denied', `suppression de fichiers par « ${name} »`)];
  }
  const tool = toolRules(name, rest, ctx);
  return tool ? [tool] : null;
}

export function electronBuilderRules(args: string[]): Finding[] {
  const lower = args.map((value) => value.toLowerCase());
  const index = lower.findIndex(
    (value) => value === '--publish' || value === '-p' || value.startsWith('--publish='),
  );
  const value =
    index < 0
      ? 'never'
      : lower[index]!.includes('=')
        ? lower[index]!.split('=')[1]!
        : (lower[index + 1] ?? 'always');
  return value === 'never'
    ? [finding('always-confirm', 'construit l’installateur en local')]
    : [finding('denied', `publication par electron-builder (--publish ${value})`)];
}

/** vitest / tsc / eslint, appelés par npx ou directement depuis node_modules/.bin. */
export function toolRules(name: string, rest: string[], ctx: SegmentContext): Finding | null {
  const lower = rest.map((value) => value.toLowerCase());
  if (name === 'vitest') {
    if (lower[0] !== 'run')
      return finding('always-confirm', 'vitest en mode surveillance ou avec options');
    const exact =
      rest.length === 1 ||
      (rest.length === 2 && isSafeRelativePath(rest[1]!) && SAFE_TEST_PATH.test(rest[1]!));
    return testLike('vitest run', exact, ctx);
  }
  if (name === 'tsc' || name === 'typescript') {
    const exact =
      lower.includes('--noemit') &&
      rest.every((value, index) => {
        const v = value.toLowerCase();
        if (v === '--noemit' || v === '-p' || v === '--project') return true;
        const prev = lower[index - 1] ?? '';
        return (
          (prev === '-p' || prev === '--project') &&
          isSafeRelativePath(value) &&
          SAFE_TSCONFIG.test(value)
        );
      });
    return lower.includes('--noemit')
      ? testLike('tsc --noEmit', exact, ctx)
      : finding('always-confirm', 'tsc qui écrit des fichiers');
  }
  if (name === 'eslint') {
    if (lower.includes('--fix') || lower.includes('--fix-dry-run'))
      return finding('always-confirm', 'eslint --fix réécrit des fichiers');
    const exact =
      rest.length > 0 &&
      rest.every((value, index) => {
        if (value === '.' || (isSafeRelativePath(value) && !value.startsWith('-')))
          return lower[index - 1] !== '--max-warnings' || /^\d+$/.test(value);
        return value.toLowerCase() === '--max-warnings' && /^\d+$/.test(rest[index + 1] ?? '');
      });
    return exact
      ? testLike('eslint', true, ctx)
      : finding('always-confirm', 'eslint avec des options qui peuvent charger du code');
  }
  return null;
}

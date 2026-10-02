import { finding, type Finding } from './commandSafetyTypes.js';

export const SHELLS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'powershell',
  'pwsh',
  'cmd',
  'iex',
  'invoke-expression',
  'python',
  'python3',
  'py',
  'node',
  'perl',
  'ruby',
  'deno',
  'bun',
]);
export const DOWNLOADERS = new Set([
  'curl',
  'wget',
  'invoke-webrequest',
  'iwr',
  'invoke-restmethod',
  'irm',
  'certutil',
  'bitsadmin',
  'start-bitstransfer',
]);
const DELETERS = new Set([
  'rm',
  'remove-item',
  'ri',
  'del',
  'erase',
  'rd',
  'rmdir',
  'unlink',
  'shred',
  'srm',
]);
const DISK_SYSTEM = new Set([
  'format',
  'format-volume',
  'diskpart',
  'fdisk',
  'gdisk',
  'parted',
  'dd',
  'bcdedit',
  'bootrec',
  'bootsect',
  'vssadmin',
  'wbadmin',
  'sdelete',
  'clear-disk',
  'initialize-disk',
  'remove-partition',
  'set-partition',
  'regedit',
  'reg',
  'netsh',
  'wmic',
  'takeown',
  'icacls',
  'cacls',
  'attrib',
  'setx',
  'mklink',
  'set-executionpolicy',
  'add-mppreference',
  'set-mppreference',
  'remove-mppreference',
  'sc',
  'sc.exe',
  'net',
  'net1',
  'schtasks',
  'register-scheduledtask',
  'unregister-scheduledtask',
  'new-service',
  'set-service',
  'remove-service',
  'stop-service',
  'disable-computerrestore',
  'cipher',
  'compact',
  'fsutil',
  'chkdsk',
  'mountvol',
  'manage-bde',
  'pnputil',
  'dism',
  'sfc',
  'auditpol',
  'secedit',
  'gpupdate',
  'powercfg',
]);
const POWER = new Set([
  'shutdown',
  'restart-computer',
  'stop-computer',
  'logoff',
  'reboot',
  'poweroff',
  'halt',
  'suspend-computer',
]);
const ELEVATION = new Set([
  'sudo',
  'runas',
  'gsudo',
  'doas',
  'su',
  'pkexec',
  'nsudo',
  'psexec',
  'psexec64',
]);
const LOLBINS = new Set([
  'mshta',
  'rundll32',
  'regsvr32',
  'wscript',
  'cscript',
  'installutil',
  'msiexec',
  'msbuild',
  'regasm',
  'regsvcs',
  'cmstp',
  'odbcconf',
  'forfiles',
  'pcalua',
  'scriptrunner',
]);
const INSTALLERS = new Set([
  'winget',
  'choco',
  'chocolatey',
  'scoop',
  'apt',
  'apt-get',
  'brew',
  'snap',
  'dnf',
  'yum',
  'pacman',
  'install-module',
  'install-package',
]);
const PUBLISHERS = new Set([
  'gh',
  'hub',
  'glab',
  'twine',
  'vsce',
  'ovsx',
  'cargo-publish',
  'gem',
  'docker',
  'podman',
  'firebase',
  'vercel',
  'netlify',
  'surge',
  'heroku',
  'flyctl',
  'wrangler',
  'az',
  'aws',
  'gcloud',
]);
const SECRET_TOOLS = new Set([
  'cmdkey',
  'vaultcmd',
  'security',
  'keyring',
  'secret-tool',
  'printenv',
  'mimikatz',
  'procdump',
]);
const UPLOADERS = new Set([
  'scp',
  'sftp',
  'ftp',
  'tftp',
  'rsync',
  'nc',
  'ncat',
  'netcat',
  'socat',
  'telnet',
]);
const LISTERS = new Set([
  'get-childitem',
  'gci',
  'ls',
  'dir',
  'get-item',
  'gi',
  'get-content',
  'gc',
  'cat',
  'type',
  'more',
  'less',
  'head',
  'tail',
]);
const READONLY = new Set([
  'echo',
  'write-output',
  'write-host',
  'cd',
  'set-location',
  'sl',
  'chdir',
  'pwd',
  'get-location',
  'where',
  'which',
  'get-command',
  'gcm',
  'whoami',
  'hostname',
  'ver',
  'nvidia-smi',
  'findstr',
  'grep',
  'select-string',
  'sls',
  'wc',
  'sort',
  'measure-object',
  'tree',
  'get-date',
  'test-path',
  'resolve-path',
]);
const WRITERS = new Set([
  'copy-item',
  'cp',
  'copy',
  'cpi',
  'xcopy',
  'move-item',
  'mv',
  'move',
  'mi',
  'ren',
  'rename',
  'rename-item',
  'rni',
  'mkdir',
  'md',
  'new-item',
  'ni',
  'touch',
  'set-content',
  'add-content',
  'ac',
  'out-file',
  'tee',
  'tee-object',
  'clear-content',
  'clc',
  'truncate',
  'set-item',
  'si',
  'set-itemproperty',
  'sp',
  'new-itemproperty',
  'remove-itemproperty',
  'rp',
  'chmod',
  'chown',
  'expand-archive',
  'compress-archive',
  'tar',
  'unzip',
  'zip',
  '7z',
]);
const KILLERS = new Set(['taskkill', 'stop-process', 'spps', 'kill', 'pkill', 'killall', 'tskill']);
const REGISTRY_PATH = /^(hk(lm|cu|cr|u|cc)(:|\\|$)|registry::|hkey_)/i;

/** Jeton qui désigne un secret : fichiers de clés, réglages de Jarvis, variables de jetons. */
export function secretReason(token: string): string | null {
  const value = token.toLowerCase();
  if (/(^|[\\/])\.env(\.(?!example$)[\w.-]+)?$/.test(value))
    return `fichier de secrets « ${token} »`;
  if (/(^|[\\/])settings\.json$/.test(value)) return 'réglages de Jarvis (contiennent les clés)';
  if (
    /gh-token|github[-_]?token|\.git-credentials|(^|[\\/])\.npmrc$|\.yarnrc|(^|[\\/])[._]netrc$|id_rsa|id_ed25519|id_ecdsa|id_dsa|(^|[\\/])\.ssh([\\/]|$)|\.(pem|key|pfx|p12|ppk|kdbx)$|google-token\.bin|spotify-token\.json|(^|[\\/])credentials(\.json)?$|(^|[\\/])\.aws([\\/]|$)|(^|[\\/])secrets?\.(json|ya?ml|env|txt)$|wallet\.dat|login data|cookies\.sqlite/.test(
      value,
    )
  ) {
    return `fichier de secrets « ${token} »`;
  }
  if (
    /(\$env:|\$\{?|%|!)[a-z_]*(token|secret|passw|api_?key|credential|private_?key)[a-z_]*/.test(
      value,
    )
  )
    return `variable secrète « ${token} »`;
  if (/downloadstring|downloadfile|frombase64string|net\.webclient|-encodedcommand/.test(value))
    return 'téléchargement ou code caché';
  return null;
}

function isRecursiveFlag(arg: string): boolean {
  const value = arg.toLowerCase();
  if (value === '--recursive' || value === '-recurse') return true;
  if (/^-[rfivdR]{1,5}$/i.test(arg) && /r/i.test(arg)) return true;
  if (value.length >= 2 && '-recurse'.startsWith(value) && value.startsWith('-r')) return true;
  return /^(\/[a-z])+$/i.test(arg) && /\/s/i.test(arg);
}

function deletionRules(program: string, args: string[]): Finding[] {
  const cmdStyle = ['del', 'erase', 'rd', 'rmdir'].includes(program);
  const targets = args.filter(
    (value) => !value.startsWith('-') && !(cmdStyle && /^\/[a-z](:[a-z-]+)?$/i.test(value)),
  );
  const broad = targets.some(
    (value) =>
      /[*?]/.test(value) ||
      /^([a-z]:)?[\\/]*$/i.test(value) ||
      value === '~' ||
      value === '.' ||
      value === '..' ||
      /^[a-z]:\\?$/i.test(value) ||
      REGISTRY_PATH.test(value),
  );
  if (args.some(isRecursiveFlag) || broad || program === 'shred' || program === 'srm') {
    return [
      finding('denied', `suppression récursive ou en masse (${program}) : jamais par commande`),
    ];
  }
  if (targets.length > 1)
    return [finding('denied', `suppression de plusieurs fichiers d’un coup (${program})`)];
  return [
    finding(
      'always-confirm',
      `supprime « ${targets[0] ?? '?'} » (un seul fichier, toujours confirmé)`,
    ),
  ];
}

const DANGEROUS_CODE =
  /child_process|execsync|spawnsync|\bexec(file)?\s*\(|\bspawn\s*\(|rmsync|rmdirsync|unlinksync|fs\.rm|os\.system|subprocess|shutil\.rmtree|os\.remove|git\s+push|npm\s+publish|process\.env|os\.environ|require\(['"]https?|fetch\s*\(/i;

/** node -e, python -c… : du code arbitraire, refusé s'il lance des commandes, supprime ou lit les secrets. */
export function interpreterRules(program: string, args: string[]): Finding[] {
  const lower = args.map((value) => value.toLowerCase());
  if (lower.length === 1 && ['-v', '--version', '-version', '-V'.toLowerCase()].includes(lower[0]!))
    return [finding('confirm', `version de ${program}`)];
  const codeFlag = lower.findIndex((value) =>
    [
      '-e',
      '--eval',
      '-p',
      '--print',
      '-c',
      '-command',
      '-r',
      '--require',
      '--import',
      '--loader',
      '--experimental-loader',
      '-m',
    ].includes(value),
  );
  if (codeFlag >= 0) {
    const code = args.slice(codeFlag + 1).join(' ');
    return DANGEROUS_CODE.test(code)
      ? [
          finding(
            'denied',
            `code ${program} qui lance des commandes, supprime des fichiers, lit les secrets ou va sur le réseau`,
          ),
        ]
      : [finding('always-confirm', `exécute du code ${program} écrit dans la commande`)];
  }
  if (args.length === 0) return [finding('always-confirm', `ouvre l’interpréteur ${program}`)];
  return [
    finding(
      'always-confirm',
      `exécute un script ${program} (« ${args[0]} ») dont le contenu n’est pas vérifié`,
    ),
  ];
}

/** Programmes système. `null` = pas une règle de ce fichier. */
export function systemRules(program: string, args: string[]): Finding[] | null {
  const lower = args.map((value) => value.toLowerCase());
  if (DELETERS.has(program)) return deletionRules(program, args);
  if (
    ELEVATION.has(program) ||
    ((program === 'start-process' || program === 'saps' || program === 'start') &&
      lower.some((v, i) => v === 'runas' && /^-verb/.test(lower[i - 1] ?? '')))
  ) {
    return [
      finding('denied', `élévation administrateur (${program}) : jamais par Jarvis Développeur`),
    ];
  }
  if (
    POWER.has(program) ||
    (program === 'systemctl' &&
      lower.some((v) => ['poweroff', 'reboot', 'halt', 'suspend', 'hibernate'].includes(v))) ||
    (program === 'init' && ['0', '6'].includes(lower[0] ?? ''))
  ) {
    return [finding('denied', `arrêt ou redémarrage du PC (${program})`)];
  }
  if (DISK_SYSTEM.has(program) || program.startsWith('mkfs') || program.startsWith('mke2fs')) {
    if (program === 'reg' && lower[0] === 'query')
      return [finding('always-confirm', 'lecture du registre Windows')];
    if ((program === 'sc' || program === 'sc.exe') && lower[0] === 'query')
      return [finding('always-confirm', 'état des services Windows')];
    if (program === 'schtasks' && lower.includes('/query'))
      return [finding('always-confirm', 'liste des tâches planifiées')];
    if (program === 'chkdsk' && !lower.some((v) => /^\/[frxb]/.test(v)))
      return [finding('always-confirm', 'vérification du disque (lecture)')];
    return [finding('denied', `disque, registre ou réglages système (${program})`)];
  }
  if (['invoke-expression', 'iex'].includes(program))
    return [finding('denied', 'exécute du texte comme du code (Invoke-Expression)')];
  if (LOLBINS.has(program)) return [finding('denied', `lanceur système détourné (${program})`)];
  if (INSTALLERS.has(program)) {
    return ['list', 'search', 'show', '--version', '-v', 'info'].includes(lower[0] ?? '')
      ? [finding('confirm', `lecture (${program} ${lower[0]})`)]
      : [finding('denied', `installation de logiciel (${program}) : à lancer toi-même`)];
  }
  if (PUBLISHERS.has(program))
    return [
      finding('denied', `publication ou compte en ligne (${program}) : Jarvis ne publie jamais`),
    ];
  if (SECRET_TOOLS.has(program)) return [finding('denied', `accès aux secrets (${program})`)];
  if (UPLOADERS.has(program))
    return [finding('denied', `envoi de fichiers vers une autre machine (${program})`)];
  if (program === 'ssh') return [finding('always-confirm', 'connexion à une autre machine (ssh)')];
  if (DOWNLOADERS.has(program)) {
    const upload = lower.some(
      (v, i) =>
        ['-t', '--upload-file', '-f', '--form', '-infile'].includes(v) ||
        ((v === '-d' || v.startsWith('--data')) && (lower[i + 1] ?? '').startsWith('@')) ||
        (/^-(method|x)$/.test(v) && /put|post/.test(lower[i + 1] ?? '')),
    );
    if (upload)
      return [finding('denied', `envoi de données ou de fichiers sur Internet (${program})`)];
    if (program === 'certutil' || program === 'bitsadmin' || program === 'start-bitstransfer')
      return [finding('denied', `téléchargement par un outil système (${program})`)];
    return [finding('always-confirm', `réseau (${program})`)];
  }
  if (program === 'env' && args.every((v) => v.startsWith('-') || v.includes('=')))
    return [finding('denied', 'affiche les variables d’environnement (jetons)')];
  if (
    (program === 'set' && (args.length === 0 || !args.join(' ').includes('='))) ||
    ((program === 'export' || program === 'declare') &&
      (args.length === 0 || lower.some((v) => ['-p', '-x'].includes(v))))
  ) {
    return [finding('denied', 'affiche les variables d’environnement (jetons)')];
  }
  if (program === 'set') return [finding('always-confirm', 'définit une variable d’environnement')];
  if (LISTERS.has(program)) {
    if (lower.some((v) => /^(env|variable|cert|wsman):/.test(v)))
      return [finding('denied', 'lit les variables d’environnement ou les certificats')];
    return [finding('confirm', `lecture de fichiers (${program})`)];
  }
  if (program === 'find') {
    return lower.some((v) => ['-delete', '-exec', '-execdir', '-ok', '-okdir'].includes(v))
      ? [finding('denied', 'find qui supprime ou lance une commande sur chaque fichier')]
      : [finding('confirm', 'recherche de fichiers')];
  }
  if (program === 'robocopy') {
    return lower.some((v) => ['/mir', '/purge', '/move', '/mov'].includes(v))
      ? [finding('denied', 'robocopy qui supprime ou déplace en masse')]
      : [finding('always-confirm', 'copie de fichiers (robocopy)')];
  }
  if (WRITERS.has(program)) {
    if (lower.some((v) => REGISTRY_PATH.test(v)))
      return [finding('denied', 'modifie le registre Windows')];
    if (
      lower.some(
        (v, i) =>
          /^-itemtype$/.test(lower[i - 1] ?? '') && /symboliclink|junction|hardlink/.test(v),
      )
    )
      return [finding('denied', 'crée un lien symbolique (peut sortir du dossier autorisé)')];
    if (['chmod', 'chown'].includes(program) && lower.some((v) => /^-[a-z]*r/i.test(v)))
      return [finding('denied', `${program} récursif`)];
    return [finding('always-confirm', `modifie des fichiers (${program})`)];
  }
  if (KILLERS.has(program))
    return [finding('always-confirm', `arrête des programmes (${program})`)];
  if (READONLY.has(program)) return [finding('confirm', `lecture (${program})`)];
  if (program === 'ollama') {
    const sub = lower[0] ?? '';
    if (sub === 'push') return [finding('denied', 'publication d’un modèle (ollama push)')];
    if (['pull', 'rm', 'create', 'cp', 'run'].includes(sub))
      return [
        finding(
          'always-confirm',
          `ollama ${sub} : téléchargement ou modification de modèle, seulement sur ton clic`,
        ),
      ];
    return [finding('confirm', `lecture (ollama ${sub || ''})`.trim())];
  }
  return null;
}

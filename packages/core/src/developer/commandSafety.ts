import { parseCommandLine, programName } from './commandParse.js';
import { gitRules } from './commandRulesGit.js';
import { npmRules, npxRules, packageBinaryRules } from './commandRulesNode.js';
import {
  DOWNLOADERS,
  SHELLS,
  interpreterRules,
  secretReason,
  systemRules,
} from './commandRulesSystem.js';
import {
  LEVEL_RANK,
  SAFETY_LABELS,
  finding,
  maxLevel,
  type CommandClassification,
  type CommandSafetyContext,
  type Finding,
  type SegmentContext,
} from './commandSafetyTypes.js';

const MAX_DEPTH = 4;
const INTERPRETERS = new Set(['node', 'python', 'python3', 'py', 'perl', 'ruby', 'deno']);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const DANGEROUS_ENV =
  /^(node_options|node_path|git_[a-z_]+|npm_config_[a-z_]+|path|pathext|ld_preload|ld_library_path|dyld_[a-z_]+|electron_run_as_node|comspec|psmodulepath|bash_env|env|prompt_command)$/i;
const SECRET_ENV = /token|secret|passw|api_?key|credential|private_?key/i;

/**
 * Classe une commande libre. Rien n'est exécuté ici : la classe dit seulement
 * si Jarvis peut la lancer sans demander, avec confirmation, ou jamais.
 */
export function classifyCommand(
  command: string,
  context: CommandSafetyContext = {},
): CommandClassification {
  const findings = classifyFindings(command, context, 0);
  const level = maxLevel(findings);
  const reasons = [...findings]
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level])
    .map((item) => item.reason)
    .filter((reason, index, all) => all.indexOf(reason) === index);
  return {
    command,
    level,
    label: SAFETY_LABELS[level],
    reasons,
    runsWithoutAsking: level === 'auto',
  };
}

function classifyFindings(
  command: string,
  context: CommandSafetyContext,
  depth: number,
): Finding[] {
  if (depth > MAX_DEPTH)
    return [finding('denied', 'trop de commandes imbriquées pour être vérifiées')];
  if (!command.trim()) return [finding('denied', 'commande vide')];
  const parsed = parseCommandLine(command);
  const out: Finding[] = parsed.issues.map((issue) => finding('denied', issue));
  if (
    /^\s*(`|\$\(|\(|\{|&\s*[$(`]|\.\s+[$(])/.test(command) ||
    /(^|[;&|\n]\s*)`[^`]*`/.test(command)
  ) {
    out.push(
      finding('denied', 'programme calculé au moment de l’exécution : impossible à vérifier'),
    );
  }
  const { flags } = parsed;
  const chained = parsed.segments.length > 1 || parsed.operators.length > 0;
  if (chained)
    out.push(
      finding(
        'always-confirm',
        `commandes enchaînées (${[...new Set(parsed.operators)].join(' ') || 'plusieurs'})`,
      ),
    );
  if (flags.variable)
    out.push(finding('always-confirm', 'variables dont la valeur n’est pas visible'));
  if (flags.substitution) out.push(finding('always-confirm', 'substitution de commande'));
  if (flags.redirection)
    out.push(finding('always-confirm', 'redirection vers ou depuis un fichier'));
  if (flags.escapes) out.push(finding('always-confirm', 'caractères d’échappement (^ ou `)'));
  if (flags.grouping)
    out.push(finding('always-confirm', 'parenthèses ou accolades (sous-commandes)'));

  for (let k = 0; k < parsed.operators.length; k += 1) {
    if (parsed.operators[k] !== '|') continue;
    const left = programName(parsed.segments[k]?.[0] ?? '');
    const right = programName(parsed.segments[k + 1]?.[0] ?? '');
    if (DOWNLOADERS.has(left) && SHELLS.has(right))
      out.push(finding('denied', 'télécharge du code et l’exécute (… | shell)'));
    if (SHELLS.has(right) && ['base64', 'certutil', 'openssl', 'xxd'].includes(left))
      out.push(finding('denied', 'décode du code caché et l’exécute'));
  }
  const programs = parsed.segments.map((segment) =>
    programName(segment.find((token) => !ENV_ASSIGNMENT.test(token) && token !== '&') ?? ''),
  );
  if (
    parsed.segments.length > 1 &&
    programs.some((name) => DOWNLOADERS.has(name)) &&
    programs.some((name) => SHELLS.has(name))
  ) {
    out.push(finding('denied', 'télécharge du code et l’exécute dans la même commande'));
  }
  for (const token of [...parsed.segments.flat(), ...parsed.redirections]) {
    const secret = secretReason(token);
    if (secret) out.push(finding('denied', `touche aux secrets : ${secret}`));
  }

  const plain =
    !chained &&
    !flags.quotes &&
    !flags.variable &&
    !flags.substitution &&
    !flags.redirection &&
    !flags.escapes &&
    !flags.grouping &&
    !flags.callOperator &&
    parsed.issues.length === 0;
  const segmentContext: SegmentContext = {
    ...context,
    plain,
    single: parsed.segments.length === 1 && !chained,
    recurse: (inner, overrides) => classifyFindings(inner, { ...context, ...overrides }, depth + 1),
  };
  for (const segment of parsed.segments) out.push(...segmentFindings(segment, segmentContext));
  if (out.length === 0) out.push(finding('denied', 'commande illisible'));
  return out;
}

function segmentFindings(tokens: string[], ctx: SegmentContext): Finding[] {
  const out: Finding[] = [];
  let rest = [...tokens];
  const envs: string[] = [];
  while (rest.length && ENV_ASSIGNMENT.test(rest[0]!)) envs.push(rest.shift()!);
  if (rest[0] === '&') rest = rest.slice(1);
  if (rest[0] === '.' && rest.length > 1) {
    out.push(finding('always-confirm', 'charge un script dans le shell (dot-source)'));
    rest = rest.slice(1);
  }
  for (const env of envs) {
    const name = env.slice(0, env.indexOf('='));
    if (SECRET_ENV.test(name)) out.push(finding('denied', `variable secrète « ${name} »`));
    else if (DANGEROUS_ENV.test(name))
      out.push(finding('always-confirm', `variable « ${name} » qui change ce qui s’exécute`));
    else out.push(finding('always-confirm', `variable d’environnement « ${name} »`));
  }
  if (rest.length === 0) return out.length ? out : [finding('denied', 'commande vide')];

  const head = rest[0]!;
  if (/^\$|^%|^!|\$\(|\$\{/.test(head))
    return [
      ...out,
      finding('denied', 'programme désigné par une variable : impossible à vérifier'),
    ];
  if (/[^\x20-\x7E]/.test(head))
    return [
      ...out,
      finding('denied', 'nom de programme avec des caractères non ASCII (risque de leurre)'),
    ];
  const program = programName(head);
  const args = rest.slice(1);
  return [...out, ...programFindings(program, head, args, ctx)];
}

function programFindings(
  program: string,
  head: string,
  args: string[],
  ctx: SegmentContext,
): Finding[] {
  if (program === 'git') return gitRules(args, ctx);
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(program)) return npmRules(program, args, ctx);
  if (['npx', 'bunx', 'pnpx'].includes(program)) return npxRules(args, ctx);
  const binary = packageBinaryRules(program, args, ctx);
  if (binary) return binary;
  if (INTERPRETERS.has(program)) return interpreterRules(program, args);
  const system = systemRules(program, args);
  if (system) return system;
  const lower = args.map((value) => value.toLowerCase());
  const wrapped = (what: string, inner: string[]): Finding[] => [
    finding('always-confirm', what),
    ...(inner.length ? ctx.recurse(inner.join(' ')) : []),
  ];
  switch (program) {
    case 'cmd': {
      const index = lower.findIndex((value) => /^\/[ckr]$/.test(value));
      const delayed = lower.some((value) => value === '/v' || value.startsWith('/v:on'))
        ? [finding('always-confirm', 'expansion retardée des variables (/v:on)')]
        : [];
      return [
        ...delayed,
        ...wrapped('lance l’interpréteur cmd', index < 0 ? [] : args.slice(index + 1)),
      ];
    }
    case 'powershell':
    case 'pwsh':
      return powershellFindings(args, lower, ctx);
    case 'bash':
    case 'sh':
    case 'zsh':
    case 'dash':
    case 'ksh':
    case 'fish': {
      const index = args.findIndex((value) => /^-[a-z]*c$/.test(value));
      if (index >= 0)
        return wrapped(`lance le shell ${program}`, args[index + 1] ? [args[index + 1]!] : []);
      if (args.length)
        return [
          finding(
            'always-confirm',
            `exécute le script « ${args[0]} » dont le contenu n’est pas vérifié`,
          ),
        ];
      return [finding('always-confirm', `ouvre le shell ${program}`)];
    }
    case 'wsl': {
      const inner: string[] = [];
      for (let i = 0; i < args.length; i += 1) {
        const value = lower[i]!;
        if (['-d', '--distribution', '-u', '--user', '--cd'].includes(value)) i += 1;
        else if (['-e', '--exec', '--'].includes(value)) {
          inner.push(...args.slice(i + 1));
          break;
        } else if (!value.startsWith('-')) {
          inner.push(...args.slice(i));
          break;
        }
      }
      return wrapped('lance une commande Linux (wsl)', inner);
    }
    case 'start': {
      let i = 0;
      while (
        i < args.length &&
        (args[i] === '' ||
          /^\/(b|wait|min|max|i|low|normal|high|realtime|abovenormal|belownormal|separate|shared|elevate)$/i.test(
            args[i]!,
          ) ||
          /^\/(d|node|affinity)$/i.test(args[i - 1] ?? '_'))
      )
        i += 1;
      return wrapped('lance un autre programme (start)', args.slice(i));
    }
    case 'start-process':
    case 'saps':
      return wrapped(
        'lance un autre programme',
        args
          .filter((value) => value && !value.startsWith('-') && !/^\/[a-z]+$/i.test(value))
          .flatMap((value) => value.split(',')),
      );
    case 'call':
    case 'invoke-command':
    case 'icm':
      return wrapped(
        `lance une commande (${program})`,
        args.filter((value) => !value.startsWith('-')),
      );
    case 'timeout':
      if ((lower[0] ?? '').startsWith('/')) return [finding('confirm', 'attente (timeout)')];
      return wrapped(
        'lance une commande avec délai',
        args.slice(
          args.findIndex((value) => !value.startsWith('-') && !/^\d+[smhd]?$/.test(value)),
        ),
      );
    case 'env':
    case 'nohup':
    case 'time':
    case 'nice':
    case 'exec':
    case 'watch':
    case 'stdbuf':
    case 'ionice':
    case 'caffeinate':
    case 'xargs': {
      let i = 0;
      while (i < args.length && (args[i]!.startsWith('-') || ENV_ASSIGNMENT.test(args[i]!))) {
        if (
          program === 'xargs' &&
          ['-i', '-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a'].includes(args[i]!)
        )
          i += 1;
        if (ENV_ASSIGNMENT.test(args[i] ?? '') && SECRET_ENV.test(args[i]!.split('=')[0]!))
          return [finding('denied', 'variable secrète')];
        i += 1;
      }
      return wrapped(
        program === 'xargs'
          ? 'lance une commande sur une liste venue d’ailleurs (xargs)'
          : `lance une commande (${program})`,
        args.slice(i),
      );
    }
    default:
      if (
        /[\\/]/.test(head) ||
        /\.(ps1|psm1|bat|cmd|sh|vbs|vbe|js|jse|wsf|py|rb|pl|lnk|scr|hta)$/i.test(head)
      ) {
        return [finding('always-confirm', `exécute « ${head} » dont le contenu n’est pas vérifié`)];
      }
      return [finding('always-confirm', `programme inconnu « ${program} »`)];
  }
}

function powershellFindings(args: string[], lower: string[], ctx: SegmentContext): Finding[] {
  const out: Finding[] = [finding('always-confirm', 'lance PowerShell')];
  for (let i = 0; i < args.length; i += 1) {
    const value = lower[i]!;
    if (
      value.startsWith('-') &&
      value.length >= 2 &&
      ('-encodedcommand'.startsWith(value) || value === '-ec' || value === '-enc')
    ) {
      return [...out, finding('denied', 'commande PowerShell encodée (illisible)')];
    }
    if (value.startsWith('-c') && '-command'.startsWith(value))
      return [...out, ...ctx.recurse(args.slice(i + 1).join(' '))];
    if (value.startsWith('-f') && '-file'.startsWith(value))
      return [
        ...out,
        finding('always-confirm', `exécute le script PowerShell « ${args[i + 1] ?? '?'} »`),
      ];
    if (value.startsWith('-ex') && '-executionpolicy'.startsWith(value)) {
      out.push(finding('always-confirm', 'contourne la politique d’exécution PowerShell'));
      i += 1;
    } else if (value.startsWith('-w') && '-windowstyle'.startsWith(value)) {
      out.push(finding('always-confirm', 'fenêtre PowerShell cachée ou réduite'));
      i += 1;
    } else if (!value.startsWith('-')) {
      return [...out, ...ctx.recurse(args.slice(i).join(' '))];
    }
  }
  return out;
}

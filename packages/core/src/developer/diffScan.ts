import { parseUnifiedDiff } from './unifiedDiff.js';

/**
 * Revue du diff avant de lancer les tests (décision 9) : lancer les tests,
 * c'est exécuter du code écrit par le modèle. Ces familles imposent une
 * confirmation. « dynamic » couvre ce qui peut cacher les trois autres.
 */
export type ScanCategory = 'process' | 'delete' | 'network' | 'dynamic' | 'system';

export interface ScanFinding {
  category: ScanCategory;
  file: string;
  line: number;
  text: string;
  reason: string;
}

export const SCAN_LABELS: Record<ScanCategory, string> = {
  process: 'lancement de processus',
  delete: 'suppression de fichiers',
  network: 'accès réseau non local',
  dynamic: 'code dynamique (peut cacher un des cas précédents)',
  system: 'fichier système, registre ou droits administrateur',
};

const CODE_FILE = /\.(c|m)?(j|t)sx?$|\.(ps1|psm1|sh|bash|bat|cmd|py)$/i;
/** C#, XAML et MSBuild (0.5.4) : leurs propres règles, le JavaScript garde les siennes. */
const DOTNET_FILE = /\.(cs|csx|vb|xaml|csproj|vbproj|props|targets|manifest)$/i;

const DOTNET_RULES: ReadonlyArray<{ category: ScanCategory; pattern: RegExp; reason: string }> = [
  {
    category: 'process',
    pattern:
      /\bProcess\.Start\b|\bnew\s+Process(StartInfo)?\b|\bUseShellExecute\b|\bPowerShell\.Create\b/,
    reason: 'lance un processus',
  },
  {
    category: 'process',
    pattern: /<\s*Exec\b|<\s*Target\b[^>]*\b(Before|After)Targets\s*=/i,
    reason: 'tâche MSBuild qui lance une commande à la compilation',
  },
  {
    category: 'delete',
    pattern:
      /\b(File|Directory)\.Delete\s*\(|\bFileSystem\.Delete(File|Directory)\b|\.Delete\s*\(\s*(true)?\s*\)/,
    reason: 'supprime un fichier ou un dossier',
  },
  {
    category: 'network',
    pattern:
      /\b(HttpClient|WebClient|WebRequest|HttpWebRequest|TcpClient|UdpClient|TcpListener|ClientWebSocket|SmtpClient)\b|\bnew\s+Socket\s*\(/,
    reason: 'client réseau',
  },
  {
    category: 'dynamic',
    pattern:
      /\bAssembly\.(Load|LoadFrom|LoadFile)\s*\(|\bActivator\.CreateInstance\b|\[\s*(DllImport|LibraryImport)\b|\bMarshal\.GetDelegateForFunctionPointer\b|\bCSharpScript\b/,
    reason: 'charge ou exécute du code à l’exécution',
  },
  {
    category: 'system',
    pattern:
      /drivers[\\/]+etc[\\/]+hosts|(^|[^\w.])\/etc\/hosts\b|\bSystem32\b|\bSpecialFolder\.(System|Windows)\b/i,
    reason:
      'fichier du système (hosts, System32) : utilise un chemin réglable et un faux fichier dans les tests',
  },
  {
    category: 'system',
    pattern: /\bRegistry(Key)?\.|\bMicrosoft\.Win32\.Registry\b|\bRegistryKey\b/,
    reason: 'registre Windows',
  },
  {
    category: 'system',
    pattern:
      /requireAdministrator|highestAvailable|\bVerb\s*=\s*"runas"|\bWindowsBuiltInRole\.Administrator\b|\bWindowsPrincipal\b/i,
    reason: 'droits administrateur (élévation, UAC)',
  },
];

const RULES: ReadonlyArray<{ category: ScanCategory; pattern: RegExp; reason: string }> = [
  {
    category: 'process',
    pattern: /child_process|\bexeca\b|cross-spawn|node-pty/,
    reason: 'module de lancement de processus',
  },
  {
    category: 'process',
    pattern: /\b(spawn|spawnSync|execSync|execFile|execFileSync|fork)\s*\(/,
    reason: 'lance un processus',
  },
  {
    category: 'process',
    pattern: /(^|[^.\w$])exec\s*\(|\b(cp|childProcess|child_process|proc)\.exec\s*\(/,
    reason: 'lance une commande (exec)',
  },
  {
    category: 'process',
    pattern:
      /\bshell\.(openExternal|openPath)\s*\(|\b(Bun\.spawn|Deno\.(run|Command))\b|Start-Process|\bpowershell(\.exe)?\b|\bcmd(\.exe)?\s+\/c\b/i,
    reason: 'ouvre un programme ou un shell',
  },
  {
    category: 'delete',
    pattern: /\b(unlink|unlinkSync|rmSync|rmdir|rmdirSync|removeSync|emptyDir|emptyDirSync)\s*\(/,
    reason: 'supprime un fichier ou un dossier',
  },
  {
    category: 'delete',
    pattern:
      /\b(fs|fsp|fse|promises|fsPromises)\.(rm|unlink|rmdir|remove)\b|\brimraf\b|\btrash\s*\(|shell\.trashItem|Remove-Item|\brm\s+-[a-z]*r|\brd\s+\/s/i,
    reason: 'supprime des fichiers',
  },
  {
    category: 'network',
    pattern:
      /\b(https?|http2|net|tls|dgram)\.(request|get|connect|createConnection|createSocket)\s*\(/,
    reason: 'connexion réseau',
  },
  {
    category: 'network',
    pattern:
      /\bnew\s+(WebSocket|EventSource)\s*\(|\bXMLHttpRequest\b|\baxios\b|\bundici\b|node-fetch|\bgot\s*\(|\bnavigator\.sendBeacon\b/,
    reason: 'client réseau',
  },
  {
    category: 'dynamic',
    pattern:
      /(^|[^.\w$])eval\s*\(|\bnew\s+Function\s*\(|\bvm\.(runIn\w*|Script|compileFunction)\b|process\.(binding|dlopen)\b|\b(globalThis|global|window|self|process)\s*\[/,
    reason: 'exécute du code construit à l’exécution',
  },
  {
    category: 'dynamic',
    pattern: /\b(require|import)\s*\(\s*(?!['"`][^'"`$]*['"`]\s*\))/,
    reason: 'chargement de module dont le nom est calculé',
  },
];

const URL_IN_TEXT = /\bhttps?:\/\/(\[[^\]]+\]|[^/\s'"`:)[]+)/gi;

export function isLoopbackHost(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, '').toLowerCase();
  return value === 'localhost' || value === '::1' || /^127\.\d+\.\d+\.\d+$/.test(value);
}

/** Examine une ligne ajoutée. Les lignes entièrement en commentaire `//` sont ignorées. */
export function scanLine(file: string, line: number, text: string): ScanFinding[] {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('//')) return [];
  const out: ScanFinding[] = [];
  const seen = new Set<ScanCategory>();
  const add = (category: ScanCategory, reason: string): void => {
    if (seen.has(category)) return;
    seen.add(category);
    out.push({ category, file, line, text: trimmed.slice(0, 200), reason });
  };
  if (DOTNET_FILE.test(file)) {
    for (const rule of DOTNET_RULES) if (rule.pattern.test(text)) add(rule.category, rule.reason);
    if (!/\bxmlns(:\w+)?\s*=/.test(text))
      for (const match of text.matchAll(URL_IN_TEXT))
        if (!isLoopbackHost(match[1]!)) add('network', `adresse externe ${match[1]}`);
    return out;
  }
  for (const rule of RULES) if (rule.pattern.test(text)) add(rule.category, rule.reason);
  if (/\bfetch\s*\(/.test(text)) {
    const literal = /\bfetch\s*\(\s*['"`](https?:\/\/[^'"`]+)/.exec(text);
    const host = literal ? /^https?:\/\/([^/:?#]+|\[[^\]]+\])/i.exec(literal[1]!)?.[1] : null;
    if (!host || !isLoopbackHost(host))
      add(
        'network',
        literal ? `fetch vers ${host ?? 'une adresse'}` : 'fetch vers une adresse calculée',
      );
  }
  for (const match of text.matchAll(URL_IN_TEXT)) {
    if (!isLoopbackHost(match[1]!)) add('network', `adresse externe ${match[1]}`);
  }
  return out;
}

/** Lignes ajoutées des fichiers de code d'un diff unifié (`git diff`). */
export function scanDiff(diff: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const file of parseUnifiedDiff(diff)) {
    if (!CODE_FILE.test(file.path) && !DOTNET_FILE.test(file.path)) continue;
    for (const hunk of file.hunks)
      for (const line of hunk.lines)
        if (line.kind === 'add')
          findings.push(...scanLine(file.path, line.newLine ?? 0, line.text));
  }
  return findings;
}

/** Clé stable d'une découverte, pour ne redemander que les nouvelles. */
export function findingKey(finding: ScanFinding): string {
  return `${finding.category}|${finding.file}|${finding.text}`;
}

/**
 * Lecture des sorties de tests (tsc, Vitest, ESLint) pour comparer à la
 * référence prise avant toute modification : un échec qui existait déjà
 * n'est jamais attribué à la tâche.
 */
export interface TestRunSummary {
  suite: string;
  command: string;
  exitCode: number | null;
  /** Identifiants stables des échecs (fichier + code ou nom du test). */
  failures: string[];
  /** Une ligne lisible : « 2 erreurs TypeScript », « 3 tests échoués sur 91 »… */
  summary: string;
  /** Fin utile de la sortie, pour le modèle et l'interface. */
  excerpt: string;
  durationMs: number;
  timedOut: boolean;
}

// eslint-disable-next-line no-control-regex -- codes de couleur ANSI des sorties de terminal.
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

const TSC_ERROR = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;
const VITEST_FAIL = /^\s*(?:FAIL|×|✗)\s+(.+?)(?:\s+\d+ms)?$/;
const VITEST_SUMMARY = /^\s*Tests\s+(?:(\d+) failed)?(?:\s*\|\s*)?(?:(\d+) passed)?.*\((\d+)\)/;
const ESLINT_FILE = /^(\/|[A-Za-z]:\\|\.{0,2}[\\/]?[\w@.-]+[\\/]).+\.[cm]?[jt]sx?$/;
const ESLINT_PROBLEM = /^\s+(\d+):(\d+)\s+error\s+(.+?)\s{2,}(\S+)$/;

function relativeTo(path: string, root?: string): string {
  let value = path.replace(/\\/g, '/');
  if (root) {
    const base = root.replace(/\\/g, '/').replace(/\/$/, '');
    if (value.toLowerCase().startsWith(`${base.toLowerCase()}/`))
      value = value.slice(base.length + 1);
  }
  return value.replace(/^\.\//, '');
}

export function parseTestOutput(
  output: string,
  options: { exitCode: number | null; root?: string } = { exitCode: null },
): { failures: string[]; summary: string } {
  const lines = stripAnsi(output).split(/\r?\n/);
  const failures = new Set<string>();
  let tsc = 0;
  let eslintFile = '';
  let eslint = 0;
  let vitestFailed: number | null = null;
  let vitestTotal: number | null = null;
  for (const line of lines) {
    const ts = TSC_ERROR.exec(line.trim());
    if (ts) {
      tsc += 1;
      failures.add(`tsc ${relativeTo(ts[1]!, options.root)} ${ts[4]} ${ts[5]!.slice(0, 120)}`);
      continue;
    }
    const fail = VITEST_FAIL.exec(line);
    if (fail && /\.(test|spec)\.[cm]?[jt]sx?/.test(fail[1]!)) {
      failures.add(`test ${relativeTo(fail[1]!.trim(), options.root)}`);
      continue;
    }
    const summary = VITEST_SUMMARY.exec(line);
    if (summary) {
      vitestFailed = (vitestFailed ?? 0) + Number(summary[1] ?? 0);
      vitestTotal = (vitestTotal ?? 0) + Number(summary[3] ?? 0);
      continue;
    }
    if (ESLINT_FILE.test(line.trim()) && !line.startsWith(' ')) {
      eslintFile = relativeTo(line.trim(), options.root);
      continue;
    }
    const problem = ESLINT_PROBLEM.exec(line);
    if (problem && eslintFile) {
      eslint += 1;
      failures.add(`lint ${eslintFile} ${problem[4]} ${problem[3]!.slice(0, 80)}`);
    }
  }
  const parts: string[] = [];
  if (tsc) parts.push(`${tsc} erreur(s) TypeScript`);
  if (vitestTotal !== null)
    parts.push(
      vitestFailed
        ? `${vitestFailed} test(s) échoué(s) sur ${vitestTotal}`
        : `${vitestTotal} tests réussis`,
    );
  if (eslint) parts.push(`${eslint} erreur(s) de lint`);
  if (options.exitCode !== 0 && failures.size === 0) {
    failures.add(`sortie ${options.exitCode ?? 'interrompue'}`);
    parts.push(`échec (code ${options.exitCode ?? 'aucun'})`);
  }
  if (parts.length === 0) parts.push(options.exitCode === 0 ? 'réussi' : 'échec');
  return { failures: [...failures].sort(), summary: parts.join(', ') };
}

/** Fin de sortie utile : lignes d'erreur d'abord, puis la fin, sans couleurs. */
export function testExcerpt(output: string, maxLines = 60): string {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const errors = lines.filter(
    (line) =>
      TSC_ERROR.test(line.trim()) ||
      /\b(FAIL|Error|error|×|✗|AssertionError|expected)\b/.test(line),
  );
  const picked = [...new Set([...errors.slice(0, maxLines / 2), ...lines.slice(-maxLines / 2)])];
  return picked.slice(0, maxLines).join('\n');
}

export interface TestComparison {
  /** Échecs absents de la référence : imputables à la tâche. */
  newFailures: string[];
  /** Échecs de la référence qui ont disparu. */
  fixed: string[];
  /** Échecs déjà présents avant la tâche. */
  preexisting: string[];
  ok: boolean;
}

export function compareRuns(baseline: TestRunSummary[], current: TestRunSummary[]): TestComparison {
  const before = new Set(baseline.flatMap((run) => run.failures.map((f) => `${run.suite}: ${f}`)));
  const now = current.flatMap((run) => run.failures.map((f) => `${run.suite}: ${f}`));
  const nowSet = new Set(now);
  const newFailures = now.filter((f) => !before.has(f));
  const timedOut = current
    .filter((run) => run.timedOut)
    .map((run) => `${run.suite}: délai dépassé`);
  return {
    newFailures: [...newFailures, ...timedOut],
    fixed: [...before].filter((f) => !nowSet.has(f)),
    preexisting: now.filter((f) => before.has(f)),
    ok: newFailures.length === 0 && timedOut.length === 0,
  };
}

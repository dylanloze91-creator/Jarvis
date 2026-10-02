/**
 * Découpe une ligne de commande (cmd, PowerShell ou sh) comme le ferait un
 * interpréteur, en restant prudent : guillemets et échappements (`^`, `` ` ``)
 * sont retirés pour comparer le vrai programme et ses arguments ; tout ce qui
 * rend la commande imprévisible est signalé.
 */
export interface ParsedCommand {
  segments: string[][];
  operators: string[];
  /** Cibles des redirections `>` / `<` (analysées comme les arguments). */
  redirections: string[];
  /** Problèmes qui rendent la commande illisible : elle est alors refusée. */
  issues: string[];
  flags: {
    quotes: boolean;
    escapes: boolean;
    variable: boolean;
    substitution: boolean;
    redirection: boolean;
    grouping: boolean;
    callOperator: boolean;
  };
}

export const MAX_COMMAND_LENGTH = 2_000;

const INVISIBLE =
  /\u034F|\u115F|\u1160|\u17B4|\u17B5|[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u3164\uFEFF\uFFA0]/;
// eslint-disable-next-line no-control-regex -- les caractères de contrôle sont justement ce qu'on cherche.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const VARIABLE = /\$[A-Za-z_{(]|\$env:|%[A-Za-z_][\w()]*%|![A-Za-z_][\w]*!/i;

export function parseCommandLine(input: string): ParsedCommand {
  const text = input.normalize('NFKC').trim();
  const parsed: ParsedCommand = {
    segments: [],
    operators: [],
    redirections: [],
    issues: [],
    flags: {
      quotes: false,
      escapes: false,
      variable: VARIABLE.test(text),
      substitution: /\$\(|[<>]\(/.test(text),
      redirection: false,
      grouping: false,
      callOperator: false,
    },
  };
  if (INVISIBLE.test(input) || INVISIBLE.test(text))
    parsed.issues.push('caractères invisibles dans la commande');
  if (CONTROL.test(text)) parsed.issues.push('caractères de contrôle dans la commande');
  if (text.length > MAX_COMMAND_LENGTH)
    parsed.issues.push(`commande trop longue pour être relue (${text.length} caractères)`);

  let segment: string[] = [];
  let token = '';
  let started = false;
  let redirectNext = false;
  let quote: '"' | "'" | null = null;

  const endToken = (): void => {
    if (started) {
      if (redirectNext) {
        parsed.redirections.push(token);
        redirectNext = false;
      } else {
        segment.push(token);
      }
    }
    token = '';
    started = false;
  };
  const endSegment = (operator: string | null): void => {
    endToken();
    redirectNext = false;
    if (segment.length) parsed.segments.push(segment);
    segment = [];
    if (operator) parsed.operators.push(operator);
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quote) {
      if (char === quote) quote = null;
      else token += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      parsed.flags.quotes = true;
    } else if (char === '^' || char === '`') {
      parsed.flags.escapes = true;
      if (char === '`') parsed.flags.substitution = true;
      if (i + 1 < text.length) {
        token += text[i + 1];
        started = true;
        i += 1;
      }
    } else if (char === ' ' || char === '\t') {
      endToken();
    } else if (char === ';' || char === '\n' || char === '\r') {
      endSegment(char === ';' ? ';' : 'newline');
    } else if (char === '&' || char === '|') {
      const double = text[i + 1] === char;
      if (char === '&' && !double && !started && segment.length === 0) {
        parsed.flags.callOperator = true;
        continue;
      }
      endSegment(double ? char + char : char);
      if (double) i += 1;
    } else if (char === '(' || char === ')' || char === '{' || char === '}') {
      parsed.flags.grouping = true;
      endSegment(char);
    } else if (char === '>' || char === '<') {
      parsed.flags.redirection = true;
      if (/^\d$/.test(token)) {
        token = '';
        started = false;
      }
      endToken();
      if (text[i + 1] === char) i += 1;
      if (text[i + 1] === '&') i += 1;
      redirectNext = true;
    } else {
      token += char;
      started = true;
    }
  }
  if (quote) parsed.issues.push('guillemets non fermés');
  endSegment(null);
  return parsed;
}

/** `C:\Program Files\Git\cmd\git.exe` → `git` ; `NPM.CMD` → `npm`. */
export function programName(token: string): string {
  const base = token.split(/[\\/]/).pop() ?? token;
  return base.replace(/\.(exe|cmd|bat|com|ps1)$/i, '').toLowerCase();
}

/**
 * Routines : un nom et des étapes prises dans les outils déjà là.
 * `run_command` est refusé. Le fichier sur le disque est dans `fichiers.ts`.
 */

export type RoutineTool = 'open_application' | 'spotify_play' | 'siteblock_start_focus' | 'briefing';

export interface RoutineStep {
  label: string;
  tool: RoutineTool;
  args: Record<string, string | number>;
  /** Vrai si l'étape n'a de sens qu'après la précédente (« puis »). */
  dependsOnPrevious: boolean;
}

export interface Routine {
  name: string;
  steps: RoutineStep[];
}

export type RoutineAction =
  | { kind: 'create'; name: string; steps: RoutineStep[]; summary: string }
  | { kind: 'confirm' }
  | { kind: 'launch'; name: string }
  | { kind: 'refused'; reason: string };

const FORBIDDEN = /\b(run_command|powershell|cmd|commande libre|terminal)\b/iu;

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['’`]/g, ' ')
    .trim();
}

function stripWake(text: string): string {
  return text
    .trim()
    .replace(/^(?:jarvis)[,.\s]+/iu, '')
    .replace(/[.?!]+$/u, '')
    .trim();
}

export function routineNamesMatch(a: string, b: string): boolean {
  return fold(a) === fold(b);
}

/** Découpe une phrase de routine. `null` : ce n'est pas une routine. */
export function routineAction(text: string, knownNames: readonly string[]): RoutineAction | null {
  const raw = stripWake(text);
  const folded = fold(raw);
  if (!folded) return null;
  if (folded === 'c est bon') return { kind: 'confirm' };
  if (FORBIDDEN.test(raw)) {
    return {
      kind: 'refused',
      reason: "Une routine ne peut pas lancer de commande libre. Rien n'a été enregistré.",
    };
  }
  const launch = raw.match(/^(?:lance|démarre|demarre)\s+la\s+routine\s+(.+)$/iu);
  if (launch?.[1]) return { kind: 'launch', name: launch[1].trim() };
  const mode = raw.match(/^mode\s+(.+)$/iu);
  if (mode?.[1]) {
    const name = mode[1].trim();
    if (knownNames.some((known) => routineNamesMatch(known, name))) return { kind: 'launch', name };
    return null;
  }
  const create = raw.match(/^cr[ée]e\s+une\s+routine\s+([^:]+):\s*(.+)$/iu);
  if (!create?.[1] || !create[2]) return null;
  const parsed = parseSteps(create[2]);
  if (!parsed.ok) return { kind: 'refused', reason: parsed.reason };
  const name = create[1].trim();
  return { kind: 'create', name, steps: parsed.steps, summary: summaryOf(name, parsed.steps) };
}

function parseSteps(body: string): { ok: true; steps: RoutineStep[] } | { ok: false; reason: string } {
  const tokens = body.split(/(\s*,\s*|\s+puis\s+)/iu);
  const steps: RoutineStep[] = [];
  let depends = false;
  for (const token of tokens) {
    if (/^\s*,\s*$/u.test(token)) {
      depends = false;
      continue;
    }
    if (/^\s+puis\s+$/iu.test(token)) {
      depends = true;
      continue;
    }
    const part = token.trim();
    if (!part) continue;
    const step = parseStep(part, depends && steps.length > 0);
    if (!step) {
      return {
        ok: false,
        reason: `Je ne sais pas faire « ${part} » avec un outil existant. Une commande libre est interdite. Rien n'a été enregistré.`,
      };
    }
    steps.push(step);
    depends = false;
  }
  if (steps.length === 0) return { ok: false, reason: "Cette routine n'a aucune étape. Rien n'a été enregistré." };
  return { ok: true, steps };
}

function parseStep(part: string, dependsOnPrevious: boolean): RoutineStep | null {
  const focus = part.match(/bloque\s+les\s+r[ée]seaux\s+sociaux(?:\s+pendant)?\s+(\d+)\s*(heures?|minutes?)/iu);
  if (focus?.[1] && focus[2]) {
    const amount = Number(focus[1]);
    const minutes = /heure/iu.test(focus[2]) ? amount * 60 : amount;
    return {
      label: `concentration ${minutes} min`,
      tool: 'siteblock_start_focus',
      args: { minutes },
      dependsOnPrevious,
    };
  }
  const playlist = part.match(/^(?:mets\s+ma\s+playlist|joue)\s+(.+?)(?:\s+sur\s+(.+))?$/iu);
  if (playlist?.[1]) {
    const query = playlist[1].trim();
    const device = playlist[2]?.trim();
    return {
      label: device ? `playlist ${query} sur ${device}` : `playlist ${query}`,
      tool: 'spotify_play',
      args: device ? { query: `${query} sur ${device}` } : { query },
      dependsOnPrevious,
    };
  }
  if (/briefing/iu.test(part)) {
    return { label: 'briefing', tool: 'briefing', args: {}, dependsOnPrevious };
  }
  const app = part.match(/^ouvre\s+(?!le\s+dossier\b)(.+)$/iu);
  if (app?.[1]) {
    const name = app[1].trim();
    return { label: `ouvrir ${name}`, tool: 'open_application', args: { name }, dependsOnPrevious };
  }
  return null;
}

export function summaryOf(name: string, steps: RoutineStep[]): string {
  return `Routine ${name} : ${steps.map((step) => step.label).join(', ')}. Dis « C'est bon » pour l'enregistrer.`;
}

export interface StepRunner {
  (step: RoutineStep): Promise<{ ok: boolean; content: string }>;
}

/** Une étape ratée est dite. La suivante continue, sauf si elle dépend de la ratée. */
export async function runRoutineSteps(steps: readonly RoutineStep[], run: StepRunner): Promise<string> {
  const bits: string[] = [];
  let previousFailed = false;
  for (const step of steps) {
    if (step.dependsOnPrevious && previousFailed) {
      bits.push(`${step.label} passée (elle dépendait de l'étape d'avant)`);
      continue;
    }
    const result = await run(step);
    previousFailed = !result.ok;
    bits.push(result.ok ? `${step.label} faite` : `${step.label} ratée : ${result.content}`);
  }
  return bits.join(' ; ');
}

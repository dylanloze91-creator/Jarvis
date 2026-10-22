/**
 * Ce qui peut entrer dans le prompt ou dans une édition.
 * Rien, si la fiche ne colle pas au fichier, au langage ou aux contraintes.
 * Un correctif précis reste un indice, pas une règle.
 */
import {
  applyExperienceToSource,
  formatLearningContext,
  type LearningRecord,
} from './continuous.js';
import { applySkill } from './skills.js';

export interface InjectionInput {
  query: string;
  source?: string;
  tests?: string;
  language?: string;
  version?: string;
  /** Récupération des expériences. Coupée : aucun indice. */
  memory: boolean;
  /** Bibliothèque de compétences. Coupée : aucune compétence. */
  skills: boolean;
}

export interface InjectionDecision {
  experience: LearningRecord | null;
  skill: LearningRecord | null;
  /** Vide si rien ne convient. Le modèle tourne alors sans mémoire. */
  prompt: string;
  skipped: string[];
}

function recordLanguage(record: LearningRecord): string {
  const language = record.trace?.language;
  if (language && language !== 'unknown') return language;
  return record.hint?.language ?? '';
}

function lineInSource(source: string, line: string): boolean {
  const want = line.trim();
  if (!want) return false;
  return source.split(/\r?\n/).some((item) => item.trim() === want);
}

function queryScore(query: string, record: LearningRecord): number {
  const tokens = (text: string) =>
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 2);
  const q = [...new Set(tokens(query))];
  if (!q.length) return 0;
  const hay = new Set(tokens(`${record.content} ${record.fix ?? ''} ${record.errorSignature ?? ''}`));
  return q.filter((token) => hay.has(token)).length / q.length;
}

function usableExperience(record: LearningRecord, input: InjectionInput): boolean {
  if (record.type !== 'experience' || record.status !== 'validated' || record.origin !== 'mission') return false;
  if (!record.hint?.from || !record.hint.to) return false;
  const language = recordLanguage(record);
  if (input.language && language && language !== input.language) return false;
  const version = record.trace?.runtimeVersion;
  if (input.version && version && version !== input.version) return false;
  return true;
}

function chooseExperience(records: readonly LearningRecord[], input: InjectionInput, skipped: string[]): LearningRecord | null {
  if (!input.source) {
    skipped.push('pas de fichier pour vérifier la ligne');
    return null;
  }
  const usable = records.filter((record) => usableExperience(record, input));
  const fitting = usable.filter((record) => lineInSource(input.source ?? '', record.hint?.from ?? ''));
  if (!fitting.length) {
    skipped.push('aucun indice dont la ligne est dans ce fichier');
    return null;
  }
  const targets = new Map<string, Set<string>>();
  for (const record of fitting) {
    const from = record.hint?.from.trim() ?? '';
    const set = targets.get(from) ?? new Set<string>();
    set.add(record.hint?.to.trim() ?? '');
    targets.set(from, set);
  }
  if ([...targets.values()].some((set) => set.size > 1)) {
    skipped.push('indices contradictoires');
    return null;
  }
  const ranked = [...fitting].sort(
    (a, b) => queryScore(input.query, b) - queryScore(input.query, a) || b.confidence - a.confidence,
  );
  return ranked[0] ?? null;
}

function chooseSkill(records: readonly LearningRecord[], input: InjectionInput, skipped: string[]): LearningRecord | null {
  if (!input.source) {
    skipped.push('pas de fichier pour une compétence');
    return null;
  }
  const run = applySkill(input.source, input.tests ?? '', records, {
    ...(input.language ? { language: input.language } : {}),
    ...(input.version ? { version: input.version } : {}),
    query: input.query,
    validatedOnly: true,
  });
  if (!run.used || !run.recordId) {
    skipped.push(run.selectedName ? `${run.selectedName} ne convient pas à ce fichier` : 'aucune compétence');
    return null;
  }
  return records.find((record) => record.id === run.recordId) ?? null;
}

function render(experience: LearningRecord | null, skill: LearningRecord | null): string {
  const parts: string[] = [];
  if (experience?.hint) {
    parts.push(
      [
        'Mémoire sélective. Un seul indice, parce que sa ligne d’origine est dans ce fichier. Ce n’est pas une règle.',
        `Observation passée : « ${experience.hint.from} » a été écrit « ${experience.hint.to} » dans un autre fichier, sans recopier l’ancien fichier.`,
        'Ne le recopie que si les tests de CE fichier l’exigent. Sinon laisse le fichier tel quel.',
      ].join('\n'),
    );
  }
  const method = skill?.skill;
  if (method) {
    parts.push(
      [
        'Compétence qui convient à CE fichier d’après ses tests. Méthode générale, pas une ligne à recopier.',
        `Nom : ${method.name}`,
        `Quand : ${method.appliesWhen}`,
        'Étapes :',
        ...method.steps.map((step) => `- ${step}`),
        `Limites : ${method.limits.join(' ')}`,
      ].join('\n'),
    );
  }
  return parts.join('\n\n');
}

/** Au plus un indice et une compétence. Sinon une chaîne vide. */
export function selectInjection(records: readonly LearningRecord[], input: InjectionInput): InjectionDecision {
  const skipped: string[] = [];
  let experience = input.memory ? chooseExperience(records, input, skipped) : null;
  if (!input.memory) skipped.push('récupération coupée');
  const skill = input.skills ? chooseSkill(records, input, skipped) : null;
  if (!input.skills) skipped.push('bibliothèque coupée');
  if (experience && skill && input.source) {
    const card = applyExperienceToSource(input.source, [experience], {
      ...(input.language ? { language: input.language } : {}),
      ...(input.version ? { version: input.version } : {}),
    });
    const skilled = applySkill(input.source, input.tests ?? '', [skill], {
      ...(input.language ? { language: input.language } : {}),
      ...(input.version ? { version: input.version } : {}),
      query: input.query,
      validatedOnly: true,
    });
    if (card.applied && skilled.used && card.source.trim() !== skilled.source.trim()) {
      skipped.push('indice contredit par la compétence, non injecté');
      experience = null;
    }
  }
  return { experience, skill, prompt: render(experience, skill), skipped };
}

/**
 * Prompt du codeur. Les règles restent. Un correctif précis n’entre que
 * par selectInjection, donc pas du tout si la ligne n’est pas dans le fichier.
 */
export function coderLearningPrompt(records: readonly LearningRecord[], input: InjectionInput): string {
  const decision = selectInjection(records, input);
  const textual = records.filter((item) => {
    if (item.type === 'procedure') return false;
    if (item.type === 'experience' && (item.hint || !input.memory)) return false;
    return true;
  });
  return [formatLearningContext(textual), decision.prompt].filter(Boolean).join('\n\n');
}

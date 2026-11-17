/**
 * Outil pour ajouter une règle express proprement (mission « Jarvis plus rapide, sans nouveau
 * modèle », section 2.3).
 *
 * Une règle express envoie une demande à une équipe **sans appeler le cerveau**. Elle se décrit
 * par des mots qui la déclenchent, des mots qui l'empêchent, et des essais : des phrases qu'elle
 * doit prendre, et des phrases qu'elle ne doit pas prendre. Une règle sans ses essais, ou dont un
 * essai échoue, fait échouer la suite de tests : elle ne peut pas entrer dans Jarvis.
 *
 * On ne devine pas : la liste (`EXPRESS_RULES`) est vide tant que la carte de l'utilisation
 * (`carte.md`) et les mesures (`vitesse.md`) n'ont pas dit quelles demandes le cerveau trie pour
 * rien. Les phrases d'essai sont écrites pour la règle ; ce ne sont jamais des phrases recopiées
 * des conversations de l'utilisateur.
 *
 * En cas de doute, la règle laisse passer : deux règles d'équipes différentes qui prennent la même
 * phrase ne décident rien, et le cerveau tranche comme avant.
 */
import type { OrchestraTeam } from './orchestraTeams.js';

export interface ExpressRule {
  /** Nom court, unique, pour le journal et les tests. */
  id: string;
  team: OrchestraTeam;
  /** Mots ou groupes de mots : un seul suffit. Comparés sans casse ni accent, par mots entiers. */
  declencheurs: string[];
  /** Mots ou groupes de mots : un seul suffit à empêcher la règle. */
  empechements: string[];
  /** Phrases que la règle doit prendre. */
  pour: string[];
  /** Phrases que la règle ne doit pas prendre (elles contiennent souvent un déclencheur). */
  contre: string[];
}

/** Essais exigés de chaque côté. */
export const EXPRESS_RULE_MIN_TESTS = 3;

/**
 * Les règles express ajoutées par cet outil. Vide exprès : chaque règle viendra de la carte de
 * l'utilisation, avec ses essais pour et contre.
 */
export const EXPRESS_RULES: readonly ExpressRule[] = [];

/** Minuscules, sans accent, ponctuation remplacée par des espaces, apostrophes comprises. */
export function foldForRule(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Vrai si `phrase` (un mot ou un groupe de mots) est dans `folded`, par mots entiers. */
function hasWords(folded: string, phrase: string): boolean {
  const words = foldForRule(phrase);
  if (!words) return false;
  return ` ${folded} `.includes(` ${words} `);
}

/** La règle prend-elle cette phrase ? Un déclencheur présent, aucun empêchement. */
export function expressRuleMatches(rule: ExpressRule, text: string): boolean {
  const folded = foldForRule(text);
  if (!folded) return false;
  if (!rule.declencheurs.some((word) => hasWords(folded, word))) return false;
  return !rule.empechements.some((word) => hasWords(folded, word));
}

/** Ce qui manque à une règle pour être acceptée. Liste vide : elle est en ordre. */
export function checkExpressRule(rule: ExpressRule): string[] {
  const problems: string[] = [];
  if (!rule.id.trim()) problems.push('la règle n’a pas de nom');
  if (rule.declencheurs.filter((word) => foldForRule(word)).length === 0) problems.push('aucun mot ne la déclenche');
  if (rule.pour.length < EXPRESS_RULE_MIN_TESTS) {
    problems.push(`il faut au moins ${EXPRESS_RULE_MIN_TESTS} phrases qu’elle doit prendre`);
  }
  if (rule.contre.length < EXPRESS_RULE_MIN_TESTS) {
    problems.push(`il faut au moins ${EXPRESS_RULE_MIN_TESTS} phrases qu’elle ne doit pas prendre`);
  }
  rule.pour.forEach((phrase, index) => {
    if (!expressRuleMatches(rule, phrase)) problems.push(`essai « pour » n° ${index + 1} : la règle ne prend pas la phrase`);
  });
  rule.contre.forEach((phrase, index) => {
    if (expressRuleMatches(rule, phrase)) problems.push(`essai « contre » n° ${index + 1} : la règle prend la phrase`);
  });
  return problems;
}

export interface ExpressRulesCheckOptions {
  /**
   * Ce que Jarvis décide déjà sans ces règles (calcul, horloge, règles existantes) : le nom de ce
   * qui prend la phrase, ou `null`. Une nouvelle règle ne doit pas viser une autre équipe qu'une
   * règle déjà en place sur ses propres phrases « pour ».
   */
  existing?: (text: string) => string | null;
}

/** Contrôle d'une liste de règles : chacune en ordre, noms uniques, aucune phrase disputée. */
export function checkExpressRules(rules: readonly ExpressRule[], options: ExpressRulesCheckOptions = {}): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) problems.push(`${rule.id} : ce nom est pris deux fois`);
    seen.add(rule.id);
    for (const problem of checkExpressRule(rule)) problems.push(`${rule.id} : ${problem}`);
    rule.pour.forEach((phrase, index) => {
      for (const other of rules) {
        if (other === rule || other.team === rule.team) continue;
        if (expressRuleMatches(other, phrase)) {
          problems.push(`${rule.id} : essai « pour » n° ${index + 1} aussi pris par ${other.id} (équipe ${other.team})`);
        }
      }
      const already = options.existing?.(phrase) ?? null;
      if (already && already !== rule.team) {
        problems.push(`${rule.id} : essai « pour » n° ${index + 1} déjà réglé par « ${already} »`);
      }
    });
  }
  return problems;
}

/**
 * Équipe désignée par les règles, ou `null`. Deux règles d'équipes différentes sur la même
 * phrase : `null`, le cerveau décide. Une équipe absente (aucun de ses outils) n'est jamais rendue.
 */
export function matchExpressRules(
  rules: readonly ExpressRule[],
  text: string,
  available: ReadonlySet<OrchestraTeam>,
): { team: OrchestraTeam; rule: string } | null {
  let found: { team: OrchestraTeam; rule: string } | null = null;
  for (const rule of rules) {
    if (!expressRuleMatches(rule, text)) continue;
    if (found && found.team !== rule.team) return null;
    if (!found) found = { team: rule.team, rule: rule.id };
  }
  if (!found || !available.has(found.team)) return null;
  return found;
}

/**
 * Outil pour ajouter une règle express proprement (mission « Jarvis plus rapide, sans nouveau
 * modèle », section 2.3).
 *
 * Une règle express envoie une demande à une équipe **sans appeler le cerveau**. Elle se décrit
 * par des mots qui la déclenchent, des mots qui l'empêchent, et des essais : des phrases qu'elle
 * doit prendre, et des phrases qu'elle ne doit pas prendre. Une règle sans ses essais, ou dont un
 * essai échoue, fait échouer la suite de tests : elle ne peut pas entrer dans Jarvis.
 *
 * On ne devine pas : une règle n'entre dans la liste (`EXPRESS_RULES`) que si la carte de
 * l'utilisation, les mesures ou un banc ont montré le besoin. Les phrases d'essai sont écrites pour la règle ; ce ne sont jamais des phrases recopiées
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
  /**
   * Outil de lecture, sans argument, appelé tout de suite à la place du modèle de l'équipe : sa
   * réponse est la réponse de Jarvis. Jamais un outil qui agit ni un outil à confirmer. Si l'outil
   * manque ou échoue, l'équipe répond comme pour une règle sans outil.
   */
  outil?: string;
  /** Phrase mise devant le résultat de l'outil. */
  annonce?: string;
  /**
   * Seule la première ligne du résultat est la réponse (et donc ce que dit la voix) ; le détail
   * reste dans la bulle de l'outil. Pour une question courte qui appelle une réponse courte.
   */
  premiereLigne?: boolean;
}

/** Essais exigés de chaque côté. */
export const EXPRESS_RULE_MIN_TESTS = 3;

/**
 * Les règles express ajoutées par cet outil. Chacune vient d'un raté mesuré, avec ses essais
 * pour et contre.
 */
export const EXPRESS_RULES: readonly ExpressRule[] = [
  {
    // 19 novembre 2026 : en première phrase d'une discussion, `qwen2.5:7b` inventait une fiche du
    // PC ou demandait de préciser, 2 à 5 fois sur 30, dans Test comme dans Live
    // (rapports/2026-11-19-outils-pc-discussion-neuve.md). L'outil est appelé sans modèle.
    id: 'infos-pc',
    team: 'pc',
    outil: 'get_system_info',
    annonce: 'Voici les informations du PC :',
    declencheurs: [
      'informations sur mon pc',
      'informations sur le pc',
      'informations sur ce pc',
      'informations de mon pc',
      'informations du pc',
      'informations sur mon ordinateur',
      'informations sur l’ordinateur',
      'informations sur cet ordinateur',
      'informations de mon ordinateur',
      'informations de l’ordinateur',
      'informations sur ma machine',
      'informations système',
      'infos sur mon pc',
      'infos sur le pc',
      'infos de mon pc',
      'infos du pc',
      'infos sur mon ordinateur',
      'infos de mon ordinateur',
      'infos système',
      'état de mon pc',
      'état du pc',
      'état de mon ordinateur',
      'état de l’ordinateur',
    ],
    empechements: [
      // Une autre source ou une autre action que la lecture de l'état du PC.
      'internet',
      'web',
      'google',
      'cherche',
      'recherche',
      'note',
      'retiens',
      'souviens',
      'envoie',
      'mail',
      'écris',
      'enregistre',
      'sauvegarde',
      'copie',
      'affiche',
      'enceinte',
      'imprime',
      // Une question précise ou une explication : le modèle répond, avec ses outils.
      'pourquoi',
      'comment',
      'où',
      'processus',
      'fenêtre',
      'erreurs',
      'acheter',
      'achat',
      'prix',
      'nouveau',
      'portable',
      'fichier',
      'dossier',
    ],
    pour: [
      'Donne-moi les informations sur mon PC',
      'Jarvis, donne-moi les infos sur mon PC s’il te plaît',
      'Quel est l’état de mon ordinateur ?',
      'Les informations système',
      'Tu peux me donner les informations de mon ordinateur ?',
      'Dis-moi l’état du PC',
    ],
    contre: [
      'Cherche sur Internet les informations sur mon PC',
      'Note les informations sur mon PC dans ma liste',
      'Pourquoi l’état de mon PC est aussi lent ?',
      'Envoie les informations sur mon PC par mail',
      'Où sont rangées les informations sur mon PC ?',
      'Affiche les informations sur mon PC sur l’enceinte',
      'Quelle fenêtre est active sur mon PC ?',
      'Ouvre le Bloc-notes',
      'Quels sont les processus et les informations du PC ?',
    ],
  },
  {
    // 20 novembre 2026 : dite à l'enceinte, « quelle fenêtre est active » ratait 4 fois sur 6 :
    // avec les consignes de la voix, `qwen2.5:7b` écrivait le nom de l'outil au lieu de l'appeler
    // (rapports/2026-11-19-live-5080-a-verifier.md, § 7). L'outil est appelé sans modèle, et seule
    // la première ligne est dite (la liste des fenêtres ouvertes reste dans la bulle).
    id: 'fenetre-active',
    team: 'pc',
    outil: 'get_active_window',
    premiereLigne: true,
    declencheurs: [
      'fenêtre active',
      'fenêtre est active',
      'fenêtre qui est active',
      'quelle fenêtre',
      'fenêtre au premier plan',
      'application active',
      'application est active',
      'appli active',
      'appli est active',
    ],
    empechements: [
      // Une action sur la fenêtre, pas une question.
      'ferme',
      'fermer',
      'ouvre',
      'ouvrir',
      'réduis',
      'réduire',
      'agrandis',
      'agrandir',
      'déplace',
      'mets',
      'bascule',
      'passe',
      'capture',
      'photo',
      'affiche',
      // Une autre source, une autre action, ou une question précise : le modèle répond.
      'internet',
      'web',
      'cherche',
      'recherche',
      'note',
      'retiens',
      'envoie',
      'mail',
      'écris',
      'enregistre',
      'pourquoi',
      'comment',
      'processus',
      'informations',
      'infos',
    ],
    pour: [
      'Quelle fenêtre est active ?',
      'Jarvis, quelle fenêtre est active sur mon PC ?',
      'Quelle est la fenêtre active ?',
      'C’est quoi la fenêtre au premier plan ?',
      'Quelle application est active ?',
    ],
    contre: [
      'Ferme la fenêtre active',
      'Fais une capture de la fenêtre active',
      'Pourquoi la fenêtre active ne répond plus ?',
      'Donne-moi les informations sur mon PC',
      'Cherche sur Internet comment changer de fenêtre active',
      'Quels sont les processus de la fenêtre active ?',
      'Ouvre le Bloc-notes',
    ],
  },
];

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

/** Outils qu'une règle peut appeler sans modèle : lecture seule, sans argument, sans carte. */
export const EXPRESS_RULE_TOOLS: readonly string[] = ['get_system_info', 'get_active_window'];

/** Résultat d'outil mis en liste sous l'annonce de la règle. */
export function expressToolReply(rule: ExpressRule, content: string): string {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (rule.premiereLigne) {
    const first = lines[0] ?? '';
    const sentence = first && !/[.!?]$/.test(first) ? `${first}.` : first;
    return rule.annonce ? `${rule.annonce} ${sentence}` : sentence;
  }
  const body = lines.length > 1 ? lines.map((line) => `- ${line}`).join('\n') : (lines[0] ?? '');
  return rule.annonce ? `${rule.annonce}\n\n${body}` : body;
}

/** La règle à outil qui prend cette phrase, ou `null` (aucune, ou deux équipes en désaccord). */
export function expressToolRule(
  rules: readonly ExpressRule[],
  text: string,
  available: ReadonlySet<OrchestraTeam>,
): ExpressRule | null {
  const found = matchExpressRules(rules, text, available);
  if (!found) return null;
  const rule = rules.find((item) => item.id === found.rule);
  return rule?.outil ? rule : null;
}

/** Ce qui manque à une règle pour être acceptée. Liste vide : elle est en ordre. */
export function checkExpressRule(rule: ExpressRule): string[] {
  const problems: string[] = [];
  if (!rule.id.trim()) problems.push('la règle n’a pas de nom');
  if (rule.declencheurs.filter((word) => foldForRule(word)).length === 0) problems.push('aucun mot ne la déclenche');
  if (rule.outil && !EXPRESS_RULE_TOOLS.includes(rule.outil)) {
    problems.push(`l’outil ${rule.outil} n’est pas dans la liste des outils de lecture permis`);
  }
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

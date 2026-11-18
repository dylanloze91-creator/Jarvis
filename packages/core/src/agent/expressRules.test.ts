import { describe, expect, it } from 'vitest';
import {
  EXPRESS_RULES,
  checkExpressRule,
  checkExpressRules,
  expressRuleMatches,
  foldForRule,
  matchExpressRules,
  type ExpressRule,
} from './expressRules.js';
import { clockReply, expressTeam, solveArithmetic } from './orchestra.js';
import { ORCHESTRA_TEAMS, type OrchestraTeam } from './orchestraTeams.js';

/** Règle d'exemple, pour les essais de l'outil seulement : elle n'est pas dans Jarvis. */
const EXEMPLE: ExpressRule = {
  id: 'exemple-luminosite',
  team: 'pc',
  declencheurs: ['luminosité', 'baisse l’écran'],
  empechements: ['photo', 'image', 'cherche'],
  pour: ['Monte la luminosité', 'Baisse l’écran s’il te plaît', 'LUMINOSITE à 40'],
  contre: ['Augmente la luminosité de cette photo', 'Cherche comment régler la luminosité', 'Quelle heure est-il ?'],
};

const TOUTES = new Set<OrchestraTeam>(ORCHESTRA_TEAMS);

describe('outil des règles express', () => {
  it('compare sans casse, sans accent, par mots entiers', () => {
    expect(foldForRule('  L’Écran, s’il-te-plaît !')).toBe('l ecran s il te plait');
    expect(expressRuleMatches(EXEMPLE, 'monte la LUMINOSITÉ')).toBe(true);
    // « luminosités » n'est pas le mot « luminosité ».
    expect(expressRuleMatches(EXEMPLE, 'les luminosités')).toBe(false);
    expect(expressRuleMatches(EXEMPLE, '')).toBe(false);
  });

  it('un mot qui empêche l’emporte sur un mot qui déclenche', () => {
    expect(expressRuleMatches(EXEMPLE, 'luminosité de l’image')).toBe(false);
  });

  it('une règle complète est acceptée', () => {
    expect(checkExpressRule(EXEMPLE)).toEqual([]);
    expect(checkExpressRules([EXEMPLE])).toEqual([]);
  });

  it('refuse une règle sans essais, sans déclencheur ou sans nom', () => {
    const problems = checkExpressRule({ ...EXEMPLE, id: ' ', declencheurs: [' '], pour: [], contre: ['x'] });
    expect(problems).toContain('la règle n’a pas de nom');
    expect(problems).toContain('aucun mot ne la déclenche');
    expect(problems.some((line) => line.includes('au moins 3 phrases qu’elle doit prendre'))).toBe(true);
    expect(problems.some((line) => line.includes('au moins 3 phrases qu’elle ne doit pas prendre'))).toBe(true);
  });

  it('refuse une règle dont un essai échoue, et dit lequel', () => {
    expect(checkExpressRule({ ...EXEMPLE, pour: [...EXEMPLE.pour, 'Éteins la lampe'] })).toEqual([
      'essai « pour » n° 4 : la règle ne prend pas la phrase',
    ]);
    expect(checkExpressRule({ ...EXEMPLE, contre: [...EXEMPLE.contre, 'Mets la luminosité au maximum'] })).toEqual([
      'essai « contre » n° 4 : la règle prend la phrase',
    ]);
  });

  it('refuse deux règles du même nom, ou qui se disputent une phrase', () => {
    const rivale: ExpressRule = {
      ...EXEMPLE,
      id: 'rivale',
      team: 'web',
      declencheurs: ['luminosité'],
      empechements: [],
      pour: ['luminosité du soleil', 'luminosité de Sirius', 'luminosité d’une étoile'],
      contre: ['bonjour', 'merci', 'salut'],
    };
    expect(checkExpressRules([EXEMPLE, { ...EXEMPLE }]).some((line) => line.includes('pris deux fois'))).toBe(true);
    expect(checkExpressRules([EXEMPLE, rivale]).some((line) => line.includes('aussi pris par rivale'))).toBe(true);
  });

  it('refuse une règle qui contredit ce que Jarvis décide déjà', () => {
    const problems = checkExpressRules([EXEMPLE], { existing: (text) => (text.includes('40') ? 'calcul' : null) });
    expect(problems).toEqual(['exemple-luminosite : essai « pour » n° 3 déjà réglé par « calcul »']);
    // La même équipe qu'une règle en place n'est pas une contradiction.
    expect(checkExpressRules([EXEMPLE], { existing: () => 'pc' })).toEqual([]);
  });

  it('désigne l’équipe ; dans le doute ou sans l’équipe, ne décide rien', () => {
    expect(matchExpressRules([EXEMPLE], 'Monte la luminosité', TOUTES)).toEqual({ team: 'pc', rule: 'exemple-luminosite' });
    expect(matchExpressRules([EXEMPLE], 'Bonjour', TOUTES)).toBeNull();
    expect(matchExpressRules([EXEMPLE], 'Monte la luminosité', new Set<OrchestraTeam>(['conversation']))).toBeNull();
    const autre: ExpressRule = { ...EXEMPLE, id: 'autre', team: 'web' };
    expect(matchExpressRules([EXEMPLE, autre], 'Monte la luminosité', TOUTES)).toBeNull();
    expect(matchExpressRules([], 'Monte la luminosité', TOUTES)).toBeNull();
  });
});

describe('règles express de Jarvis (EXPRESS_RULES)', () => {
  /** Ce que Jarvis règle déjà sans ces règles : calcul, horloge, règles express en place. */
  function dejaRegle(text: string): string | null {
    if (solveArithmetic(text)) return 'calcul';
    if (clockReply(text, new Date('2026-11-17T12:00:00'))) return 'horloge';
    return expressTeam({ text, history: [], available: TOUTES, now: new Date('2026-11-17T12:00:00') });
  }

  it('chaque règle a ses essais pour et contre, et aucun n’échoue', () => {
    expect(checkExpressRules(EXPRESS_RULES, { existing: dejaRegle })).toEqual([]);
  });

  it('chaque règle vise une équipe qui existe', () => {
    for (const rule of EXPRESS_RULES) expect(ORCHESTRA_TEAMS).toContain(rule.team);
  });
});

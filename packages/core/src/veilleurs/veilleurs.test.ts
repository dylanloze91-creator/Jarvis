import { describe, expect, it } from 'vitest';
import {
  attenteApresEchec,
  conditionVraie,
  etatInitial,
  passage,
  passages,
  prochainPassage,
  reprendre,
  veilleursEnRetard,
  verifierManifeste,
  type DependancesVeilleurs,
  type EtatVeilleur,
  type Lecture,
  type ManifesteVeilleur,
} from './veilleurs.js';

const MINUTE = 60_000;

function manifeste(extra: Partial<ManifesteVeilleur> = {}): ManifesteVeilleur {
  return {
    id: 'buse-trop-chaude',
    nom: 'Buse trop chaude',
    actif: true,
    planning: { type: 'intervalle', secondes: 60 },
    regarder: 'imprimante_etat',
    si: { champ: 'temperature_buse', op: '>', valeur: 280 },
    alors: 'pause_impression',
    prevenir: ['telephone', 'enceinte'],
    message: 'La buse est à {valeur} degrés.',
    ...extra,
  };
}

function fausses(lectures: (Lecture | Error)[]) {
  const appels = { regarder: 0, agir: [] as string[], prevenir: [] as string[] };
  const deps: DependancesVeilleurs = {
    regarder: async () => {
      const suivante = lectures[Math.min(appels.regarder, lectures.length - 1)]!;
      appels.regarder += 1;
      if (suivante instanceof Error) throw suivante;
      return suivante;
    },
    agir: async (action) => {
      appels.agir.push(action);
      return { ok: true, detail: 'impression mise en pause' };
    },
    prevenir: async (_canaux, message) => {
      appels.prevenir.push(message);
    },
  };
  return { deps, appels };
}

describe('manifeste', () => {
  it('un manifeste correct passe', () => {
    expect(verifierManifeste(manifeste())).toEqual([]);
  });

  it('refuse toute action qui démarre, chauffe ou fait bouger', () => {
    for (const action of ['lancer_impression', 'chauffer_plateau', 'avancer_robot']) {
      const problemes = verifierManifeste(manifeste({ alors: action as ManifesteVeilleur['alors'] }));
      expect(problemes.join(' ')).toContain('action refusée');
    }
  });

  it('refuse un intervalle trop court, une heure fausse, un canal inconnu', () => {
    expect(verifierManifeste(manifeste({ planning: { type: 'intervalle', secondes: 5 } })).join(' ')).toContain('trop court');
    expect(verifierManifeste(manifeste({ planning: { type: 'heures', heures: ['25:00'] } })).join(' ')).toContain('heure invalide');
    expect(verifierManifeste(manifeste({ prevenir: ['pigeon' as 'ecran'] })).join(' ')).toContain('endroit inconnu');
  });
});

describe('planning', () => {
  it('intervalle : maintenant plus la période', () => {
    expect(prochainPassage({ type: 'intervalle', secondes: 120 }, 1_000)).toBe(121_000);
  });

  it('heures fixes : la prochaine heure du jour, sinon le lendemain, en sautant les jours exclus', () => {
    const lundi8h = new Date(2026, 10, 23, 8, 0).getTime(); // lundi 23 novembre 2026
    expect(new Date(prochainPassage({ type: 'heures', heures: ['07:30', '18:00'] }, lundi8h)).getHours()).toBe(18);
    const apres = prochainPassage({ type: 'heures', heures: ['07:30'], jours: [3] }, lundi8h);
    expect(new Date(apres).getDay()).toBe(3);
    expect(new Date(apres).getHours()).toBe(7);
  });

  it('attente après échec : 10 s, 20 s, 40 s… jusqu’à 5 minutes', () => {
    expect([1, 2, 3, 10].map(attenteApresEchec)).toEqual([10_000, 20_000, 40_000, 300_000]);
  });
});

describe('condition', () => {
  it('compare nombres et textes, refuse un type différent ou une valeur absente', () => {
    expect(conditionVraie({ champ: 't', op: '>', valeur: 5 }, { t: 6 })).toBe(true);
    expect(conditionVraie({ champ: 't', op: '>', valeur: 5 }, { t: '6' })).toBe(false);
    expect(conditionVraie({ champ: 't', op: '>', valeur: 5 }, {})).toBe(false);
    expect(conditionVraie({ champ: 'etat', op: '==', valeur: 'error' }, { etat: 'error' })).toBe(true);
    expect(conditionVraie({ champ: 'en_ligne', op: '==', valeur: false }, { en_ligne: false })).toBe(true);
    expect(conditionVraie({ champ: 'etat', op: '>', valeur: 'a' }, { etat: 'b' })).toBe(false);
  });
});

describe('passage', () => {
  it('lit, ne fait rien tant que tout va bien', async () => {
    const { deps, appels } = fausses([{ temperature_buse: 210 }]);
    const etat = etatInitial(manifeste(), 0);
    await passage(manifeste(), etat, 0, deps);
    expect(appels).toMatchObject({ regarder: 1, agir: [], prevenir: [] });
    expect(etat.prochain).toBe(60_000);
  });

  it('agit dans le sens de la sécurité, puis prévient avec la valeur et ce qui a été fait', async () => {
    const { deps, appels } = fausses([{ temperature_buse: 291.4 }]);
    const etat = etatInitial(manifeste(), 0);
    await passage(manifeste(), etat, 0, deps);
    expect(appels.agir).toEqual(['pause_impression']);
    expect(appels.prevenir[0]).toBe('La buse est à 291,4 degrés. J’ai fait : impression mise en pause.');
  });

  it('ne passe pas avant son heure', async () => {
    const { deps, appels } = fausses([{ temperature_buse: 300 }]);
    const etat = etatInitial(manifeste(), 0);
    await passage(manifeste(), etat, 0, deps);
    await passage(manifeste(), etat, 30_000, deps);
    expect(appels.regarder).toBe(1);
  });

  it('ne prévient pas deux fois pour la même chose pendant le silence', async () => {
    const { deps, appels } = fausses([{ temperature_buse: 300 }]);
    const m = manifeste({ silenceMinutes: 30 });
    const etat = etatInitial(m, 0);
    for (let minute = 0; minute <= 31; minute += 1) await passage(m, etat, minute * MINUTE, deps);
    expect(appels.prevenir).toHaveLength(2);
    expect(etat.journal.some((entree) => entree.quoi === 'silence')).toBe(true);
  });

  it('exige la condition plusieurs passages de suite si demandé', async () => {
    const { deps, appels } = fausses([{ temperature_buse: 300 }, { temperature_buse: 200 }, { temperature_buse: 300 }, { temperature_buse: 300 }]);
    const m = manifeste({ si: { champ: 'temperature_buse', op: '>', valeur: 280, passages: 2 } });
    const etat = etatInitial(m, 0);
    for (let minute = 0; minute < 4; minute += 1) await passage(m, etat, minute * MINUTE, deps);
    expect(appels.prevenir).toHaveLength(1);
  });

  it('au-delà de la limite d’actions dans l’heure, prévient sans agir', async () => {
    const { deps, appels } = fausses([{ temperature_buse: 300 }]);
    const m = manifeste({ silenceMinutes: 0, actionsParHeure: 2 });
    const etat = etatInitial(m, 0);
    for (let minute = 0; minute < 3; minute += 1) await passage(m, etat, minute * MINUTE, deps);
    expect(appels.agir).toHaveLength(2);
    expect(appels.prevenir).toHaveLength(3);
    expect(appels.prevenir[2]).toContain('trop d’actions');
  });

  it('une lecture qui rate : nouvel essai avec attente, puis pause après 3 échecs, et il le dit', async () => {
    const { deps, appels } = fausses([new Error('délai dépassé')]);
    const m = manifeste();
    const etat = etatInitial(m, 0);
    await passage(m, etat, 0, deps);
    expect(etat.prochain).toBe(10_000);
    await passage(m, etat, 10_000, deps);
    expect(etat.prochain).toBe(30_000);
    await passage(m, etat, 30_000, deps);
    expect(etat.enPause).toBe(true);
    expect(appels.prevenir[0]).toContain('en pause');
    await passage(m, etat, 10 * MINUTE, deps);
    expect(appels.regarder).toBe(3);
    reprendre(etat, 11 * MINUTE);
    expect(etat.enPause).toBe(false);
  });

  it('une erreur définitive (jeton refusé) met en pause tout de suite', async () => {
    const { deps } = fausses([new Error('401 Unauthorized')]);
    const etat = etatInitial(manifeste(), 0);
    await passage(manifeste(), etat, 0, deps);
    expect(etat.enPause).toBe(true);
  });

  it('un manifeste modifié à la main avec une action interdite est mis en pause sans rien faire', async () => {
    const { deps, appels } = fausses([{ temperature_buse: 300 }]);
    const m = manifeste({ alors: 'lancer_impression' as ManifesteVeilleur['alors'] });
    const etat = etatInitial(m, 0);
    await passage(m, etat, 0, deps);
    expect(etat.enPause).toBe(true);
    expect(appels).toMatchObject({ regarder: 0, agir: [] });
  });

  it('une action qui lève est notée et dite, sans casser le veilleur', async () => {
    const { deps, appels } = fausses([{ temperature_buse: 300 }]);
    deps.agir = async () => {
      throw new Error('Moonraker ne répond pas');
    };
    const etat = etatInitial(manifeste(), 0);
    await passage(manifeste(), etat, 0, deps);
    expect(appels.prevenir[0]).toContain('ça a raté');
    expect(etat.enPause).toBe(false);
  });
});

describe('plusieurs veilleurs et bilan', () => {
  it('fait passer chaque veilleur dû et repère ceux en retard ou en pause', async () => {
    const { deps } = fausses([{ temperature_buse: 200 }]);
    const a = manifeste({ id: 'a' });
    const b = manifeste({ id: 'b', regarder: 'autre' });
    const etats = new Map<string, EtatVeilleur>();
    await passages([a, b], etats, 0, deps);
    expect(etats.size).toBe(2);
    etats.get('b')!.enPause = true;
    etats.get('b')!.raisonPause = 'essai';
    const retard = veilleursEnRetard([a, b], etats, 10 * MINUTE);
    expect(retard.map((item) => item.id).sort()).toEqual(['a', 'b']);
    expect(veilleursEnRetard([a, b], etats, 2 * MINUTE).map((item) => item.id)).toEqual(['b']);
  });
});

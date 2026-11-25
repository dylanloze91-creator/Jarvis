import { describe, expect, it } from 'vitest';
import {
  ajouterCoteTrouvee,
  composant,
  ecrireFichierCotes,
  etatCoteTrouvee,
  fusionnerCotes,
  lireFichierCotes,
  provenanceCotes,
  type CotesTrouvees,
} from './composants.js';
import { deciderAtelier } from './discussion.js';

/**
 * Cotes trouvées ailleurs (cap « chef de projet », § 3 et 5) : la bibliothèque reçoit des cotes
 * venues d'une recherche ou d'une autre équipe, chacune avec sa source. Deux sources qui concordent
 * → sûre (le pied à coulisse n'est plus demandé) ; une seule ou en désaccord → incertaine (il l'est).
 * Les sources ci-dessous sont des noms d'essai, pas de vraies pages.
 */
const ESP = 'esp32_s3_devkitc_1_borniers';
const A = 'source-essai-a (plan du fabricant)';
const B = 'source-essai-b (fiche du revendeur)';

function ajoute(cotes: CotesTrouvees, champ: string, valeur: number, source: string): CotesTrouvees {
  const r = ajouterCoteTrouvee(cotes, ESP, champ, { valeur, source });
  if (r.erreur) throw new Error(r.erreur);
  return r.cotes;
}

describe('cotes trouvées ailleurs', () => {
  it('toujours avec une source, dans les bornes, une lecture par source', () => {
    expect(ajouterCoteTrouvee({}, ESP, 'longueur', { valeur: 63, source: ' ' }).erreur).toBe('Une cote trouvée doit dire d’où elle vient.');
    expect(ajouterCoteTrouvee({}, ESP, 'longueur', { valeur: 900, source: A }).erreur).toMatch(/ça me paraît faux/);
    expect(ajouterCoteTrouvee({}, ESP, 'couleur', { valeur: 1, source: A }).erreur).toBe('Je ne connais pas cette cote.');
    const deux = ajoute(ajoute({}, 'longueur', 63, A), 'longueur', 64, A);
    expect(deux[ESP]!.longueur).toEqual([{ valeur: 64, source: A }]);
  });

  it('deux sources qui concordent : sûre ; une seule : incertaine ; en désaccord : incertaine sans valeur', () => {
    expect(etatCoteTrouvee([{ valeur: 63, source: A }, { valeur: 63.1, source: B }])).toEqual({ etat: 'sur', valeur: 63.05, sources: [A, B] });
    expect(etatCoteTrouvee([{ valeur: 63, source: A }])).toEqual({ etat: 'incertain', valeur: 63, sources: [A] });
    expect(etatCoteTrouvee([{ valeur: 63, source: A }, { valeur: 69, source: B }])).toEqual({ etat: 'incertain', sources: [A, B], desaccord: [63, 69] });
  });

  it('pour dessiner : la mesure de l’utilisateur passe d’abord, puis les cotes sûres ; jamais une incertaine', () => {
    let cotes = ajoute(ajoute({}, 'longueur', 63, A), 'longueur', 63, B);
    cotes = ajoute(cotes, 'largeur', 28, A);
    const m = fusionnerCotes({ [ESP]: { epaisseur: 1.6 } }, cotes);
    expect(m[ESP]).toEqual({ epaisseur: 1.6, longueur: 63 });
    expect(fusionnerCotes({ [ESP]: { longueur: 62 } }, cotes)[ESP]!.longueur).toBe(62);
  });

  it('provenance : d’où vient chaque cote, et ce qui reste à mesurer', () => {
    let cotes = ajoute(ajoute({}, 'longueur', 63, A), 'longueur', 63, B);
    cotes = ajoute(cotes, 'largeur', 28, A);
    cotes = ajoute(ajoute(cotes, 'epaisseur', 1.6, A), 'epaisseur', 2.2, B);
    const p = provenanceCotes(ESP, { [ESP]: { trou_diametre: 3.2 } }, cotes);
    const nom = composant(ESP)!.nom;
    expect(p.sources).toEqual([
      `${nom}, la longueur de la carte : 63 mm (${A} ; ${B})`,
      `${nom}, le diamètre des trous de fixation : mesuré au pied à coulisse par l'utilisateur`,
    ]);
    expect(p.incertitudes).toEqual([
      `${nom}, la largeur de la carte : 28 mm sur une seule source (${A}) — à mesurer.`,
      `${nom}, l’épaisseur de la carte : les sources ne concordent pas (1,6 / 2,2 mm) — à mesurer.`,
    ]);
  });

  it('toutes les cotes de l’ESP32 trouvées et sûres : plus de question au pied à coulisse', () => {
    const valeurs: Record<string, number> = {
      longueur: 63, largeur: 28, epaisseur: 1.6, trou_diametre: 3.2, entraxe_x: 57, entraxe_y: 22.6, trou_bord_x: 3, trou_bord_y: 2.7, hauteur_dessus: 12, hauteur_dessous: 3,
    };
    let cotes: CotesTrouvees = {};
    for (const [champ, v] of Object.entries(valeurs)) cotes = ajoute(ajoute(cotes, champ, v, A), champ, v, B);
    const phrase = 'Fais-moi une boîte de 100 par 60 par 40 avec des plots pour un ESP32';
    const sans = deciderAtelier(phrase, null, { mesures: {} });
    expect(sans).toMatchObject({ kind: 'dire', etat: { etape: 'mesure' } });
    expect(deciderAtelier(phrase, null, { mesures: fusionnerCotes({}, cotes) }).kind).toBe('fabriquer');
    // Une seule incertaine : la question revient, pour cette cote-là.
    const presque = { ...cotes, [ESP]: { ...cotes[ESP]!, epaisseur: [{ valeur: 1.6, source: A }] } };
    const d = deciderAtelier(phrase, null, { mesures: fusionnerCotes({}, presque) });
    expect(d).toMatchObject({ kind: 'dire', etat: { etape: 'mesure', champ: 'epaisseur' } });
  });

  it('fichier : relu tel qu’écrit ; une lecture sans source ou hors bornes est ignorée', () => {
    const cotes = ajoute(ajoute({}, 'longueur', 63, A), 'longueur', 63, B);
    expect(lireFichierCotes(ecrireFichierCotes(cotes))).toEqual(cotes);
    const abime = JSON.stringify({ cotes: { [ESP]: { longueur: [{ valeur: 63 }, { valeur: 999, source: A }, { valeur: 63, source: B }] }, inconnu: { x: [] } } });
    expect(lireFichierCotes(abime)).toEqual({ [ESP]: { longueur: [{ valeur: 63, source: B }] } });
    expect(lireFichierCotes('pas du json')).toEqual({});
  });
});

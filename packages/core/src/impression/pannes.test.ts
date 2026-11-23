import { describe, expect, it } from 'vitest';
import { PANNES } from './pannes.js';
import { analyserGcode } from './gcode.js';
import { controlerPlateau } from './plateau.js';
import { mesurerFeuille, restesSurPlateau } from './vision.js';
import {
  cameraCalee,
  cameraVraie,
  dessiner,
  ecrireGcode,
  FEUILLE,
  PARC_Y,
  piece,
  rect,
  SCENARIOS_PENDANT,
  simulerImpression,
  TROIS,
  type ResultatSimulation,
} from './simulateur.testkit.js';

/**
 * Chaque panne du catalogue marquée « simulée » est rejouée ici. Le simulateur dessine ce que
 * verrait la caméra et passe par toute la chaîne (vision → objet par objet → surveillance).
 */
const SIMULEES = new Set<string>();
function simulation(id: string, nom: string, fn: () => void): void {
  SIMULEES.add(id);
  it(`${id} : ${nom}`, fn, 120_000);
}

const NOM = (i: number) => TROIS[i]!.nom;
const textes = (r: ResultatSimulation) => r.dits.map((d) => d.text);
const mentionne = (r: ResultatSimulation, motif: string) => textes(r).filter((t) => t.includes(motif));

const vraie = cameraVraie();
const cam = cameraCalee(vraie);
const TETE: [number, number, number] = [5, PARC_Y, 10];

describe('avant de lancer : le fichier', () => {
  simulation('hors_feuille', 'un objet dépasse de la feuille', () => {
    const c = controlerPlateau(analyserGcode(ecrireGcode([piece('cale', 100, 100, 120, 120, 5), piece('equerre', 285, 140, 299, 160, 5)])), {
      feuille: { minX: 0, maxX: 290, minY: 0, maxY: 300 },
    });
    expect(c.verdict).toBe('bloquant');
    const r = c.remarques.find((m) => m.code === 'hors_feuille')!;
    expect(r.objet).toBe('equerre');
    expect(r.texte).toContain('à droite');
    expect(r.texte).toContain('dans le vide');
    expect(c.remarques.some((m) => m.objet === 'cale')).toBe(false);
  });

  simulation('ilot_vide', 'une partie de pièce commence dans l’air', () => {
    const c = controlerPlateau(
      analyserGcode(ecrireGcode([{ nom: 'figurine', morceaux: [{ x0: 100, y0: 100, x1: 110, y1: 110, z0: 0, z1: 20 }, { x0: 120, y0: 100, x1: 130, y1: 110, z0: 10, z1: 20 }] }])),
    );
    expect(c.verdict).toBe('bloquant');
    const r = c.remarques.find((m) => m.code === 'ilot_vide')!;
    expect(r.texte).toContain('10,2 mm');
    expect(r.texte).toContain('posée sur rien');
  });

  simulation('ne_touche_pas', 'objet qui commence au-dessus du plateau', () => {
    const c = controlerPlateau(analyserGcode(ecrireGcode([piece('flotte', 100, 100, 110, 110, 8, 4)])));
    expect(c.remarques.map((m) => m.code)).toEqual(['ne_touche_pas']);
    expect(c.remarques[0]!.texte).toContain('4,2 mm');
  });

  simulation('hors_volume', 'matière hors du volume', () => {
    const c = controlerPlateau(analyserGcode(ecrireGcode([piece('long', 280, 100, 310, 110, 3)])));
    expect(c.remarques.map((m) => m.code)).toEqual(['hors_volume']);
    expect(c.resume).toContain('Je te déconseille de lancer.');
    expect(c.resume).toContain('à droite');
  });

  simulation('bord', 'objet collé au bord', () => {
    const c = controlerPlateau(analyserGcode(ecrireGcode([piece('clip', 1, 100, 11, 110, 3)])));
    expect(c.verdict).toBe('a_verifier');
    expect(c.remarques[0]!.code).toBe('bord');
  });

  simulation('colles', 'deux objets se touchent', () => {
    const c = controlerPlateau(analyserGcode(ecrireGcode([piece('a', 100, 100, 110, 110, 3), piece('b', 110.5, 100, 120, 110, 3)])));
    expect(c.remarques.map((m) => m.code)).toEqual(['colle']);
    expect(c.remarques[0]!.texte).toContain('se touchent');
  });

  simulation('bascule', 'haut sur une petite base', () => {
    const c = controlerPlateau(analyserGcode(ecrireGcode([piece('antenne', 100, 100, 104, 104, 40)])));
    expect(c.remarques.map((m) => m.code)).toEqual(['bascule']);
    expect(c.remarques[0]!.texte).toContain('brim');
  });

  simulation('hors_maillage', 'hors de la zone palpée', () => {
    const c = controlerPlateau(analyserGcode(ecrireGcode([piece('coin', 10, 10, 25, 25, 3)])), { maillage: { minX: 30, maxX: 270, minY: 30, maxY: 270 } });
    expect(c.remarques.map((m) => m.code)).toEqual(['hors_maillage']);
  });

  it('plateau bien rempli : rien à dire', () => {
    const c = controlerPlateau(analyserGcode(ecrireGcode([piece('a', 40, 40, 70, 70, 10), piece('b', 120, 40, 150, 70, 10), { nom: 'rond', morceaux: [], cercle: { cx: 200, cy: 200, r: 20, z1: 8 } }], { purge: true })));
    expect(c.verdict).toBe('ok');
    expect(c.resume).toBe('Plateau vérifié : les 3 objets sont bien placés.');
  });
});

describe('avant de lancer : la caméra', () => {
  simulation('feuille_decalee', 'feuille mal posée, mesurée puis recontrôlée', () => {
    for (const [dx, dy] of [[8, 0], [-5, 6], [3.5, -2]] as [number, number][]) {
      const m = mesurerFeuille(dessiner(vraie, { blocs: [], decalageFeuille: [dx, dy], tete: TETE, graineBruit: 4 }), cam, FEUILLE, PARC_Y);
      expect(Math.abs(m.dx! - dx)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.dy! - dy)).toBeLessThanOrEqual(1);
    }
    const droite = mesurerFeuille(dessiner(vraie, { blocs: [], decalageFeuille: [8, 0], tete: TETE, graineBruit: 4 }), cam, FEUILLE, PARC_Y);
    expect(Math.abs(droite.dx!)).toBeGreaterThan(6);
    // Une pièce bien placée sur une feuille à sa place ne l'est plus sur la feuille décalée de 8 mm.
    const analyse = analyserGcode(ecrireGcode([piece('cale', 4, 100, 20, 120, 5)]));
    expect(controlerPlateau(analyse).verdict).toBe('ok');
    const recontrole = controlerPlateau(analyse, { decalage: { dx: droite.dx!, dy: droite.dy! } });
    expect(recontrole.verdict).toBe('bloquant');
    expect(recontrole.remarques[0]!.texte).toContain('feuille décalée');
  });

  simulation('feuille_absente', 'bords de la feuille introuvables', () => {
    const m = mesurerFeuille(dessiner(vraie, { blocs: [], sansFeuille: true, tete: TETE, graineBruit: 4 }), cam, FEUILLE, PARC_Y);
    expect(m.dx).toBeNull();
    expect(m.dy).toBeNull();
  });

  simulation('restes_plateau', 'une pièce oubliée sur le plateau', () => {
    const vide = dessiner(vraie, { blocs: [], tete: TETE, graineBruit: 4 });
    const reste = restesSurPlateau(vide, dessiner(vraie, { blocs: [{ polygone: rect(230, 220, 250, 240), z0: 0, z1: 6 }], tete: TETE, graineBruit: 5 }), cam, FEUILLE, TETE);
    expect(reste.blocs).toBeGreaterThan(4);
    expect(reste.endroit).toBe('au fond à droite');
    expect(Math.abs(reste.centre![0] - 240)).toBeLessThan(10);
    // Lumière différente, plateau vide : rien.
    expect(restesSurPlateau(vide, dessiner(vraie, { blocs: [], tete: TETE, graineBruit: 6, lumiere: 25, degrade: 15 }), cam, FEUILLE, TETE).centre).toBeNull();
  });
});

describe('pendant : la caméra, objet par objet (images simulées)', () => {
  simulation('normale', 'impression normale : tête, petits fils, lumière qui varie, coup de lumière', () => {
    const r = simulerImpression(SCENARIOS_PENDANT.normale!);
    expect(r.dits).toEqual([]);
    expect(r.exclusions).toEqual([]);
    expect(r.pauses).toEqual([]);
  });

  simulation('spaghetti_un_objet', 'un objet part en spaghetti : lui seul est arrêté, 2 minutes après l’alerte', () => {
    const r = simulerImpression(SCENARIOS_PENDANT.spaghetti_un_objet!);
    const alerte = r.dits.find((d) => d.level === 'alerte' && d.text.includes('« support n°2 » rate'))!;
    expect(alerte.couche).toBeLessThanOrEqual(18);
    expect(alerte.text).toContain('spaghetti');
    expect(alerte.text).toContain('Les 2 autres vont bien');
    expect(r.exclusions).toEqual([{ couche: alerte.couche + 4, nom: NOM(1) }]);
    expect(mentionne(r, 'est arrêté, vérifié')).toHaveLength(1);
    expect(mentionne(r, '« support »')).toEqual([]);
    expect(mentionne(r, 'n°3')).toEqual([]);
    expect(r.pauses).toEqual([]);
    expect(r.etatSurveillance.incidents.some((i) => i.includes('support n°2'))).toBe(true);
  });

  it('« garde-le » : l’objet n’est pas arrêté et Jarvis ne le redit plus', () => {
    const r = simulerImpression(SCENARIOS_PENDANT.spaghetti_un_objet!, { reponses: [{ couche: 18, nom: NOM(1), reponse: 'garder' }] });
    expect(r.exclusions).toEqual([]);
    expect(mentionne(r, 'rate')).toHaveLength(1);
    expect(mentionne(r, 'je laisse')).toHaveLength(1);
    expect(r.pauses).toEqual([]);
  }, 120_000);

  it('« arrête-le » : arrêt tout de suite', () => {
    const r = simulerImpression(SCENARIOS_PENDANT.spaghetti_un_objet!, { reponses: [{ couche: 18, nom: NOM(1), reponse: 'arreter' }] });
    expect(r.exclusions).toEqual([{ couche: 18, nom: NOM(1) }]);
  }, 120_000);

  it('réglage « seulement prévenir » : jamais d’arrêt tout seul', () => {
    const r = simulerImpression(SCENARIOS_PENDANT.spaghetti_un_objet!, { reglages: { exclureSeul: false, exclureApresMs: 120_000 } });
    expect(r.exclusions).toEqual([]);
    expect(mentionne(r, 'arrête cet objet')).toHaveLength(1);
  }, 120_000);

  simulation('objet_decolle', 'un objet est poussé par la buse : lui seul est arrêté', () => {
    const r = simulerImpression(SCENARIOS_PENDANT.objet_decolle!);
    expect(r.exclusions.map((e) => e.nom)).toEqual([NOM(2)]);
    expect(r.exclusions[0]!.couche).toBeLessThanOrEqual(22);
    expect(mentionne(r, '« support »')).toEqual([]);
    expect(mentionne(r, 'n°2')).toEqual([]);
    expect(r.pauses).toEqual([]);
  });

  simulation('spaghetti_seul_objet', 'l’unique objet part en spaghetti : pause de toute l’impression', () => {
    const r = simulerImpression(SCENARIOS_PENDANT.spaghetti_seul_objet!);
    expect(r.exclusions).toEqual([]);
    expect(r.pauses).toHaveLength(1);
    expect(r.pauses[0]!.couche).toBeLessThanOrEqual(18);
    expect(r.pauses[0]!.reason).toBe('De la matière s’accumule à côté de la pièce (fils emmêlés, « spaghetti »).');
  });

  simulation('decalage_couche', 'décalage de couche de 10 mm : pause', () => {
    const r = simulerImpression(SCENARIOS_PENDANT.decalage_couche!);
    expect(r.exclusions).toEqual([]);
    expect(r.pauses).toHaveLength(1);
    expect(r.pauses[0]!.couche).toBeLessThanOrEqual(20);
    expect(r.pauses[0]!.reason).toContain('en même temps');
  });

  simulation('plateau_bouge', 'la feuille glisse de 8 mm pendant l’impression : pause', () => {
    const r = simulerImpression(SCENARIOS_PENDANT.plateau_bouge!);
    expect(r.exclusions).toEqual([]);
    expect(r.pauses).toHaveLength(1);
    expect(r.pauses[0]!.couche).toBeLessThanOrEqual(20);
  });

  simulation('buse_bouchee', 'plus rien ne sort : doute après 10 couches, pause après 20', () => {
    const r = simulerImpression(SCENARIOS_PENDANT.buse_bouchee!);
    const doute = r.dits.find((d) => d.text.includes('Bobine vide ou buse bouchée'))!;
    expect(doute.couche).toBe(30);
    expect(r.pauses).toHaveLength(1);
    expect(r.pauses[0]!.couche).toBe(40);
    expect(r.exclusions).toEqual([]);
  });

  simulation('camera_bougee', 'caméra bousculée : un doute, aucune pause', () => {
    const r = simulerImpression(SCENARIOS_PENDANT.camera_bougee!);
    expect(r.pauses).toEqual([]);
    expect(r.exclusions).toEqual([]);
    expect(r.dits.map((d) => d.text)).toEqual([expect.stringContaining('La caméra a bougé')]);
    expect(r.dits[0]!.couche).toBe(12);
  });
});

describe('catalogue des pannes', () => {
  it('identifiants uniques, et chaque panne simulée a son essai ici', () => {
    expect(new Set(PANNES.map((p) => p.id)).size).toBe(PANNES.length);
    const manquantes = PANNES.filter((p) => p.essai && 'simulation' in p.essai && !SIMULEES.has(p.essai.simulation)).map((p) => p.id);
    expect(manquantes).toEqual([]);
  });

  it('ce que Jarvis ne voit pas est dit tel quel, sans essai inventé', () => {
    for (const p of PANNES) {
      if (p.fiabilite === 'non') expect(p.essai).toBeNull();
      if (p.fiabilite === 'sure' || p.fiabilite === 'probable') expect(p.essai).not.toBeNull();
    }
    expect(PANNES.filter((p) => p.fiabilite === 'non').length).toBeGreaterThanOrEqual(4);
  });
});

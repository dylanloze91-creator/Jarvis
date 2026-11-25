import { describe, expect, it } from 'vitest';
import { ajoutsDe, appliquerAjouts, avecAjouts, couvercleDe, direAjout, lireAjouts, placerAjouts, type Ajout } from './ajouts.js';
import { deciderAtelier, type AtelierEtat } from './discussion.js';
import { fabriquer, fichePiece, gabarit, type Valeurs } from './gabarits.js';
import { plier } from './lecture.js';
import { choisirVisM3 } from './visserie.js';

const BOITE = gabarit('boite')!;
const COUV = gabarit('boite_couvercle')!;

function valeurs(g = BOITE, v: Valeurs = {}): Valeurs {
  const p = fabriquer(g, { longueur: 120, largeur: 80, hauteur: 40, ...v });
  if (!p.ok) throw new Error(p.erreurs.join(' '));
  return p.valeurs;
}

function lire(phrase: string) {
  return lireAjouts(plier(phrase));
}

function appliquer(g: typeof BOITE, v: Valeurs, phrase: string) {
  return appliquerAjouts(g, v, lire(phrase).ops);
}

/** Une pièce à l'écran, comme la discussion la garde. */
function ecran(g: typeof BOITE, v: Valeurs): Extract<AtelierEtat, { etape: 'piece' }> {
  const p = fabriquer(g, v);
  if (!p.ok) throw new Error(p.erreurs.join(' '));
  return {
    etape: 'piece',
    gabarit: g.id,
    nom: g.nom,
    dossier: 'x',
    versionChoisie: 1,
    plateau: { x: 300, y: 300 },
    versions: [{ numero: 1, valeurs: p.valeurs, fiche: fichePiece(p), mesures: [], taille: p.taille, stl: 'v1.stl' }],
  };
}

describe('visserie : la règle de prise', () => {
  it('la vis M3 la plus longue qui entre de 3,5 à 5,7 mm dans l’insert', () => {
    expect(choisirVisM3(2)).toEqual({ longueur: 6, prise: 4 });
    expect(choisirVisM3(2.5)).toEqual({ longueur: 8, prise: 5.5 });
    expect(choisirVisM3(11)).toEqual({ longueur: 16, prise: 5 });
    expect(choisirVisM3(13)).toBeNull();
  });
});

describe('ajouts : lire les phrases', () => {
  it('« ajoute quatre bossages avec insert M3 à 7 mm des coins »', () => {
    const r = lire('ajoute quatre bossages avec insert M3 à 7 mm des coins');
    expect(r.ops).toEqual([{ action: 'ajouter', genre: 'bossages', champs: { genre: 'bossages', distance: 7 } }]);
    expect(r.reste).toBe('');
  });

  it('« le bossage plus haut », « les bossages de 20 mm de haut » : modifier', () => {
    expect(lire('le bossage plus haut').ops[0]).toMatchObject({ action: 'modifier', genre: 'bossages', plus: { mesure: 'hauteur', sens: 1 } });
    expect(lire('les bossages de 20 mm de haut').ops[0]).toMatchObject({ action: 'modifier', champs: { hauteur: 20 } });
    expect(lire('enlève les bossages').ops[0]).toMatchObject({ action: 'enlever', genre: 'bossages' });
  });

  it('« fais que le couvercle s’emboîte », « un rebord intérieur pour le couvercle »', () => {
    expect(lire('fais que le couvercle s’emboîte').ops[0]).toMatchObject({ action: 'ajouter', genre: 'emboitement' });
    expect(lire('ajoute un rebord intérieur pour le couvercle').ops[0]).toMatchObject({ action: 'ajouter', genre: 'rebord' });
    // « rebord de 8 » reste la mesure du couvercle (hauteur de sa lèvre), pas un rebord intérieur.
    expect(lire('le rebord de 8').ops).toEqual([]);
  });

  it('plots : vis, entraxe, place ; l’avant-trou n’est pas un trou à percer', () => {
    const r = lire('ajoute 4 plots M2,5 avec un entraxe de 58 par 49 avec un avant-trou');
    expect(r.ops[0]!.champs).toMatchObject({ vis: 'M2.5', entraxe: [58, 49] });
    expect(r.reste).not.toMatch(/trou/);
    expect(lire('4 plots M2 entraxe 20 x 30, à 15 mm de la gauche et 12 mm de l’avant').ops[0]!.champs).toMatchObject({ vis: 'M2', entraxe: [20, 30], depuisGauche: 15, depuisAvant: 12 });
  });

  it('« mets des plots pour un Raspberry Pi 5 » : la carte de la bibliothèque (étape 2) ; une carte inconnue est dite', () => {
    const r = appliquer(BOITE, valeurs(), 'mets des plots pour un Raspberry Pi 5 dans le fond, ports vers l’arrière');
    expect(r.erreurs).toEqual([]);
    expect(r.ajouts).toEqual([{ genre: 'composant', composant: 'raspberry_pi_5', ports: 'arriere' }]);
    const inconnue = appliquer(BOITE, valeurs(), 'mets des plots pour un Arduino');
    expect(inconnue.erreurs[0]).toMatch(/^Je ne connais pas cette carte\. Je connais : le Raspberry Pi 5/);
  });

  it('nervure : sens, hauteur, épaisseur', () => {
    expect(lire('ajoute une nervure de 6 mm dans la largeur').ops[0]!.champs).toEqual({ genre: 'nervure', sens: 'largeur', hauteur: 6 });
    expect(lire('une nervure de 10 mm de haut et 2 mm d’épaisseur').ops[0]!.champs).toMatchObject({ hauteur: 10, epaisseur: 2 });
  });

  it('une phrase sans ajout ne donne rien', () => {
    expect(lire('ajoute un trou de 8 à l’arrière').ops).toEqual([]);
    expect(lire('quelle heure est-il').ops).toEqual([]);
  });
});

describe('ajouts : appliquer et refuser', () => {
  it('bossages, puis « plus haut » refusé quand ils montent déjà jusqu’en haut', () => {
    const v = avecAjouts(valeurs(), appliquer(BOITE, valeurs(), 'ajoute quatre bossages avec insert M3').ajouts);
    const r = appliquer(BOITE, v, 'le bossage plus haut');
    expect(r.erreurs).toEqual(['Les bossages montent déjà jusqu’en haut de la boîte.']);
  });

  it('« le bossage plus haut » quand la hauteur a été dite : +25 %', () => {
    const v = avecAjouts(valeurs(), appliquer(BOITE, valeurs(), 'ajoute quatre bossages avec insert M3 de 16 mm de haut').ajouts);
    const r = appliquer(BOITE, v, 'le bossage plus haut');
    expect(r.ajouts[0]!.hauteur).toBe(20);
    expect(r.changements[0]).toBe('4 bossages avec insert M3 aux coins, 16 mm de haut → 4 bossages avec insert M3 aux coins, 20 mm de haut');
  });

  it('emboîtement sur une boîte sans couvercle : refusé', () => {
    expect(appliquer(BOITE, valeurs(), 'fais que le couvercle s’emboîte').erreurs).toEqual(['Cette boîte n’a pas de couvercle : demande-moi « une boîte avec couvercle ».']);
  });

  it('le rebord intérieur et l’emboîtement s’excluent', () => {
    const v0 = valeurs(COUV);
    const v1 = avecAjouts(v0, appliquer(COUV, v0, 'fais que le couvercle s’emboîte').ajouts);
    const r = appliquer(COUV, v1, 'ajoute un rebord intérieur pour le couvercle');
    expect(r.ajouts.map((a) => a.genre)).toEqual(['rebord']);
    expect(r.changements[0]).toMatch(/^Retiré : un couvercle qui s’emboîte/);
  });

  it('pas dans une entretoise', () => {
    const r = appliquerAjouts(gabarit('entretoise')!, {}, lire('ajoute quatre bossages').ops);
    expect(r.erreurs[0]).toMatch(/dans les boîtes seulement/);
  });
});

describe('ajouts : dessiner', () => {
  const avec = (g: typeof BOITE, v: Valeurs, ajouts: Ajout[]) => placerAjouts(g.id, avecAjouts(v, ajouts));

  it('bossages : insert de 4 mm sur 6 mm, collés aux parois, matière autour vérifiée', () => {
    const p = avec(BOITE, valeurs(BOITE, { paroi: 2 }), [{ genre: 'bossages', distance: 7 }]);
    expect(p.erreurs).toEqual([]);
    expect(p.plus.filter((s) => s.includes('cylinder(h = 38.01, d = 8)'))).toHaveLength(4);
    expect(p.plus.filter((s) => s.includes('cube('))).toHaveLength(4); // blocs d'angle
    expect(p.moins).toContain('translate([7, 7, 34]) cylinder(h = 6.01, d = 4);');
    const fin = avec(BOITE, valeurs(), [{ genre: 'bossages', diametre: 6 }]);
    expect(fin.erreurs[0]).toMatch(/au moins 1,5 mm de matière autour de l’insert, donc un bossage de 7 mm de diamètre au moins/);
    const court = avec(BOITE, valeurs(), [{ genre: 'bossages', hauteur: 4 }]);
    expect(court.erreurs[0]).toMatch(/trop court pour l’insert/);
  });

  it('boîte à couvercle : le couvercle est percé, fraisé, la lèvre entaillée, la vis choisie', () => {
    const v = valeurs(COUV);
    const p = avec(COUV, v, [{ genre: 'bossages', distance: 7 }, { genre: 'emboitement' }]);
    expect(p.erreurs).toEqual([]);
    // Coin avant-gauche de la boîte → couvercle retourné, à côté : x = 120 + 10 + 7, y = 80 − 7.
    expect(p.moins).toContain('translate([137, 73, -1]) cylinder(h = 4, d = 3.4);');
    expect(p.moins).toContain('translate([137, 73, -0.01]) cylinder(h = 1.51, d1 = 6.4, d2 = 3.4);');
    expect(p.moins).toContain('translate([137, 73, 2]) cylinder(h = 7, d = 9.2);');
    expect(p.notes).toEqual(['Couvercle : 4 vis M3 × 6 à tête fraisée (4 mm dans les inserts).']);
    expect(couvercleDe(avecAjouts(v, [{ genre: 'emboitement' }]))).toEqual({ plat: false, levre: 1.2, jeu: 0.25 });
  });

  it('rebord intérieur : chanfrein dessous, couvercle en plaque posée, taille juste', () => {
    const v = avecAjouts(valeurs(COUV, { paroi: 2 }), [{ genre: 'rebord' }]);
    const p = placerAjouts('boite_couvercle', v);
    expect(p.erreurs).toEqual([]);
    expect(p.plus[0]).toMatch(/^difference\(\) \{ .* hull\(\) \{/);
    const piece = fabriquer(COUV, v);
    if (!piece.ok) throw new Error(piece.erreurs.join(' '));
    expect(piece.taille).toEqual([120 + 10 + 120 - 4 - 0.5, 80, 40]);
    expect(piece.scad).toContain('une plaque posée sur le rebord intérieur');
  });

  it('plots : avant-trou M2,5 de 2,1 mm, refus s’ils sortent du fond', () => {
    const p = avec(BOITE, valeurs(), [{ genre: 'plots', vis: 'M2.5', entraxe: [58, 49] }]);
    expect(p.erreurs).toEqual([]);
    expect(p.moins).toContain('translate([31, 15.5, 2.6]) cylinder(h = 4.41, d = 2.1);');
    expect(avec(BOITE, valeurs(), [{ genre: 'plots', entraxe: [118, 49] }]).erreurs[0]).toMatch(/ne tiennent pas dans le fond/);
    expect(avec(BOITE, valeurs(), [{ genre: 'plots' }]).erreurs[0]).toMatch(/l’écart des trous/);
  });

  it('nervure : trop haute refusée', () => {
    expect(avec(BOITE, valeurs(), [{ genre: 'nervure', hauteur: 6 }]).erreurs).toEqual([]);
    expect(avec(BOITE, valeurs(), [{ genre: 'nervure', hauteur: 60 }]).erreurs[0]).toMatch(/trop haute/);
  });

  it('les mots', () => {
    expect(direAjout({ genre: 'bossages', distance: 7 })).toBe('4 bossages avec insert M3 à 7 mm des coins');
    expect(direAjout({ genre: 'plots', vis: 'M2.5', entraxe: [58, 49] })).toBe('4 plots M2,5 de 5 mm, entraxe 58 × 49 mm, au centre du fond');
  });
});

describe('ajouts dans la discussion', () => {
  it('les phrases de la mission, l’une après l’autre, font chacune une version', () => {
    let etat: Extract<AtelierEtat, { etape: 'piece' }> = ecran(COUV, { longueur: 120, largeur: 80, hauteur: 40 });
    for (const phrase of ['ajoute quatre bossages avec insert M3 à 7 mm des coins', 'fais que le couvercle s’emboîte']) {
      const d = deciderAtelier(phrase, etat);
      if (d.kind !== 'fabriquer') throw new Error(`${phrase} : ${d.kind}`);
      expect(fabriquer(d.gabarit, d.valeurs).ok).toBe(true);
      etat = ecran(COUV, d.valeurs);
    }
    expect(ajoutsDe(etat.versions[0]!.valeurs).map((a) => a.genre)).toEqual(['bossages', 'emboitement']);
    // « le bossage plus haut » ne change pas la hauteur de la boîte.
    const d = deciderAtelier('le bossage plus haut', etat);
    expect(d).toMatchObject({ kind: 'dire', texte: 'Les bossages montent déjà jusqu’en haut de la boîte. La version 1 reste à l\'écran.' });
  });

  it('une nouvelle pièce avec ses ajouts dans la même phrase', () => {
    const d = deciderAtelier('Fais-moi une boîte avec couvercle de 120 par 80 par 40 avec quatre bossages avec insert M3', null);
    if (d.kind !== 'fabriquer') throw new Error(d.kind);
    expect(d.valeurs).toMatchObject({ longueur: 120, largeur: 80, hauteur: 40 });
    expect(ajoutsDe(d.valeurs)).toEqual([{ genre: 'bossages' }]);
  });
});

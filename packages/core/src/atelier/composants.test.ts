import { describe, expect, it } from 'vitest';
import { ajoutsDe } from './ajouts.js';
import {
  ajouterMesure,
  composant,
  composantNomme,
  COMPOSANTS,
  ecrireFichierMesures,
  enveloppeCarte,
  geometrieCarte,
  jeuPrise,
  lireFichierMesures,
  lireMesure,
  poserCarte,
  prochaineMesure,
  questionMesure,
  type MesuresComposants,
} from './composants.js';
import { deciderAtelier, type AtelierEtat } from './discussion.js';
import { fabriquer, fichePiece, gabarit, type Valeurs } from './gabarits.js';
import { ALLONGEMENT_MAX, bouton, champCamera, chariot, fenetresCameraHub, flexionRetenue, reglageChariot, retenue, volet } from './tenir.js';

const PI = composant('raspberry_pi_5')!;
const ESP = composant('esp32_s3_devkitc_1_borniers')!;

function equilibre(text: string): boolean {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const stack: string[] = [];
  for (const c of text) {
    if ('([{'.includes(c)) stack.push(c);
    else if (c in pairs && stack.pop() !== pairs[c]) return false;
  }
  return stack.length === 0;
}

function ecran(id: string, v: Valeurs): Extract<AtelierEtat, { etape: 'piece' }> {
  const g = gabarit(id)!;
  const p = fabriquer(g, v);
  if (!p.ok) throw new Error(p.erreurs.join(' '));
  return { etape: 'piece', gabarit: id, nom: g.nom, dossier: 'x', versionChoisie: 1, plateau: { x: 300, y: 300 }, versions: [{ numero: 1, valeurs: p.valeurs, fiche: fichePiece(p), mesures: [], taille: p.taille, stl: 'v1.stl' }] };
}

describe('bibliothèque : les données', () => {
  it('états et sources gardés ; aucune cote inventée pour les composants à mesurer', () => {
    expect(PI.etat).toBe('sur');
    expect(PI.sources.some((s) => s.includes('RP-008347'))).toBe(true);
    expect(composant('camera_module_3_wide')!.etat).toBe('sur');
    for (const id of ['esp32_s3_devkitc_1_borniers', 'max98357a', 'inmp441', 'oled_1_3_sh1106', 'haut_parleur_3w_4ohm']) {
      expect(composant(id)!.etat).toBe('a_mesurer');
      expect(geometrieCarte(composant(id)!, {})).toBeNull();
    }
    expect(COMPOSANTS).toHaveLength(8);
  });

  it('les noms dans une phrase', () => {
    expect(composantNomme('mets des plots pour un raspberry pi 5 dans le fond')?.id).toBe('raspberry_pi_5');
    expect(composantNomme('pose l esp32 dans la boite')?.id).toBe('esp32_s3_devkitc_1_borniers');
    expect(composantNomme('une boite de 80 par 50')).toBeNull();
  });

  it('Raspberry Pi 5 : enveloppe prudente, trous, prises avec leur jeu', () => {
    const g = geometrieCarte(PI, {})!;
    expect(g.trous.map((t) => [t.x, t.y])).toEqual([[3.5, 3.5], [3.5, 52.5], [61.5, 3.5], [61.5, 52.5]]);
    expect(g.prises.map((p) => p.nom)).toEqual(['Ethernet', 'USB 1', 'USB 2', 'USB-C alimentation', 'micro-HDMI 0', 'micro-HDMI 1']);
    expect(g.prises.every((p) => p.jeu >= 0.5)).toBe(true);
    // Ventilateur officiel (incertain) 15,5 mm + 4 mm d'air ; le plus haut de tout.
    expect(g.hauteurLibre).toBe(19.5);
    expect(enveloppeCarte(g)).toEqual({ x: [-2.5, 88], y: [0, 56], z: [-1.5, 19.5] });
  });
});

describe('bibliothèque : les mesures de l’utilisateur', () => {
  it('une question à la fois, avec où poser le pied à coulisse', () => {
    const q = prochaineMesure(ESP, {})!;
    expect(q.champ).toBe('longueur');
    expect(questionMesure(ESP, q, {})).toMatch(/^Je n’ai pas de cotes fiables pour ESP32-S3 .* il faut le mesurer au pied à coulisse \(5 mesures, une à la fois\)\. Mesure 1 sur 5 : la longueur de la carte, en millimètres\. Pour ça, pose les becs/);
    const m = ajouterMesure({}, ESP.id, 'longueur', 62).mesures;
    expect(questionMesure(ESP, prochaineMesure(ESP, m)!, m)).toMatch(/^Mesure 2 sur 5 : la largeur de la carte/);
    expect(prochaineMesure(PI, {})).toBeNull();
  });

  it('mesure lue, mesure hors bornes refusée, fichier relu sans rien perdre', () => {
    expect(lireMesure('62,5 mm')).toBe(62.5);
    expect(lireMesure('6 cm')).toBe(60);
    expect(lireMesure('je ne sais pas')).toBeNull();
    expect(ajouterMesure({}, ESP.id, 'epaisseur', 40).erreur).toMatch(/ça me paraît faux/);
    const m: MesuresComposants = { [ESP.id]: { longueur: 62, largeur: 67 } };
    expect(lireFichierMesures(ecrireFichierMesures(m))).toEqual(m);
    expect(lireFichierMesures('{pas du json')).toEqual({});
    expect(lireFichierMesures('{"composants":{"inconnu":{"a":1},"max98357a":{"largeur":"x","longueur":20}}}')).toEqual({ max98357a: { longueur: 20 } });
  });
});

describe('Raspberry Pi 5 posé dans une boîte (essai de la mission)', () => {
  // Le socle de la référence : 202,5 × 120, parois 2,4, fond 2,4, capot à 30,5.
  const SOCLE = { L: 202.5, W: 120, H: 33, e: 2.4, f: 2.4, zHaut: 30.5 };

  it('ports à l’arrière : chaque plot tombe sur son trou à 0,01 mm près, aux places de la référence', () => {
    const p = poserCarte('le Raspberry Pi 5', geometrieCarte(PI, {})!, SOCLE, 'arriere');
    expect(p.erreurs).toEqual([]);
    // hub.py : pi_x1 = FW/2 − 2,4 − 0,5 ; trous en (pi_x1 − py, pi_y0 + px), ici depuis le bord gauche.
    const reference = [[196.1, 34.6], [147.1, 34.6], [196.1, 92.6], [147.1, 92.6]];
    p.verif.plots.forEach((v, i) => {
      expect(Math.hypot(v.plot[0] - v.trou[0], v.plot[1] - v.trou[1])).toBeLessThan(0.01);
      expect(Math.hypot(v.plot[0] - reference[i]![0]!, v.plot[1] - reference[i]![1]!)).toBeLessThan(0.01);
    });
  });

  it('chaque prise passe dans son ouverture avec 0,45 mm de jeu au moins ; 1 mm de paroi devant l’USB-C', () => {
    for (const ports of ['arriere', 'avant', 'gauche', 'droite'] as const) {
      const p = poserCarte('le Raspberry Pi 5', geometrieCarte(PI, {})!, { ...SOCLE, H: 60, zHaut: 58 }, ports);
      expect(p.erreurs).toEqual([]);
      expect(p.verif.prises).toHaveLength(6);
      for (const q of p.verif.prises) expect(jeuPrise(q.prise, q.ouverture, q.rayon)).toBeGreaterThanOrEqual(0.45);
    }
    const p = poserCarte('le Raspberry Pi 5', geometrieCarte(PI, {})!, SOCLE, 'arriere');
    const usbc = p.verif.prises.find((q) => q.nom === 'USB-C alimentation')!;
    expect(usbc.paroi).toBe('droite');
    expect(usbc.paroiRestante).toBeCloseTo(1, 9);
    // Même place que la référence : z de 8,3 à 12,7, centre à y = 31,1 + 11,2.
    expect(usbc.ouverture.z[0]).toBeCloseTo(8.3, 9);
    expect(usbc.ouverture.z[1]).toBeCloseTo(12.7, 9);
    expect((usbc.ouverture.a[0] + usbc.ouverture.a[1]) / 2).toBeCloseTo(42.3, 9);
    expect(p.verif.prises.find((q) => q.nom === 'Ethernet')!.paroi).toBe('arriere');
  });

  it('refus : boîte trop petite, trop basse', () => {
    const g = geometrieCarte(PI, {})!;
    expect(poserCarte('le Raspberry Pi 5', g, { L: 120, W: 80, H: 40, e: 2, f: 2, zHaut: 40 }, 'arriere').erreurs[0]).toMatch(/^Le Raspberry Pi 5 ne tient pas dans le fond : il faut 61,0 × 93,5|^Le Raspberry Pi 5 ne tient pas dans le fond/);
    expect(poserCarte('le Raspberry Pi 5', g, { ...SOCLE, H: 25, zHaut: 25 }, 'arriere').erreurs[0]).toMatch(/la boîte est trop basse. Il faut 26 mm au-dessus du fond/);
  });
});

describe('écran : retenues souples (essai de la mission)', () => {
  it('fléchissent de 0 à 3 mm pour un bord de 7,5 à 10,5 mm, allongement de 2,5 % au plus', () => {
    for (let bord = 7.5; bord <= 10.5 + 1e-9; bord += 0.25) {
      const f = flexionRetenue(bord);
      expect(f.fleche).toBeGreaterThanOrEqual(0);
      expect(f.fleche).toBeLessThanOrEqual(3 + 1e-9);
      expect(f.allongement).toBeLessThanOrEqual(ALLONGEMENT_MAX);
    }
    // Les chiffres du banc de la référence : 1,1 mm, 3,7 N, 0,7 % pour 8,6 mm ; 3 mm, 10,2 N, 2 % pour 10,5.
    const a = flexionRetenue(8.6);
    expect([a.fleche, a.effort, a.allongement].map((x) => Math.round(x * 10) / 10)).toEqual([1.1, 3.7, 0.7]);
    const b = flexionRetenue(10.5);
    expect([b.fleche, b.effort, b.allongement].map((x) => Math.round(x * 10) / 10)).toEqual([3, 10.2, 2]);
  });
});

describe('caméra : chariot et champ (essai de la mission)', () => {
  it('le champ de 120° en diagonale n’est coupé par rien, objectif décalé de −0,5, 0 et +0,5 mm', () => {
    for (const d of [-0.5, 0, 0.5]) {
      const champ = champCamera(fenetresCameraHub(), d);
      expect(champ).toMatchObject({ ok: true, rayons: 2880, bloques: 0 });
      expect(champCamera(fenetresCameraHub(), d, 'coins')).toMatchObject({ ok: true, rayons: 240, bloques: 0 });
    }
  });

  it('une fenêtre trop étroite est vue', () => {
    const etroite = fenetresCameraHub().map((f) => ({ ...f, largeur: f.largeur - 4 }));
    const c = champCamera(etroite, 0);
    expect(c.ok).toBe(false);
    expect(c.coupe.length).toBeGreaterThan(0);
  });

  it('le réglage du chariot couvre toutes les positions d’objectif trouvées dans les sources', () => {
    const [a, b] = reglageChariot();
    for (const v of composant('camera_module_3_wide') ? [5.75, 9.5, 13.4] : []) {
      expect(v).toBeGreaterThanOrEqual(a);
      expect(v).toBeLessThanOrEqual(b);
    }
  });

  it('les pièces des manières de tenir s’écrivent en OpenSCAD', () => {
    for (const f of [retenue(), volet(), bouton(), chariot()]) {
      expect(equilibre(f.scad)).toBe(true);
      expect(f.scad).toMatch(/^difference\(\)/);
    }
  });
});

describe('bibliothèque dans la discussion', () => {
  it('« mets des plots pour un Raspberry Pi 5 dans le fond, ports vers l’arrière »', () => {
    const d = deciderAtelier('mets des plots pour un Raspberry Pi 5 dans le fond, ports vers l’arrière', ecran('boite', { longueur: 120, largeur: 100, hauteur: 40 }));
    if (d.kind !== 'fabriquer') throw new Error(d.kind === 'dire' ? d.texte : d.kind);
    expect(ajoutsDe(d.valeurs)).toEqual([{ genre: 'composant', composant: 'raspberry_pi_5', ports: 'arriere' }]);
    expect(d.changement).toBe('Ajout : le Raspberry Pi 5 sur ses plots, prises vers l’arrière');
    const p = fabriquer(d.gabarit, d.valeurs);
    if (!p.ok) throw new Error(p.erreurs.join(' '));
    expect(equilibre(p.scad)).toBe(true);
    expect(p.notes?.[0]).toBe('Raspberry Pi 5 : 4 vis autotaraudeuses M2,5 × 6 (4,5 mm dans les plots).');
  });

  it('trop petite : dit, la version reste', () => {
    const d = deciderAtelier('mets des plots pour un Raspberry Pi 5, ports vers l’arrière', ecran('boite', { longueur: 120, largeur: 80, hauteur: 40 }));
    if (d.kind !== 'fabriquer') throw new Error(d.kind);
    const p = fabriquer(d.gabarit, d.valeurs);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.erreurs[0]).toMatch(/ne tient pas dans le fond/);
  });

  it('écran tactile ou caméra : pas sur des plots, dit simplement', () => {
    const d = deciderAtelier('mets la caméra dans la boîte', ecran('boite', { longueur: 120, largeur: 100, hauteur: 40 }));
    expect(d.kind).toBe('dire');
    if (d.kind === 'dire') expect(d.texte).toMatch(/se tient autrement/);
  });

  it('ESP32 à mesurer : une question à la fois, puis la pièce avec ses mesures', () => {
    const piece = ecran('boite', { longueur: 120, largeur: 100, hauteur: 40 });
    const phrase = 'mets des plots pour l’ESP32, ports vers l’avant';
    let mesures: MesuresComposants = {};
    let d = deciderAtelier(phrase, piece, { mesures });
    if (d.kind !== 'dire' || d.etat?.etape !== 'mesure') throw new Error(d.kind);
    expect(d.texte).toMatch(/Mesure 1 sur 5 : la longueur de la carte/);
    // Les trous de fixation ne se demandent pas (sans eux, la carte tient dans des glissières).
    const reponses: Record<string, number> = { longueur: 62, largeur: 67, epaisseur: 1.6, hauteur_dessus: 15, hauteur_dessous: 3 };
    let etat: AtelierEtat = d.etat;
    for (let i = 0; i < 5; i += 1) {
      if (etat.etape !== 'mesure') throw new Error('pas une mesure');
      const r = deciderAtelier(`${reponses[etat.champ]} mm`, etat, { mesures });
      if (r.kind !== 'mesure') throw new Error(r.kind);
      mesures = ajouterMesure(mesures, r.composant, r.champ, r.valeur).mesures;
      d = deciderAtelier(r.reprise.texte, r.reprise.piece, { mesures });
      if (d.kind === 'dire' && d.etat) etat = d.etat;
    }
    if (d.kind !== 'fabriquer') throw new Error(d.kind);
    expect(ajoutsDe(d.valeurs)[0]).toMatchObject({ genre: 'composant', composant: ESP.id, ports: 'avant', mesures: reponses });
    expect(fabriquer(d.gabarit, d.valeurs).ok).toBe(true);
  });

  it('une valeur absurde : refusée, la même question revient', () => {
    const d = deciderAtelier('mets des plots pour l’ESP32', ecran('boite', { longueur: 120, largeur: 100, hauteur: 40 }));
    if (d.kind !== 'dire' || d.etat?.etape !== 'mesure') throw new Error(d.kind);
    const r = deciderAtelier('900', d.etat);
    expect(r).toMatchObject({ kind: 'dire', etat: d.etat });
    if (r.kind === 'dire') expect(r.texte).toMatch(/ça me paraît faux.*Mesure 1 sur 5/);
  });
});

import { describe, expect, it } from 'vitest';
import { ajoutsDe } from './ajouts.js';
import {
  ajouterCoteTrouvee,
  composant,
  etatCoteTrouvee,
  fusionnerCotes,
  geometrieCarte,
  lameMini,
  poserCarte,
  produitsNommes,
  provenanceCotes,
  referenceDite,
  type CotesTrouvees,
  type MesuresComposants,
} from './composants.js';
import { deciderAtelier, SOURCE_LARGE } from './discussion.js';
import { fabriquer, gabarit } from './gabarits.js';
import { plier } from './lecture.js';
import { cotesDuPlan, direPlan, lireDxf } from './plan.js';
import { pageDuProduit, produitEnAnglais, requetesCotes } from './rechercheCotes.js';

/**
 * Étape 3 des boîtiers (demande du 25 novembre) : un boîtier qui assemble plusieurs composants, les
 * plans des fabricants, et l'examen « un boîtier pour un ESP32-S3 DevKitC-1 avec un écran OLED 1,3
 * pouce I2C, prise USB à l'arrière ». Les plans et les cotes ci-dessous sont inventés pour le test.
 */
const ESP = 'esp32_s3_devkitc_1_borniers';
const OLED = 'oled_1_3_sh1106';
const EXAMEN = 'Dessine-moi un boîtier pour un ESP32-S3 DevKitC-1 avec un écran OLED 1,3 pouce I2C, prise USB à l’arrière';

/** Un DXF minimal : unité, puis les entités (chaque entité : liste de paires code/valeur). */
function dxf(insunits: number, entites: (string | number)[][]): string {
  const lignes: (string | number)[] = [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, insunits, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES'];
  for (const e of entites) lignes.push(...e);
  lignes.push(0, 'ENDSEC', 0, 'EOF');
  return lignes.join('\n');
}
const rect = (calque: string, x0: number, y0: number, x1: number, y1: number) => [0, 'LWPOLYLINE', 8, calque, 90, 4, 70, 1, 10, x0, 20, y0, 10, x1, 20, y0, 10, x1, 20, y1, 10, x0, 20, y1];
const cercle = (calque: string, x: number, y: number, r: number) => [0, 'CIRCLE', 8, calque, 10, x, 20, y, 40, r];
const texte = (calque: string, x: number, y: number, t: string) => [0, 'TEXT', 8, calque, 10, x, 20, y, 1, t];

/** Une carte d'essai de 60 × 25 : broches, une prise USB au bord x−, un module qui dépasse au bord x+. */
const PLAN_SANS_TROUS = dxf(0, [
  rect('BOARD_OUTLINE', 0, 0, 60, 25),
  ...[5, 7.54, 10.08].map((x) => cercle('DRILLHOLE', x, 1.27, 0.5)),
  rect('TOP_ASSY', -0.8, 9, 5, 16.5),
  texte('SILK', 2.5, 12, 'USB'),
  rect('TOP_ASSY', 55, 4, 66, 21),
  texte('DIM', 30, -5, '60.00mm'),
  [0, 'LINE', 8, 'DIM', 10, 0, 20, -3, 11, 60, 21, -3],
  texte('DIM', 0, -10, 'ESSAI-BOARD-1'),
]);

describe('plans des fabricants (DXF)', () => {
  it('contour, aucun trou de fixation, une prise nommée, un module qui dépasse', () => {
    const r = lireDxf(PLAN_SANS_TROUS);
    if (!r.ok) throw new Error(r.raison);
    expect(r.plan).toMatchObject({ calque: 'BOARD_OUTLINE', longueur: 60, largeur: 25, trous: [] });
    expect(r.plan.unite).toMatch(/cote écrite/);
    expect(r.plan.prises).toEqual([{ bord: 'x-', centre: 12.75, largeur: 7.5, depasse: expect.closeTo(0.8, 5), nom: 'USB' }]);
    expect(r.plan.depassements).toEqual({ 'x+': 6 });
    expect(direPlan(r.plan)).toBe('carte de 60 × 25 mm, aucun trou de fixation, 1 prise (USB), un module qui dépasse du bord');
    expect(cotesDuPlan(r.plan)).toEqual([
      { champ: 'longueur', valeur: 60 },
      { champ: 'largeur', valeur: 25 },
      { champ: 'sans_trous', valeur: 1 },
      { champ: 'prise_bord', valeur: 2 },
      { champ: 'prise1_centre', valeur: 12.75 },
      { champ: 'prise1_largeur', valeur: 7.5 },
      { champ: 'prise1_depasse', valeur: 0.8 },
      { champ: 'depasse_xp', valeur: 6 },
    ]);
  });

  it('quatre trous en rectangle : les cotes de fixation ; carte dessinée en hauteur : remise en longueur', () => {
    const plan = dxf(4, [rect('Edge.Cuts', 0, 0, 25, 60), ...[[3.5, 3.5], [21.5, 3.5], [3.5, 56.5], [21.5, 56.5]].map(([x, y]) => cercle('Drill', x!, y!, 1.6))]);
    const r = lireDxf(plan);
    if (!r.ok) throw new Error(r.raison);
    expect(r.plan.longueur).toBe(60);
    expect(cotesDuPlan(r.plan)).toEqual(
      expect.arrayContaining([
        { champ: 'trou_diametre', valeur: 3.2 },
        { champ: 'entraxe_x', valeur: 53 },
        { champ: 'entraxe_y', valeur: 18 },
        { champ: 'trou_bord_x', valeur: 3.5 },
        { champ: 'trou_bord_y', valeur: 3.5 },
      ]),
    );
  });

  it('rien de sûr : pas de contour, unité inconnue, pas un DXF', () => {
    expect(lireDxf(dxf(4, [rect('SILK', 0, 0, 60, 25)]))).toEqual({ ok: false, raison: 'je n’y trouve pas de calque de contour de carte' });
    expect(lireDxf(dxf(0, [rect('BOARD_OUTLINE', 0, 0, 60, 25)]))).toEqual({ ok: false, raison: 'je ne sais pas en quelle unité il est dessiné' });
    expect(lireDxf('%PDF-1.7 …').ok).toBe(false);
  });

  it('une cote lue sur le plan suffit seule ; une page qui la contredit est dite, le plan l’emporte', () => {
    let c: CotesTrouvees = ajouterCoteTrouvee({}, ESP, 'longueur', { valeur: 60, source: 'https://fab.test/plan.dxf', plan: true }).cotes;
    expect(etatCoteTrouvee(c[ESP]!.longueur!)).toMatchObject({ etat: 'sur', valeur: 60 });
    c = ajouterCoteTrouvee(c, ESP, 'longueur', { valeur: 53, source: 'https://blog.test/esp32' }).cotes;
    expect(etatCoteTrouvee(c[ESP]!.longueur!)).toMatchObject({ etat: 'sur', valeur: 60, contredite: [53] });
    expect(provenanceCotes(ESP, {}, c).incertitudes.join(' ')).toMatch(/une page dit 53 mm, le plan du fabricant 60 mm ; je suis le plan/);
  });
});

describe('la phrase de l’examen', () => {
  it('deux composants nommés, chacun avec sa référence', () => {
    const n = produitsNommes(` ${plier(EXAMEN)} `);
    expect(n.map((x) => [x.composant.id, x.produit, x.precis])).toEqual([
      [ESP, 'esp32 s3 devkitc 1', true],
      [OLED, 'ecran oled 1.3 pouce i2c', true],
    ]);
    expect(n.map((x) => referenceDite(EXAMEN, x.produit))).toEqual(['ESP32-S3 DevKitC-1', 'écran OLED 1,3 pouce I2C']);
    expect(produitsNommes(' fais moi un boitier pour mon esp32 ')[0]!.precis).toBe(false);
  });

  it('les références précises : cherchées tout de suite, toutes les deux, sans redemander le modèle', () => {
    expect(deciderAtelier(EXAMEN, null, { rechercheCotes: true })).toEqual({
      kind: 'chercherCotes',
      recherches: [
        { composant: ESP, produit: 'ESP32-S3 DevKitC-1' },
        { composant: OLED, produit: 'écran OLED 1,3 pouce I2C' },
      ],
      reprise: { texte: EXAMEN, piece: null },
    });
    // Déjà cherchées pour ces références, plans compris : pas de nouvelle recherche, la question de ce qui manque.
    const produits = { [ESP]: { produit: 'ESP32-S3 DevKitC-1', plans: true }, [OLED]: { produit: 'écran OLED 1,3 pouce I2C', plans: true } };
    const d = deciderAtelier(EXAMEN, null, { rechercheCotes: true, produits, cherches: [ESP, OLED] });
    expect(d).toMatchObject({ kind: 'dire', etat: { etape: 'mesure', composant: ESP, champ: 'longueur' } });
    // Une recherche d'avant sans les plans : elle est refaite.
    expect(deciderAtelier(EXAMEN, null, { rechercheCotes: true, produits: { [ESP]: { produit: 'ESP32-S3 DevKitC-1' } }, cherches: [ESP] })).toMatchObject({ kind: 'chercherCotes' });
  });

  it('requêtes en anglais, et la taille de l’écran doit être la même sur la page', () => {
    expect(produitEnAnglais('écran OLED 1,3 pouce I2C')).toBe('display OLED 1.3 inch I2C');
    expect(requetesCotes('écran OLED 1,3 pouce I2C')).toEqual([
      'display OLED 1.3 inch I2C dimensions mm',
      'display OLED 1.3 inch I2C mounting holes mm',
      'display OLED 1.3 inch I2C datasheet board size',
      'display OLED 1.3 inch I2C dxf mechanical drawing',
    ]);
    expect(pageDuProduit('1.3 inch IIC OLED module, 128x64', 'écran OLED 1,3 pouce I2C')).toBe(true);
    expect(pageDuProduit('0.96 inch I2C OLED module, 128x64', 'écran OLED 1,3 pouce I2C')).toBe(false);
  });
});

/** Les cotes de l'examen, telles qu'un plan et des pages pourraient les donner (inventées). */
const CARTE = { longueur: 60, largeur: 25, epaisseur: 1.6, hauteur_dessus: 4, hauteur_dessous: 8, sans_trous: 1, prise_bord: 2, prise1_centre: 12.75, prise1_largeur: 7.5, prise1_depasse: 0.8, depasse_xp: 6 };
const ECRAN = { longueur: 35, largeur: 33, epaisseur: 1.2, hauteur_dessus: 1.6, hauteur_dessous: 10, fenetre_largeur: 30, fenetre_hauteur: 15, fenetre_bord_x: 2.5, fenetre_bord_y: 6 };

describe('un boîtier qui assemble une carte et un écran', () => {
  const mesures: MesuresComposants = { [ESP]: CARTE, [OLED]: ECRAN };
  const produits = { [ESP]: { produit: 'ESP32-S3 DevKitC-1', plans: true }, [OLED]: { produit: 'écran OLED 1,3 pouce I2C', plans: true } };

  it('la plus petite boîte qui tient tout est proposée, avec un couvercle pour l’écran ; elle se dessine', () => {
    const d = deciderAtelier(EXAMEN, null, { rechercheCotes: true, mesures, produits, cherches: [ESP, OLED] });
    if (d.kind !== 'dire' || d.etat?.etape !== 'proposition') throw new Error(d.kind);
    expect(d.etat.gabarit).toBe('boite_couvercle');
    expect(d.texte).toMatch(/^Boîte avec couvercle avec le ESP32-S3 DevKitC-1 dans ses glissières, prises vers l’arrière, l’écran OLED 1,3 pouce I2C sous le couvercle, derrière une fenêtre : je propose /);
    const ajouts = ajoutsDe(d.etat.valeurs);
    expect(ajouts.map((a) => [a.composant, a.ports, a.produit])).toEqual([
      [ESP, 'arriere', 'ESP32-S3 DevKitC-1'],
      [OLED, undefined, 'écran OLED 1,3 pouce I2C'],
    ]);
    const p = fabriquer(gabarit('boite_couvercle')!, d.etat.valeurs);
    if (!p.ok) throw new Error(p.erreurs.join(' '));
    // La hauteur : appuis (8 mm de broches + 1), carte, 4 + 3 mm libres, 1 mm, puis l'écran (1,6 + 1,2 + 10).
    expect(p.valeurs.hauteur).toBe(Math.ceil(2 + 9 + 1.6 + 7 + 1 + 12.8));
    expect(p.scad).toMatch(/multmatrix/);
    expect(p.notes?.join(' ')).toMatch(/glissée dans ses glissières, sans vis/);
    expect(p.notes?.join(' ')).toMatch(/calé dans un cadre sous le couvercle/);
  });

  it('une boîte trop basse pour l’écran au-dessus de la carte : la hauteur qu’il faut est dite', () => {
    const v = { longueur: 60, largeur: 80, hauteur: 30, ajouts: JSON.stringify([{ genre: 'composant', composant: ESP, ports: 'arriere', mesures: CARTE }, { genre: 'composant', composant: OLED, mesures: ECRAN }]) };
    const p = fabriquer(gabarit('boite_couvercle')!, v);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.erreurs.join(' ')).toMatch(/L’écran OLED .* : la boîte est trop basse\. Il faut 31,4 mm au-dessus du fond/);
  });

  it('un écran demandé sur une boîte ouverte : elle prend un couvercle', () => {
    const piece = {
      etape: 'piece' as const,
      gabarit: 'boite',
      nom: 'boîte',
      dossier: 'boite-1',
      versions: [{ numero: 1, valeurs: { longueur: 100, largeur: 80, hauteur: 40 }, fiche: '', mesures: [], taille: [100, 80, 40] as [number, number, number], stl: 'v1.stl' }],
      versionChoisie: 1,
      plateau: { x: 250, y: 250 },
    };
    const d = deciderAtelier('ajoute un écran OLED', piece, { mesures });
    expect(d).toMatchObject({ kind: 'fabriquer', gabarit: { id: 'boite_couvercle' } });
    if (d.kind === 'fabriquer') expect(d.changement).toMatch(/Couvercle ajouté \(l’écran se pose dessous\)/);
  });
});

describe('glissières : une carte sans trous de fixation', () => {
  const g = geometrieCarte(composant(ESP)!, { [ESP]: CARTE })!;
  it('appuis au-dessus des broches, butée sous le module qui dépasse, crochets qui plient sans casser', () => {
    const pose = poserCarte('la carte', g, { L: 50, W: 90, H: 60, e: 2, f: 2, zHaut: 54 }, 'arriere');
    expect(pose.erreurs).toEqual([]);
    expect(pose.tenue).toBe('glissieres');
    expect(pose.zDessous).toBe(2 + 9);
    expect(pose.verif.crochets!.allongement).toBeLessThanOrEqual(2.5);
    // La prise USB face à l'arrière, dans la paroi amincie (elle ne dépasse que de 0,8 mm).
    expect(pose.verif.prises).toEqual([expect.objectContaining({ paroi: 'arriere', paroiRestante: 1 })]);
    // La butée du bout où le module dépasse s'arrête sous le dessus de la carte.
    expect(pose.verif.butee).toBeCloseTo(pose.zDessus - 0.2, 6);
    expect(lameMini()).toBeCloseTo(6, 5);
  });

  it('prises demandées mais place inconnue : tout le bord ouvert s’il reste imprimable, sinon rien et c’est dit', () => {
    const etroite = { ...g, largeur: 20, prises: [] };
    const hote = { L: 50, W: 90, H: 60, e: 2, f: 2, zHaut: 54 };
    expect(poserCarte('la carte', etroite, hote, 'arriere', { prisesDemandees: true }).verif.prises).toEqual([expect.objectContaining({ nom: 'prises (place inconnue)', paroi: 'arriere' })]);
    const large = poserCarte('la carte', { ...g, largeur: 40, prises: [] }, { ...hote, L: 70 }, 'arriere', { prisesDemandees: true });
    expect(large.verif.prises).toEqual([]);
    expect(large.incertitudes.join(' ')).toMatch(/ouvrir tout le bord \(40 mm\) ne s’imprimerait pas sans support : je ne perce rien/);
  });

  it('sans broches dessous : la carte est montée assez haut pour que la lame plie', () => {
    const plate = { ...g, hauteurDessous: 0 };
    const pose = poserCarte('la carte', plate, { L: 50, W: 90, H: 60, e: 2, f: 2, zHaut: 54 }, 'arriere');
    expect(pose.zDessus - 2 + 0.15).toBeGreaterThanOrEqual(lameMini() - 1e-9);
    expect(pose.verif.crochets!.allongement).toBeLessThanOrEqual(2.5);
  });
});

describe('sans la pièce : « prends large »', () => {
  it('« prends large partout » : toutes les cotes d’encombrement qui manquent, pour tous les composants de la demande', () => {
    const q = deciderAtelier(EXAMEN, null, { rechercheCotes: true, mesures: { [ESP]: { longueur: 60, largeur: 25 }, [OLED]: { longueur: 35, largeur: 33 } }, produits: { [ESP]: { produit: 'ESP32-S3 DevKitC-1', plans: true }, [OLED]: { produit: 'écran OLED 1,3 pouce I2C', plans: true } } });
    if (q.kind !== 'dire' || q.etat?.etape !== 'mesure') throw new Error(q.kind);
    expect(q.texte).toMatch(/« prends large » : je laisse 2 mm.*« prends large partout »/);
    const d = deciderAtelier('prends large partout', q.etat, { mesures: { [ESP]: { longueur: 60, largeur: 25 }, [OLED]: { longueur: 35, largeur: 33 } } });
    if (d.kind !== 'mesure') throw new Error(d.kind);
    expect(d.larges).toEqual([
      { composant: ESP, champ: 'epaisseur', valeur: 2 },
      { composant: ESP, champ: 'hauteur_dessus', valeur: 15 },
      { composant: ESP, champ: 'hauteur_dessous', valeur: 12 },
      { composant: OLED, champ: 'epaisseur', valeur: 2 },
      { composant: OLED, champ: 'hauteur_dessus', valeur: 3 },
      { composant: OLED, champ: 'hauteur_dessous', valeur: 15 },
      { composant: OLED, champ: 'fenetre_largeur', valeur: -1 },
      { composant: OLED, champ: 'fenetre_hauteur', valeur: -1 },
      { composant: OLED, champ: 'fenetre_bord_x', valeur: -1 },
      { composant: OLED, champ: 'fenetre_bord_y', valeur: -1 },
    ]);
  });

  it('une valeur large passe avant des pages qui se contredisent, mais reste « à vérifier »', () => {
    let c: CotesTrouvees = {};
    for (const [v, s] of [[12, 'https://a.test'], [38, 'https://b.test']] as const) c = ajouterCoteTrouvee(c, ESP, 'hauteur_dessus', { valeur: v, source: s }).cotes;
    expect(fusionnerCotes({}, c, { uneSource: true })[ESP]).toBeUndefined();
    c = ajouterCoteTrouvee(c, ESP, 'hauteur_dessus', { valeur: 15, source: SOURCE_LARGE, choisie: true }).cotes;
    expect(fusionnerCotes({}, c, { uneSource: true })[ESP]).toEqual({ hauteur_dessus: 15 });
    expect(provenanceCotes(ESP, {}, c, { uneSource: true }).incertitudes.join(' ')).toMatch(/15 mm sur une seule source \(valeur large choisie par l’utilisateur, sans la pièce\) — à vérifier quand tu auras la pièce/);
  });

  it('la fenêtre d’un écran dont on ne sait pas où est la zone allumée : ouverte au plus large, dit', () => {
    const e = composant(OLED)!.ecran!({ ...ECRAN, fenetre_bord_x: -1, fenetre_bord_y: -1 })!;
    expect(e.fenetre).toEqual({ x: [1.5, 33.5], y: [1.5, 31.5] });
    expect(e.incertitudes.join(' ')).toMatch(/fenêtre est ouverte au plus large/);
  });

  it('une cote qui n’a pas de valeur large : la phrase le dit, la question reste', () => {
    const q = deciderAtelier('Fais-moi un boîtier pour mon ESP32', null, {});
    if (q.kind !== 'dire' || q.etat?.etape !== 'mesure') throw new Error(q.kind);
    const d = deciderAtelier('je ne sais pas', q.etat, {});
    expect(d).toMatchObject({ kind: 'dire', etat: q.etat });
    if (d.kind === 'dire') expect(d.texte).toMatch(/je ne peux pas prendre de marge/);
  });
});

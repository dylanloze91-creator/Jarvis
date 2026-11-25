import { describe, expect, it } from 'vitest';
import { appliquerDecoupes, avecDecoupes, decoupesDe, direDecoupe, lireDecoupes, placerDecoupes, type Decoupe } from './decoupes.js';
import { deciderAtelier, demandePiece, mesuresAffichees, type AtelierEtat } from './discussion.js';
import { fabriquer, fichePiece, gabarit, type Valeurs } from './gabarits.js';
import { plier } from './lecture.js';

function piece(id: string, valeurs: Valeurs): Extract<AtelierEtat, { etape: 'piece' }> {
  const g = gabarit(id)!;
  const p = fabriquer(g, valeurs);
  if (!p.ok) throw new Error(p.erreurs.join(' '));
  return {
    etape: 'piece',
    gabarit: id,
    nom: g.nom,
    dossier: 'x',
    versionChoisie: 1,
    plateau: { x: 300, y: 300 },
    versions: [{ numero: 1, valeurs: p.valeurs, fiche: fichePiece(p), mesures: mesuresAffichees(g, p.valeurs), taille: p.taille, stl: 'v1.stl' }],
  };
}

function equilibre(text: string): boolean {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const stack: string[] = [];
  for (const c of text.replace(/\/\/.*$/gm, '')) {
    if ('([{'.includes(c)) stack.push(c);
    else if (c in pairs && stack.pop() !== pairs[c]) return false;
  }
  return stack.length === 0;
}

const BOITE = { longueur: 80, largeur: 50, hauteur: 30, paroi: 2, fond: 2 };
const lire = (phrase: string, exigerFace = false) => lireDecoupes(plier(phrase), { exigerFace });

function ajouter(id: string, phrase: string): Decoupe[] {
  const r = appliquerDecoupes(gabarit(id)!, [], lire(phrase).ops);
  expect(r.erreurs).toEqual([]);
  return r.decoupes;
}

describe('découpes : lire la phrase', () => {
  it('trou rond, taille, face et place', () => {
    expect(ajouter('boite', 'un trou de 8 mm à l’arrière')).toEqual([{ forme: 'rond', face: 'arriere', largeur: 8, hauteur: 8, nombre: 1, u: 'centre', v: 'centre' }]);
    const [d] = ajouter('boite', 'un trou de 1 cm sur le côté gauche, en bas');
    expect(d).toMatchObject({ forme: 'rond', face: 'gauche', largeur: 10, v: 'bas' });
    expect(ajouter('boite', 'un trou de 6 à l’avant en bas à droite')[0]).toMatchObject({ face: 'avant', u: 'droite', v: 'bas' });
  });

  it('encadrement, ouverture, passage de 15 par 10 : rectangle', () => {
    expect(ajouter('boite', 'un encadrement de 15 par 10 sur la face avant')[0]).toMatchObject({ forme: 'rect', face: 'avant', largeur: 15, hauteur: 10 });
    expect(ajouter('boite', 'une ouverture de 20 de large et 8 de haut à l’arrière')[0]).toMatchObject({ forme: 'rect', largeur: 20, hauteur: 8 });
    expect(ajouter('boite', 'un passage de câble de 15 x 10 derrière')[0]).toMatchObject({ forme: 'rect', face: 'arriere', largeur: 15, hauteur: 10 });
    expect(ajouter('boite', 'une fenêtre de 12 à droite')[0]).toMatchObject({ forme: 'rect', face: 'droite', largeur: 12, hauteur: 12 });
  });

  it('encoche pour un câble, profondeur facultative', () => {
    expect(ajouter('boite', 'une encoche de 10 mm à l’arrière pour le câble')[0]).toMatchObject({ forme: 'encoche', face: 'arriere', largeur: 10, hauteur: 0 });
    expect(ajouter('boite', 'une encoche de 6 par 12 à gauche')[0]).toMatchObject({ forme: 'encoche', face: 'gauche', largeur: 6, hauteur: 12 });
  });

  it('sans face dite : arrière pour un câble, fond pour des vis, avant sinon ; taille proposée', () => {
    expect(ajouter('boite', 'un passage pour le câble')[0]).toMatchObject({ forme: 'rond', face: 'arriere', largeur: 8 });
    expect(ajouter('boite', 'un trou')[0]).toMatchObject({ face: 'avant', largeur: 8 });
    expect(ajouter('boite', 'quatre trous de fixation aux coins')[0]).toMatchObject({ face: 'dessous', largeur: 4, nombre: 4, coins: true });
    const r = appliquerDecoupes(gabarit('boite')!, [], lire('un trou').ops);
    expect(r.changements[0]).toContain('taille proposée');
  });

  it('la phrase de l’utilisateur : « des trous comme des encadrements pour laisser passer des câbles »', () => {
    const liste = ajouter('boite', 'Fais des trous comme des encadrements pour laisser passer des câbles');
    expect(liste).toEqual([{ forme: 'rect', face: 'arriere', largeur: 20, hauteur: 12, nombre: 2, u: 'centre', v: 'centre' }]);
  });

  it('encoche d’un socle : le côté dit, même avec « dessous »', () => {
    expect(ajouter('socle', 'une encoche dessous vers l’arrière pour le câble')[0]).toMatchObject({ forme: 'encoche', face: 'arriere' });
  });

  it('plusieurs découpes, nombres, les deux côtés', () => {
    const liste = ajouter('boite', 'deux trous de 5 à l’avant et une encoche de 8 à l’arrière');
    expect(liste).toHaveLength(2);
    expect(liste[0]).toMatchObject({ forme: 'rond', nombre: 2, face: 'avant' });
    expect(liste[1]).toMatchObject({ forme: 'encoche', face: 'arriere' });
    expect(ajouter('boite', 'un trou de 6 de chaque côté').map((d) => d.face)).toEqual(['gauche', 'droite']);
  });

  it('la phrase sans les découpes garde les mesures de la pièce', () => {
    const lu = lire('une boîte de 80 par 50 par 30 avec un trou de 8 à l’arrière, hauteur 40');
    expect(lu.ops).toHaveLength(1);
    expect(lu.reste).toContain('80 par 50 par 30');
    expect(lu.reste).toContain('hauteur 40');
    expect(lu.reste).not.toMatch(/ 8( |$)/);
    expect(lu.reste).not.toContain('trou');
  });

  it('enlever, modifier, ou rien', () => {
    expect(lire('enlève le trou').ops[0]).toMatchObject({ action: 'enlever', forme: 'rond', tous: false });
    expect(lire('retire tous les trous').ops[0]).toMatchObject({ action: 'enlever', tous: true });
    expect(lire('le trou plus gros').ops[0]).toMatchObject({ action: 'modifier', taille: 'plus' });
    expect(lire('trou plus petit').ops[0]).toMatchObject({ action: 'modifier', taille: 'moins' });
    expect(lire('mets le trou à l’arrière').ops[0]).toMatchObject({ action: 'modifier', faces: ['arriere'] });
    expect(lire('quelle heure est-il').ops).toEqual([]);
    expect(lire('découpe un trou de 5 à gauche').ops).toHaveLength(1);
  });

  it('pièce qui a sa mesure « trou » : un trou sans face reste la mesure', () => {
    expect(lire('une entretoise de 12 avec un trou de 4', true).ops).toEqual([]);
    expect(lire('un trou de 3 sur le côté', true).ops).toHaveLength(1);
  });
});

describe('découpes : dans la pièce', () => {
  it('boîte : le trou traverse la paroi seulement, sur la bonne face', () => {
    const liste = ajouter('boite', 'un trou de 8 à l’arrière');
    const p = fabriquer(gabarit('boite')!, avecDecoupes(BOITE, liste));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.scad).toContain('difference() {');
    expect(equilibre(p.scad)).toBe(true);
    // Paroi arrière en y = 50 : de 47 à 51 ; centre en x = 40, z = (2 + 1 + 28) / 2 = 15,5.
    expect(p.scad).toContain('translate([40, 47, 15.5]) rotate([-90, 0, 0]) cylinder(h = 4, d = 8);');
    expect(p.taille).toEqual([80, 50, 30]);
  });

  it('côté gauche et droit : couché selon x, gauche et droite vus de l’extérieur', () => {
    const gaucheBas = placerDecoupes('boite', 'boîte', BOITE, [{ forme: 'rond', face: 'gauche', largeur: 6, hauteur: 6, nombre: 1, u: 'gauche', v: 'bas' }]);
    // Vu de la gauche (x = 0), la gauche est vers l’arrière (grands y) : 50 − 2 − 1 − 3 = 44 ; en bas : 2 + 1 + 3 = 6.
    expect(gaucheBas.scad[0]).toBe('translate([-1, 44, 6]) rotate([0, 90, 0]) cylinder(h = 4, d = 6);');
    const droite = placerDecoupes('boite', 'boîte', BOITE, [{ forme: 'rond', face: 'droite', largeur: 6, hauteur: 6, nombre: 1, u: 'gauche', v: 'centre' }]);
    expect(droite.scad[0]).toBe('translate([77, 6, 15.5]) rotate([0, 90, 0]) cylinder(h = 4, d = 6);');
  });

  it('encadrement à l’avant : un pavé dans la paroi', () => {
    const r = placerDecoupes('boite', 'boîte', BOITE, [{ forme: 'rect', face: 'avant', largeur: 15, hauteur: 10, nombre: 1, u: 'centre', v: 'centre' }]);
    expect(r.erreurs).toEqual([]);
    expect(r.scad[0]).toBe('translate([32.5, -1, 10.5]) cube([15, 4, 10]);');
  });

  it('encoche : depuis le bord du haut, fond arrondi', () => {
    const r = placerDecoupes('boite', 'boîte', BOITE, [{ forme: 'encoche', face: 'arriere', largeur: 8, hauteur: 0, nombre: 1, u: 'centre', v: 'centre' }]);
    expect(r.erreurs).toEqual([]);
    expect(r.scad[0]).toBe('union() { translate([36, 47, 26]) cube([8, 4, 5]); translate([40, 47, 26]) rotate([-90, 0, 0]) cylinder(h = 4, d = 8); }');
  });

  it('fond de la boîte et coins', () => {
    const r = placerDecoupes('boite', 'boîte', BOITE, [{ forme: 'rond', face: 'dessous', largeur: 4, hauteur: 4, nombre: 4, u: 'centre', v: 'centre', coins: true }]);
    expect(r.erreurs).toEqual([]);
    expect(r.scad).toHaveLength(4);
    expect(r.scad[0]).toBe('translate([5, 5, -1]) cylinder(h = 4, d = 4);');
  });

  it('boîte avec couvercle : trou dans le couvercle, encoche sous le rebord', () => {
    const g = gabarit('boite_couvercle')!;
    const valeurs = { ...BOITE, jeu: 0.3, rebord: 6, couvercle: 2 };
    const liste = ajouter('boite_couvercle', 'un trou de 10 sur le dessus et une encoche de 8 à l’arrière');
    expect(liste[0]!.face).toBe('couvercle');
    const p = fabriquer(g, avecDecoupes(valeurs, liste));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    // Couvercle à x = 90 ; trou au centre : 90 + 40 = 130, y = 25, à travers sa plaque (2 mm).
    expect(p.scad).toContain('translate([130, 25, -1]) cylinder(h = 4, d = 10);');
    // Encoche : profondeur = rebord + largeur = 14, donc fond arrondi à 30 − 14 + 4 = 20.
    expect(p.scad).toContain('translate([40, 47, 20]) rotate([-90, 0, 0]) cylinder(h = 4, d = 8);');
    expect(equilibre(p.scad)).toBe(true);
    const courte = placerDecoupes('boite_couvercle', g.nom, valeurs, [{ ...liste[1]!, hauteur: 7 }]);
    expect(courte.erreurs[0]).toContain('le rebord du couvercle');
  });

  it('socle et entretoise : pièces centrées, découpes de part en part', () => {
    const socle = placerDecoupes('socle', 'socle', { forme: 'rond', taille: 80, hauteur: 15, logement: 0, profondeur: 5 }, [
      { forme: 'rond', face: 'dessus', largeur: 8, hauteur: 8, nombre: 1, u: 'centre', v: 'centre' },
      { forme: 'encoche', face: 'arriere', largeur: 6, hauteur: 0, nombre: 1, u: 'centre', v: 'centre' },
    ]);
    expect(socle.erreurs).toEqual([]);
    expect(socle.scad[0]).toBe('translate([0, 0, -1]) cylinder(h = 17, d = 8);');
    // Rainure dessous, du bord arrière (y = 40) jusqu’au milieu.
    expect(socle.scad[1]).toBe('union() { translate([-3, 0, -1]) cube([6, 41, 4]); translate([0, 0, 3]) rotate([-90, 0, 0]) cylinder(h = 41, d = 6); }');
    const entretoise = placerDecoupes('entretoise', 'entretoise', { diametre: 20, trou: 4, hauteur: 20 }, [{ forme: 'rond', face: 'gauche', largeur: 3, hauteur: 3, nombre: 1, u: 'centre', v: 'centre' }]);
    expect(entretoise.scad[0]).toBe('translate([-11, 0, 10]) rotate([0, 90, 0]) cylinder(h = 22, d = 3);');
  });

  it('refus dits simplement', () => {
    const trop = placerDecoupes('boite', 'boîte', BOITE, [{ forme: 'rond', face: 'avant', largeur: 40, hauteur: 40, nombre: 1, u: 'centre', v: 'centre' }]);
    expect(trop.erreurs[0]).toMatch(/^Trou de 40 mm à l’avant : ne tient pas/);
    const dessus = placerDecoupes('boite', 'boîte', BOITE, [{ forme: 'rond', face: 'dessus', largeur: 8, hauteur: 8, nombre: 1, u: 'centre', v: 'centre' }]);
    expect(dessus.erreurs[0]).toContain('ouverte sur le dessus');
    const serres = placerDecoupes('boite', 'boîte', BOITE, [{ forme: 'rond', face: 'avant', largeur: 20, hauteur: 20, nombre: 4, u: 'centre', v: 'centre' }]);
    expect(serres.erreurs[0]).toContain('ne tiennent pas côte à côte');
    const crochet = appliquerDecoupes(gabarit('crochet')!, [], lire('un trou de 5 à l’avant').ops);
    expect(crochet.erreurs[0]).toContain('Je ne sais pas encore faire de découpes dans un crochet');
    const p = fabriquer(gabarit('boite')!, avecDecoupes(BOITE, [{ forme: 'rond', face: 'avant', largeur: 40, hauteur: 40, nombre: 1, u: 'centre', v: 'centre' }]));
    expect(p.ok).toBe(false);
  });

  it('rangées dans les mesures, montrées à côté de la pièce', () => {
    const liste = ajouter('boite', 'un trou de 8 à l’arrière');
    const v = avecDecoupes(BOITE, liste);
    expect(decoupesDe(v)).toEqual(liste);
    expect(decoupesDe({ decoupes: 'pas du json' })).toEqual([]);
    expect(avecDecoupes(v, [])).not.toHaveProperty('decoupes');
    expect(mesuresAffichees(gabarit('boite')!, fabriquer(gabarit('boite')!, v).ok ? v : {}).at(-1)).toEqual({ nom: 'Découpe', valeur: 'trou de 8 mm à l’arrière' });
    const p = fabriquer(gabarit('boite')!, v);
    if (p.ok) expect(fichePiece(p)).toBe('Boîte de 80 × 50 × 30 mm. Avec un trou de 8 mm à l’arrière.');
    expect(direDecoupe({ forme: 'rect', face: 'dessous', largeur: 15, hauteur: 10, nombre: 2, u: 'centre', v: 'haut' })).toBe('2 ouvertures de 15 × 10 mm dans le fond, vers l’arrière');
  });
});

describe('découpes : dans la discussion', () => {
  it('nouvelle pièce avec un trou : les mesures restent justes', () => {
    const d = demandePiece('Fais-moi une boîte de 80 par 50 par 30 avec un trou de 8 mm à l’arrière pour le câble');
    expect(d?.gabarit?.id).toBe('boite');
    expect(d?.valeurs).toMatchObject({ longueur: 80, largeur: 50, hauteur: 30 });
    expect(decoupesDe(d!.valeurs)).toEqual([{ forme: 'rond', face: 'arriere', largeur: 8, hauteur: 8, nombre: 1, u: 'centre', v: 'centre' }]);
    const decision = deciderAtelier('Fais-moi une boîte de 80 par 50 par 30 avec un trou de 8 mm à l’arrière', null);
    expect(decision.kind).toBe('fabriquer');
  });

  it('entretoise : « trou de 4 » reste la mesure du trou', () => {
    const d = demandePiece('Fais-moi une entretoise de 12 avec un trou de 4');
    expect(d?.valeurs).toMatchObject({ diametre: 12, trou: 4 });
    expect(d?.valeurs).not.toHaveProperty('decoupes');
  });

  it('pièce à l’écran : ajouter, modifier, enlever, chaque fois une version', () => {
    const etat = piece('boite', BOITE);
    const ajout = deciderAtelier('Ajoute un passage de câble de 15 par 10 sur la face avant, en bas', etat);
    expect(ajout.kind).toBe('fabriquer');
    if (ajout.kind !== 'fabriquer') return;
    expect(ajout.changement).toBe('Ajout : ouverture de 15 × 10 mm à l’avant, en bas');
    expect(ajout.valeurs.hauteur).toBe(30);

    const avecTrou = piece('boite', avecDecoupes(BOITE, ajouter('boite', 'un trou de 8 à l’arrière')));
    const plusGros = deciderAtelier('le trou plus gros', avecTrou);
    expect(plusGros.kind === 'fabriquer' && plusGros.changement).toBe('Trou de 8 mm à l’arrière → trou de 10 mm à l’arrière');
    if (plusGros.kind === 'fabriquer') expect(plusGros.valeurs.hauteur).toBe(30);
    const plusHaut = deciderAtelier('mets le trou plus haut', avecTrou);
    expect(plusHaut.kind === 'fabriquer' && plusHaut.changement).toBe('Trou de 8 mm à l’arrière → trou de 8 mm à l’arrière, en haut');
    const enleve = deciderAtelier('enlève le trou', avecTrou);
    expect(enleve.kind === 'fabriquer' && enleve.changement).toBe('Retiré : trou de 8 mm à l’arrière');
    if (enleve.kind === 'fabriquer') expect(enleve.valeurs).not.toHaveProperty('decoupes');
  });

  it('refus : la version reste à l’écran', () => {
    const d = deciderAtelier('enlève le trou', piece('boite', BOITE));
    expect(d).toEqual({ kind: 'dire', texte: 'Cette pièce n’a pas de découpe à enlever. La version 1 reste à l\'écran.' });
    const crochet = deciderAtelier('ajoute un trou de 5 à l’avant', piece('crochet', {}));
    expect(crochet.kind).toBe('dire');
  });

  it('une phrase sans découpe ne change rien d’avant', () => {
    const d = deciderAtelier('plus haut', piece('boite', BOITE));
    expect(d.kind === 'fabriquer' && d.changement).toBe('Hauteur : 30 mm → 38 mm');
  });
});

describe('découpes placées en millimètres', () => {
  const GRANDE = { longueur: 120, largeur: 80, hauteur: 40, paroi: 2.4, fond: 2 };

  it('« une ouverture de 17 par 15 dans le fond, à 12 mm du bord gauche et 8 mm du bas »', () => {
    const [d] = ajouter('boite', 'une ouverture de 17 par 15 dans le fond, à 12 mm du bord gauche et 8 mm du bas');
    expect(d).toMatchObject({ forme: 'rect', face: 'dessous', largeur: 17, hauteur: 15, posU: { bord: 'gauche', mm: 12 }, posV: { bord: 'bas', mm: 8 } });
    expect(direDecoupe(d!)).toBe('ouverture de 17 × 15 mm dans le fond, à 12 mm du bord gauche et à 8 mm du bas');
    // Vu de dessous, la gauche est en x = 0 et le bas vers l'avant (y = 0) : bord de l'ouverture à 12 et 8 mm.
    const r = placerDecoupes('boite', 'boîte', { ...GRANDE }, [d!]);
    expect(r.erreurs).toEqual([]);
    expect(r.scad[0]).toBe('translate([12, 8, -1]) cube([17, 15, 4]);');
  });

  it('« un trou de 8 centré à 145 mm du bas » : le centre à 145 mm', () => {
    const [d] = ajouter('boite', 'un trou de 8 centré à 145 mm du bas');
    expect(d).toMatchObject({ forme: 'rond', face: 'avant', largeur: 8, posV: { bord: 'bas', mm: 145, centre: true } });
    expect(direDecoupe(d!)).toBe('trou de 8 mm à l’avant, centré à 145 mm du bas');
    const r = placerDecoupes('boite', 'boîte', { longueur: 100, largeur: 60, hauteur: 160, paroi: 2, fond: 2 }, [d!]);
    expect(r.scad[0]).toBe('translate([50, -1, 145]) rotate([-90, 0, 0]) cylinder(h = 4, d = 8);');
  });

  it('côté droit : « à 10 mm de l’avant » se compte depuis le bord avant', () => {
    const [d] = ajouter('boite', 'une ouverture de 9 par 4 sur le côté droit, à 10 mm de l’avant et 5 mm du bas');
    const r = placerDecoupes('boite', 'boîte', { ...GRANDE }, [d!]);
    expect(r.scad[0]).toBe('translate([116.6, 10, 5]) cube([4.4, 9, 4]);');
  });

  it('refus : bord qui n’existe pas sur la face, découpe qui déborde', () => {
    const r = appliquerDecoupes(gabarit('boite')!, [], lire('un trou de 8 à l’avant, à 20 mm de l’avant').ops);
    expect(r.erreurs[0]).toMatch(/n’a pas de sens sur cette face/);
    const [d] = ajouter('boite', 'une ouverture de 17 par 15 dans le fond, à 1 mm du bord gauche');
    expect(placerDecoupes('boite', 'boîte', { ...GRANDE }, [d!]).erreurs[0]).toMatch(/déborde de la place utile/);
  });

  it('« le trou à 20 mm du bord gauche » déplace la découpe', () => {
    const etat = piece('boite', { ...GRANDE, decoupes: JSON.stringify(ajouter('boite', 'un trou de 8 à l’avant')) });
    const d = deciderAtelier('mets le trou à 20 mm du bord gauche', etat);
    if (d.kind !== 'fabriquer') throw new Error(d.kind);
    expect(decoupesDe(d.valeurs)[0]).toMatchObject({ posU: { bord: 'gauche', mm: 20 } });
  });
});

describe('nouvelles formes de découpe', () => {
  it('rectangle à coins arrondis', () => {
    const [d] = ajouter('boite', 'une ouverture de 30 par 20 à coins arrondis à l’avant');
    expect(d).toMatchObject({ forme: 'rect', rayon: 3 });
    expect(direDecoupe(d!)).toBe('ouverture de 30 × 20 mm à coins arrondis (rayon 3 mm) à l’avant');
    const r = placerDecoupes('boite', 'boîte', BOITE, [d!]);
    expect(r.erreurs).toEqual([]);
    expect(r.scad[0]).toMatch(/^multmatrix\(.*offset\(r = 3\) square\(\[24, 14\], center = true\);$/);
    expect(equilibre(r.scad[0]!)).toBe(true);
    const [g] = ajouter('boite', 'une ouverture de 30 par 20 avec des coins arrondis de 12 mm à l’avant');
    expect(placerDecoupes('boite', 'boîte', BOITE, [g!]).erreurs[0]).toMatch(/rayon trop grand/);
  });

  it('fenêtre évasée (caméra) : plus grande dehors, tronc de pyramide', () => {
    const [d] = ajouter('boite', 'une fenêtre évasée de 14 par 13, 18,5 par 15 à l’extérieur, à l’avant');
    expect(d).toMatchObject({ forme: 'rect', largeur: 14, hauteur: 13, evase: [18.5, 15] });
    expect(direDecoupe(d!)).toBe('fenêtre évasée de 14 × 13 mm (18,5 × 15 mm dehors) à l’avant');
    const r = placerDecoupes('boite', 'boîte', BOITE, [d!]);
    expect(r.erreurs).toEqual([]);
    expect(r.scad[0]).toMatch(/hull\(\)/);
    expect(equilibre(r.scad[0]!)).toBe(true);
    // Sans taille dehors : à 45°.
    const [e] = ajouter('boite', 'une fenêtre évasée de 14 par 13 dans le fond');
    expect(e!.evase).toEqual([0, 0]);
    expect(direDecoupe(e!)).toBe('fenêtre évasée de 14 × 13 mm (à 45°) dans le fond');
  });
});

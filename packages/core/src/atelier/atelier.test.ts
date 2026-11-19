import { describe, expect, it } from 'vitest';
import { ENDER3_S1_PLUS_VOLUME, estChoix, fabriquer, fichePiece, GABARITS, gabarit, type Gabarit, type Valeurs } from './gabarits.js';
import {
  choisirGabarit,
  comprendre,
  consigneModele,
  fusionner,
  lireReponse,
  lireReponseModele,
  prochaineQuestion,
} from './lecture.js';

function g(id: string): Gabarit {
  const found = gabarit(id);
  if (!found) throw new Error(id);
  return found;
}

function equilibre(text: string): boolean {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const stack: string[] = [];
  for (const c of text.replace(/\/\/.*$/gm, '')) {
    if ('([{'.includes(c)) stack.push(c);
    else if (c in pairs) {
      if (stack.pop() !== pairs[c]) return false;
    }
  }
  return stack.length === 0;
}

describe('gabarits', () => {
  it('une dizaine de pièces, chacune avec des mesures cohérentes', () => {
    expect(GABARITS.length).toBe(10);
    const ids = new Set(GABARITS.map((x) => x.id));
    expect(ids.size).toBe(10);
    for (const gab of GABARITS) {
      for (const m of gab.mesures) {
        if (estChoix(m)) expect(m.options.some((o) => o.valeur === m.defaut)).toBe(true);
        else expect(m.min <= m.defaut && m.defaut <= m.max).toBe(true);
      }
      for (const id of gab.suite) expect(gab.mesures.some((m) => m.id === id)).toBe(true);
    }
  });

  it('chaque pièce par défaut se fabrique, tient dans l’imprimante et donne un OpenSCAD propre', () => {
    for (const gab of GABARITS) {
      const piece = fabriquer(gab, {});
      if (!piece.ok) throw new Error(`${gab.id} : ${piece.erreurs.join(' ')}`);
      const [x, y, z] = piece.taille;
      expect(x <= ENDER3_S1_PLUS_VOLUME.x && y <= ENDER3_S1_PLUS_VOLUME.y && z <= ENDER3_S1_PLUS_VOLUME.z).toBe(true);
      expect(piece.scad.includes('NaN') || piece.scad.includes('undefined')).toBe(false);
      expect(equilibre(piece.scad)).toBe(true);
      expect(piece.scad.trimEnd().endsWith(';') || piece.scad.trimEnd().endsWith('}')).toBe(true);
    }
  });

  it('les mesures se retrouvent dans la pièce', () => {
    const piece = fabriquer(g('boite'), { longueur: 120, largeur: 70, hauteur: 45, paroi: 2.5 });
    if (!piece.ok) throw new Error(piece.erreurs.join(' '));
    expect(piece.scad).toContain('cube([120, 70, 45]);');
    expect(piece.scad).toContain('translate([2.5, 2.5, 2]) cube([115, 65, 45]);');
    expect(fichePiece(piece)).toBe('Boîte de 120 × 70 × 45 mm.');
  });

  it('une mesure hors bornes est une erreur dite, jamais ramenée en silence', () => {
    const piece = fabriquer(g('boite'), { longueur: 400 });
    expect(piece.ok).toBe(false);
    if (!piece.ok) expect(piece.erreurs[0]).toBe('Longueur : 400 mm, hors des limites (de 10 mm à 290 mm).');
  });

  it('ce qui ne s’imprimerait pas est refusé avec une phrase claire', () => {
    const trou = fabriquer(g('entretoise'), { diametre: 6, trou: 5.5 });
    expect(trou.ok).toBe(false);
    const couvercle = fabriquer(g('boite_couvercle'), { longueur: 200 });
    expect(couvercle.ok).toBe(false);
    if (!couvercle.ok) expect(couvercle.erreurs.join(' ')).toContain('ne tient pas dans l’imprimante');
    const cases = fabriquer(g('bac'), { longueur: 40, colonnes: 12 });
    expect(cases.ok).toBe(false);
    const support = fabriquer(g('support_telephone'), { dos: 160, base: 40, angle: 45 });
    expect(support.ok).toBe(false);
  });

  it('nombre de cases entier', () => {
    const piece = fabriquer(g('bac'), { colonnes: 2.5 });
    expect(piece.ok).toBe(false);
  });

  it('un bac à une seule case n’écrit pas de boucle vide', () => {
    const piece = fabriquer(g('bac'), { colonnes: 1, rangees: 1 });
    if (!piece.ok) throw new Error(piece.erreurs.join(' '));
    expect(piece.scad).not.toContain('for (');
    const deux = fabriquer(g('bac'), { colonnes: 3, rangees: 2 });
    if (!deux.ok) throw new Error(deux.erreurs.join(' '));
    expect(deux.scad).toContain('for (i = [1 : 2])');
    expect(deux.scad).toContain('for (j = [1 : 1])');
  });

  it('socle carré ou rond, avec ou sans logement', () => {
    const rond = fabriquer(g('socle'), { taille: 80, logement: 40, profondeur: 5 });
    const carre = fabriquer(g('socle'), { forme: 'carre', taille: 80 });
    if (!rond.ok || !carre.ok) throw new Error('socle');
    expect(rond.scad).toContain('cylinder(h = 15, d = 80)');
    expect(rond.scad).toContain('difference()');
    expect(carre.scad).toContain('cube([80, 80, 15])');
  });
});

describe('comprendre la demande, sans modèle', () => {
  const cas: { phrase: string; gabarit: string; valeurs: Valeurs }[] = [
    { phrase: 'Fais-moi une boîte de 80 par 50, hauteur 30', gabarit: 'boite', valeurs: { longueur: 80, largeur: 50, hauteur: 30 } },
    { phrase: 'Une boîte avec couvercle de 10 x 6 x 4 cm', gabarit: 'boite_couvercle', valeurs: { longueur: 100, largeur: 60, hauteur: 40 } },
    { phrase: 'une boîte de 80 de long, 50 de large et 30 de haut avec un couvercle', gabarit: 'boite_couvercle', valeurs: { longueur: 80, largeur: 50, hauteur: 30 } },
    { phrase: 'une boîte 80 de long 50 de large 30 de haut', gabarit: 'boite', valeurs: { longueur: 80, largeur: 50, hauteur: 30 } },
    { phrase: 'Jarvis, imprime-moi une entretoise de 12 mm de diamètre, trou de 4, épaisseur 5', gabarit: 'entretoise', valeurs: { diametre: 12, trou: 4, hauteur: 5 } },
    { phrase: 'une rondelle avec un trou de 4 mm de diamètre', gabarit: 'entretoise', valeurs: { trou: 4 } },
    { phrase: 'Fais-moi un support pour mon téléphone, incliné à 60°', gabarit: 'support_telephone', valeurs: { angle: 60 } },
    { phrase: 'un bac de 200 par 100 avec 4 compartiments', gabarit: 'bac', valeurs: { longueur: 200, largeur: 100, colonnes: 4 } },
    { phrase: 'un socle rond de 8 cm', gabarit: 'socle', valeurs: { forme: 'rond', taille: 80 } },
    { phrase: 'un socle carré de 60, hauteur 10', gabarit: 'socle', valeurs: { forme: 'carre', taille: 60, hauteur: 10 } },
    { phrase: 'une cale de 60 de long et 10 de haut', gabarit: 'cale', valeurs: { longueur: 60, haut: 10 } },
    { phrase: 'une équerre de 50 par 40, trous de 5', gabarit: 'equerre', valeurs: { branche1: 50, branche2: 40, trou: 5 } },
    { phrase: 'un crochet mural de 25 de large', gabarit: 'crochet', valeurs: { largeur: 25 } },
    { phrase: 'un porte-étiquette pour des étiquettes de 60 par 25', gabarit: 'porte_etiquette', valeurs: { largeur: 60, hauteur: 25 } },
    { phrase: 'fais-moi 2 boîtes de 80 par 50', gabarit: 'boite', valeurs: { longueur: 80, largeur: 50 } },
    { phrase: 'une boîte de 2,5 cm par 4 cm', gabarit: 'boite', valeurs: { longueur: 25, largeur: 40 } },
  ];
  for (const c of cas) {
    it(c.phrase, () => {
      const d = comprendre(c.phrase);
      expect(d.gabarit?.id).toBe(c.gabarit);
      expect(d.valeurs).toEqual(c.valeurs);
    });
  }

  it('une demande hors de la bibliothèque n’est pas devinée', () => {
    expect(choisirGabarit('imprime-moi une petite voiture')).toBeNull();
    expect(choisirGabarit('quelle heure est-il ?')).toBeNull();
    expect(comprendre('fais-moi un dragon de 10 cm').gabarit).toBeNull();
  });
});

describe('questions une à la fois', () => {
  it('ce qui manque est demandé avec une valeur proposée, dans l’ordre', () => {
    const d = comprendre('Fais-moi une boîte de 80 par 50');
    expect(d.manquantes).toEqual(['hauteur']);
    const q = prochaineQuestion(d.gabarit!, d.valeurs);
    expect(q).toEqual({ mesure: 'hauteur', texte: 'Hauteur : je propose 30 mm. Ça te va, ou tu veux autre chose ?', proposition: 30 });
  });

  it('rien à demander quand tout est dit', () => {
    const d = comprendre('une boîte de 80 par 50 par 30');
    expect(prochaineQuestion(d.gabarit!, d.valeurs)).toBeNull();
  });

  it('« oui » garde la proposition ; un nombre la remplace ; « 4 cm » devient 40 mm', () => {
    expect(lireReponse(g('boite'), 'hauteur', 'oui vas-y')).toBe(30);
    expect(lireReponse(g('boite'), 'hauteur', 'plutôt 45')).toBe(45);
    expect(lireReponse(g('boite'), 'hauteur', '4 cm')).toBe(40);
    expect(lireReponse(g('socle'), 'forme', 'carré')).toBe('carre');
    expect(lireReponse(g('boite'), 'hauteur', 'je ne sais pas')).toBeNull();
  });

  it('question à choix', () => {
    const q = prochaineQuestion(g('socle'), { taille: 80 });
    expect(q?.texte).toBe('Forme : je propose rond. Ça te va, ou tu veux autre chose ?');
  });
});

describe('réponse du modèle, quand les règles ne reconnaissent pas la pièce', () => {
  it('la consigne liste toutes les pièces et le format', () => {
    const consigne = consigneModele();
    for (const gab of GABARITS) expect(consigne).toContain(`- ${gab.id} :`);
    expect(consigne).toContain('Réponds uniquement en JSON');
  });

  it('gabarit et mesures valides acceptés ; le reste écarté et noté', () => {
    const r = lireReponseModele('```json\n{"gabarit":"crochet","mesures":{"largeur":30,"hauteur":999,"couleur":"rouge"}}\n```');
    expect(r.gabarit?.id).toBe('crochet');
    expect(r.valeurs).toEqual({ largeur: 30 });
    expect(r.ecartees).toEqual(['hauteur : hors des limites', 'mesure inconnue : couleur']);
  });

  it('pièce inconnue ou réponse illisible : rien', () => {
    expect(lireReponseModele('{"gabarit":"fusee","mesures":{}}').gabarit).toBeNull();
    expect(lireReponseModele('je pense que').ecartees).toEqual(['réponse illisible']);
    expect(lireReponseModele('{"gabarit":null}').gabarit).toBeNull();
  });

  it('les règles gardent le dernier mot ; le modèle ne complète que la même pièce', () => {
    const regles = comprendre('une boîte de 80 par 50');
    const fusion = fusionner(regles, { gabarit: g('boite'), valeurs: { longueur: 99, hauteur: 30 } });
    expect(fusion.valeurs).toEqual({ longueur: 80, largeur: 50, hauteur: 30 });
    expect(fusion.manquantes).toEqual([]);
    const autre = fusionner(regles, { gabarit: g('cale'), valeurs: { haut: 10 } });
    expect(autre.valeurs).toEqual({ longueur: 80, largeur: 50 });
  });
});

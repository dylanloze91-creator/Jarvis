import { describe, expect, it } from 'vitest';
import { fabriquer, fichePiece, gabarit } from './gabarits.js';
import { agrandirPourTenir, deciderAtelier, mesuresAffichees, pourAtelier, type AtelierEtat } from './discussion.js';
import { createMessage } from '../types.js';

/**
 * Toute demande de pièce, de boîtier ou de changement de la pièce à l'écran va à l'atelier, même
 * avec « Raspberry Pi », « câble » ou « écran » dedans ; une phrase d'un autre domaine n'y va pas.
 *
 * Les deux premières phrases sont celles de l'utilisateur dans Jarvis Test (23 et 24 novembre) :
 * la version installée n'avait pas l'atelier, le cerveau les avait données à Images, puis à Fichiers.
 */
const PHRASES_UTILISATEUR = [
  'Fais-moi une boîte de 80 par 50 par 30',
  "Fais-moi une boîte de 120 par 80 par 40 avec des plots pour un Raspberry Pi 5, ports vers l'arrière",
];

function boite(): Extract<AtelierEtat, { etape: 'piece' }> {
  const g = gabarit('boite')!;
  const p = fabriquer(g, { longueur: 120, largeur: 80, hauteur: 40 });
  if (!p.ok) throw new Error(p.erreurs.join(' '));
  return {
    etape: 'piece',
    gabarit: 'boite',
    nom: g.nom,
    dossier: 'boite-1',
    versionChoisie: 1,
    plateau: { x: 250, y: 250 },
    versions: [{ numero: 1, valeurs: p.valeurs, fiche: fichePiece(p), mesures: mesuresAffichees(g, p.valeurs), taille: p.taille, stl: 'v1.stl' }],
  };
}

/** La discussion telle qu'enregistrée : la dernière réponse de Jarvis porte la pièce. */
function avecPiece() {
  return [createMessage('user', 'Fais-moi une boîte de 120 par 80 par 40'), { ...createMessage('assistant', 'Boîte de 120 × 80 × 40 mm.'), atelier: boite() }];
}

describe("routage vers l'atelier : phrases de l'utilisateur", () => {
  it.each(PHRASES_UTILISATEUR)('« %s » est rendue par l’atelier', (phrase) => {
    const d = deciderAtelier(phrase, null, { mesures: {} });
    expect(d.kind).toBe('fabriquer');
    expect(pourAtelier(phrase, [])).toBe(true);
  });

  it('la boîte du Raspberry Pi 5 garde ses cotes et les plots, ports vers l’arrière', () => {
    const d = deciderAtelier(PHRASES_UTILISATEUR[1]!, null, { mesures: {} });
    if (d.kind !== 'fabriquer') throw new Error(d.kind);
    expect(d.valeurs).toMatchObject({ longueur: 120, largeur: 80, hauteur: 40 });
    expect(JSON.parse(String(d.valeurs.ajouts))).toEqual([{ genre: 'composant', composant: 'raspberry_pi_5', ports: 'arriere' }]);
  });
});

describe("routage vers l'atelier : nouvelle pièce", () => {
  it.each([
    'Fais-moi un boîtier pour un Raspberry Pi 5',
    "Fais-moi un boîtier pour mon Raspberry Pi avec un passage de câble à l'arrière",
    'Dessine-moi un boîtier pour un écran de 7 pouces',
    "Je voudrais un boîtier pour l'écran tactile et le Raspberry Pi",
    'Crée une boîte avec un trou pour le câble USB-C',
    'Fais un boîtier électronique pour un ESP32',
    'Tu peux me faire une boîte pour ranger les câbles ?',
    'Fabrique-moi un boîtier pour la caméra du Raspberry Pi',
    'Il me faut un boîtier pour un Raspberry Pi 5',
    'Une boîte de 100 par 60 par 30 pour un Raspberry Pi',
    'Fais-moi un boîtier de Raspberry Pi',
    'Jarvis, fais-moi un boîtier pour le Raspberry Pi 5 avec une sortie pour le câble',
    'Fais-moi un support de téléphone',
  ])('« %s » : l’atelier la prend', (phrase) => {
    const d = deciderAtelier(phrase, null, { mesures: {} });
    expect(['fabriquer', 'dire']).toContain(d.kind);
    if (d.kind === 'dire') expect(d.texte).not.toMatch(/ne sais pas encore/);
  });

  it.each(['Imprime-moi un support pour mon écran', 'Fais-moi un passe-câble', 'Fais-moi un cache pour la caméra'])(
    '« %s » : objet hors bibliothèque, l’atelier dit ce qu’il sait faire (pas le cerveau)',
    (phrase) => {
      const d = deciderAtelier(phrase, null, { mesures: {} });
      expect(d).toMatchObject({ kind: 'dire', texte: expect.stringMatching(/^Je ne sais pas encore dessiner ça\. Je sais faire : /) });
    },
  );

  it('« une boîte de 6 œufs » sans verbe ni cote n’est pas une pièce', () => {
    expect(deciderAtelier('Une boîte de 6 œufs', null, {}).kind).toBe('rien');
  });
});

describe("routage vers l'atelier : changement de la pièce à l'écran", () => {
  const piece = boite();
  const decoupes = (d: ReturnType<typeof deciderAtelier>) => (d.kind === 'fabriquer' ? JSON.parse(String(d.valeurs.decoupes ?? '[]')) : []);

  it.each([
    ["Ajoute un passage de câble à l'arrière", 'arriere'],
    ["Ajoute un trou pour le câble d'alimentation sur le côté", 'droite'],
    ['Fais passer le câble par le côté gauche', 'gauche'],
    ['Rajoute un trou pour le câble HDMI', 'arriere'],
    ['Mets un trou de 8 pour le câble à gauche', 'gauche'],
    ["Fais une fenêtre pour l'écran sur le dessus", 'dessus'],
    ["Ajoute une découpe pour l'écran sur le devant", 'avant'],
  ])('« %s » : découpe sur la face %s', (phrase, face) => {
    const d = deciderAtelier(phrase, piece, { mesures: {} });
    expect(d.kind).toBe('fabriquer');
    expect(decoupes(d)[0]).toMatchObject({ face });
  });

  it('« Mets des plots pour un Raspberry Pi 5 dans le fond, ports vers l’arrière » : la carte est posée', () => {
    const d = deciderAtelier("Mets des plots pour un Raspberry Pi 5 dans le fond, ports vers l'arrière", piece, { mesures: {} });
    if (d.kind !== 'fabriquer') throw new Error(d.kind);
    expect(JSON.parse(String(d.valeurs.ajouts))).toEqual([{ genre: 'composant', composant: 'raspberry_pi_5', ports: 'arriere' }]);
  });

  it.each([
    ['Plus haut', 50],
    ['Mets-la plus haute', 50],
    ['Hauteur 50', 50],
  ])('« %s » : hauteur %i', (phrase, hauteur) => {
    expect(deciderAtelier(phrase, piece, {})).toMatchObject({ kind: 'fabriquer', valeurs: { hauteur } });
  });

  it('« Ajoute un couvercle » : la boîte devient une boîte à couvercle, aux mêmes cotes', () => {
    expect(deciderAtelier('Ajoute un couvercle', piece, {})).toMatchObject({
      kind: 'fabriquer',
      gabarit: { id: 'boite_couvercle' },
      valeurs: { longueur: 120, largeur: 80, hauteur: 40 },
      changement: 'Couvercle ajouté',
    });
  });

  it.each(['Ajoute des aérations sur les côtés', 'Agrandis-la pour que le Raspberry Pi rentre'])(
    '« %s » : changement que l’atelier ne sait pas faire, il le dit et garde la pièce',
    (phrase) => {
      const d = deciderAtelier(phrase, piece, {});
      expect(d).toMatchObject({ kind: 'dire', texte: expect.stringMatching(/^Je n'ai pas su faire ce changement sur la pièce\..*La version 1 reste à l'écran\.$/), etat: piece });
      expect(pourAtelier(phrase, avecPiece())).toBe(true);
      // Sans pièce à l'écran, ce n'est pas pour l'atelier.
      expect(pourAtelier(phrase, [])).toBe(false);
    },
  );
});

describe('les trois phrases du téléphone (24 novembre au soir)', () => {
  const V = { x: 300, y: 300, z: 300 };
  function ecran(gid: string, valeurs: Record<string, number | string>, base?: Extract<AtelierEtat, { etape: 'piece' }>): Extract<AtelierEtat, { etape: 'piece' }> {
    const g = gabarit(gid)!;
    const p = fabriquer(g, valeurs, V);
    if (!p.ok) throw new Error(p.erreurs.join(' '));
    const numero = (base?.versions.length ?? 0) + 1;
    const version = { numero, valeurs: p.valeurs, fiche: fichePiece(p), mesures: mesuresAffichees(g, p.valeurs), taille: p.taille, stl: `v${numero}.stl` };
    return { etape: 'piece', gabarit: gid, nom: g.nom, dossier: 'x', versionChoisie: numero, plateau: { x: 300, y: 300 }, versions: [...(base?.versions ?? []), version] };
  }

  it('Pi 5 trop grand : cotes proposées, « oui », couvercle qui s’emboîte, trou de 8 à droite', () => {
    const d1 = deciderAtelier(PHRASES_UTILISATEUR[1]!, null, { mesures: {} });
    if (d1.kind !== 'fabriquer') throw new Error(d1.kind);
    const p1 = fabriquer(d1.gabarit, d1.valeurs, V);
    expect(p1.ok).toBe(false);
    const plus = agrandirPourTenir(d1.gabarit, d1.valeurs, p1.ok ? [] : p1.erreurs);
    expect(plus).toMatchObject({ texte: '120 × 94 × 40 mm', valeurs: { longueur: 120, largeur: 94, hauteur: 40 } });
    expect(fabriquer(d1.gabarit, plus!.valeurs, V).ok).toBe(true);

    const proposition: AtelierEtat = { etape: 'proposition', gabarit: 'boite', valeurs: plus!.valeurs, base: null };
    expect(deciderAtelier('non', proposition, {})).toMatchObject({ kind: 'dire', texte: "D'accord, je laisse tomber cette pièce." });
    const oui = deciderAtelier('oui', proposition, {});
    expect(oui).toMatchObject({ kind: 'fabriquer', valeurs: { largeur: 94 } });
    if (oui.kind !== 'fabriquer') throw new Error(oui.kind);

    const v1 = ecran('boite', oui.valeurs);
    const couvercle = deciderAtelier("ajoute un couvercle qui s'emboîte", v1, {});
    if (couvercle.kind !== 'fabriquer') throw new Error(couvercle.kind);
    expect(couvercle.gabarit.id).toBe('boite_couvercle');
    expect(couvercle.changement).toBe('Couvercle ajouté, Ajout : un couvercle qui s’emboîte (lèvre de 1,2 mm, 0,25 mm de jeu par côté)');
    expect(JSON.parse(String(couvercle.valeurs.ajouts)).map((a: { genre: string }) => a.genre)).toEqual(['composant', 'emboitement']);
    const p2 = fabriquer(couvercle.gabarit, couvercle.valeurs, V);
    expect(p2.ok).toBe(true);

    // La pièce prend le nouveau modèle ; la version 1 garde le sien.
    const v2 = ecran('boite_couvercle', couvercle.valeurs, { ...v1, versions: v1.versions.map((v) => ({ ...v, gabarit: 'boite' })) });
    const trou = deciderAtelier('fais un trou de 8 à droite pour un câble', v2, {});
    if (trou.kind !== 'fabriquer') throw new Error(trou.kind);
    expect(trou.gabarit.id).toBe('boite_couvercle');
    expect(trou.changement).toBe('Ajout : trou de 8 mm sur le côté droit');
    expect(fabriquer(trou.gabarit, trou.valeurs, V).ok).toBe(true);
    // « reviens à la version 1 », puis « plus haute » : lu avec le modèle de la version 1 (boîte).
    const retour = { ...v2, versionChoisie: 1 };
    const plusHaute = deciderAtelier('plus haute', retour, {});
    expect(plusHaute).toMatchObject({ kind: 'fabriquer', gabarit: { id: 'boite' } });
  });

  it('une proposition suivie d’autre chose : la phrase est lue avec la pièce d’avant', () => {
    const v1 = ecran('boite', { longueur: 120, largeur: 94, hauteur: 40 });
    const proposition: AtelierEtat = { etape: 'proposition', gabarit: 'boite', valeurs: { longueur: 140, largeur: 94, hauteur: 40 }, base: v1 };
    expect(deciderAtelier('non', proposition, {})).toMatchObject({ kind: 'dire', etat: v1 });
    expect(deciderAtelier('plus haute', proposition, {})).toMatchObject({ kind: 'fabriquer', base: v1, valeurs: { hauteur: 50 } });
    expect(deciderAtelier('Quelle heure est-il ?', proposition, {}).kind).toBe('rien');
  });

  it('un autre refus (mesure hors bornes) : rien à proposer', () => {
    expect(agrandirPourTenir(gabarit('boite')!, { longueur: 400 }, ['Longueur : 400 mm, hors des limites (de 10 mm à 290 mm).'])).toBeNull();
    expect(agrandirPourTenir(gabarit('socle')!, {}, ['Le Raspberry Pi 5 ne tient pas dans le fond : il faut 61 × 93,5 mm au moins (boîte de 120 × 80 mm).'])).toBeNull();
  });
});

describe("routage vers l'atelier : ce qui n'y va pas", () => {
  const AUTRES = [
    "Explique-moi ce qu'est un Raspberry Pi",
    'Mon câble HDMI ne marche plus',
    'Quelle fenêtre est active ?',
    "Affiche l'heure sur l'écran de l'enceinte",
    "Éteins l'écran",
    'Dessine-moi un chat',
    'Mets le volume à 90',
    'Ajoute du lait à ma liste',
    'Ferme la fenêtre',
    'Ouvre la fenêtre de Spotify',
    'Mets la musique',
    'Fais une pause',
    'Mets un minuteur de 10 minutes',
    'Ajoute un rendez-vous demain à 14 h',
    "Mets l'écran en veille",
    'Change le volume à 30',
    "Fais une capture de l'écran",
    'Branche le câble HDMI sur la télé',
    'Tourne le robot à gauche',
    'Mets la caméra en route',
  ];
  it.each(AUTRES)('« %s » : ni sans pièce, ni avec une pièce à l’écran', (phrase) => {
    expect(deciderAtelier(phrase, null, {}).kind).toBe('rien');
    expect(deciderAtelier(phrase, boite(), {}).kind).toBe('rien');
    expect(pourAtelier(phrase, avecPiece())).toBe(false);
  });
});

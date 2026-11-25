import { describe, expect, it } from 'vitest';
import { fabriquer, fichePiece, gabarit } from './gabarits.js';
import { deciderAtelier, mesuresAffichees, normaliserOrdre, type AtelierEtat } from './discussion.js';

/**
 * L'atelier compris quand on parle normalement (essai de l'utilisateur sur l'iPhone, 24 novembre au
 * soir : « Pas de problème » et une longue phrase sur « l'impression 3D » étaient partis au cerveau).
 * Chaque tournure ici a été écrite comme on la dirait, pas comme une commande.
 */
const V = { x: 300, y: 300, z: 300 };
function ecran(gid: string, valeurs: Record<string, number | string>, versions = 1): Extract<AtelierEtat, { etape: 'piece' }> {
  const g = gabarit(gid)!;
  const p = fabriquer(g, valeurs, V);
  if (!p.ok) throw new Error(p.erreurs.join(' '));
  const liste = Array.from({ length: versions }, (_, i) => ({ numero: i + 1, valeurs: p.valeurs, fiche: fichePiece(p), mesures: mesuresAffichees(g, p.valeurs), taille: p.taille, stl: `v${i + 1}.stl` }));
  return { etape: 'piece', gabarit: gid, nom: g.nom, dossier: 'x', versionChoisie: versions, plateau: { x: 300, y: 300 }, versions: liste };
}
const PI = JSON.stringify([{ genre: 'composant', composant: 'raspberry_pi_5', ports: 'arriere' }]);
const piece = ecran('boite', { longueur: 120, largeur: 94, hauteur: 40, ajouts: PI });
const proposition: AtelierEtat = { etape: 'proposition', gabarit: 'boite', valeurs: { longueur: 120, largeur: 94, hauteur: 40, ajouts: PI }, base: null };

describe('accord à une proposition, dit comme on parle', () => {
  it.each([
    'Pas de problème', 'ouais vas-y', 'ok fais-le', 'nickel', 'Oui, agrandis-la', 'oui bien sûr', 'Vas-y fais comme ça', 'parfait merci', 'Go', 'ça me va',
    // La phrase de l'utilisateur, mot pour mot.
    "Bien évidemment nous faisons ça pour l'impression 3D donc c'est l'équipe imprimante qui doit prendre le relais et fait en sorte que ça rentre le boîtier avec le reste",
    'fais en sorte que ça rentre', 'agrandis la boîte pour que le Pi rentre',
  ])('« %s » : la pièce proposée est faite', (phrase) => {
    expect(deciderAtelier(phrase, proposition, {})).toMatchObject({ kind: 'fabriquer', valeurs: { longueur: 120, largeur: 94, hauteur: 40 } });
  });

  it('« oui mais 100 de large » : la cote dite compte', () => {
    expect(deciderAtelier('Oui mais 100 de large', proposition, {})).toMatchObject({ kind: 'fabriquer', valeurs: { largeur: 100 } });
  });

  it.each(['non', 'non, plutôt prises vers la gauche', 'pas comme ça'])('« %s » : rien n’est fait, Jarvis demande la pièce autrement', (phrase) => {
    const d = deciderAtelier(phrase, proposition, {});
    expect(d.kind).toBe('dire');
    if (d.kind === 'dire') expect(d.texte).toContain('Redis-moi la pièce comme tu la veux');
  });

  it('une phrase qui parle encore de la pièce sans être comprise : la proposition est redite, pas le cerveau', () => {
    const d = deciderAtelier("c'est pour mettre dans le boîtier de l'imprimante 3D tu vois", proposition, {});
    expect(d).toMatchObject({ kind: 'dire', etat: proposition });
    if (d.kind === 'dire') expect(d.texte).toMatch(/^Je n'ai pas compris\. Pour la boîte de 120 × 94 × 40 mm, dis « oui »/);
    expect(deciderAtelier('Quelle heure est-il ?', proposition, {}).kind).toBe('rien');
  });
});

describe('boîtier pour une carte, sans les cotes', () => {
  it.each([
    'Je voudrais un boîtier pour mon Raspberry Pi 5',
    'Il me faut une boîte pour un Raspberry Pi',
    "J'ai besoin d'un boîtier pour un Raspberry Pi 5 avec les prises à l'arrière",
    'Fais un boîtier Raspberry Pi 5',
    'On va faire un boîtier pour le Raspberry',
    'Crée-moi une boîte pour un Pi 5 avec les ports derrière',
  ])('« %s » : la plus petite boîte qui tient la carte est proposée', (phrase) => {
    const d = deciderAtelier(phrase, null, {});
    expect(d).toMatchObject({ kind: 'dire', etat: { etape: 'proposition', gabarit: 'boite' } });
    if (d.kind === 'dire') {
      expect(d.texte).toBe('Boîte avec le Raspberry Pi 5 sur ses plots, prises vers l’arrière : je propose 61 × 94 × 28 mm, la plus petite qui la tient. Dis « oui », ou donne-moi d\'autres cotes.');
      const oui = deciderAtelier('ouais vas-y', d.etat!, {});
      if (oui.kind !== 'fabriquer') throw new Error(oui.kind);
      expect(fabriquer(oui.gabarit, oui.valeurs).ok).toBe(true);
    }
  });

  it('prises à gauche : la boîte tourne avec la carte', () => {
    const d = deciderAtelier('Crée-moi une boîte pour un Pi 5 avec les ports à gauche', null, {});
    if (d.kind !== 'dire') throw new Error(d.kind);
    expect(d.texte).toContain('prises vers la gauche : je propose 94 × 61 × 28 mm');
  });

  it('« Boîte 120x100x40 pour Raspberry Pi 5 » (sans verbe) : les cotes dites et la carte', () => {
    expect(deciderAtelier('Boîte 120x100x40 pour Raspberry Pi 5', null, {})).toMatchObject({
      kind: 'fabriquer',
      valeurs: { longueur: 120, largeur: 100, hauteur: 40, ajouts: JSON.stringify([{ genre: 'composant', composant: 'raspberry_pi_5' }]) },
    });
    expect(deciderAtelier('Tu peux me faire un boîtier de 120 par 100 par 40 ?', null, {}).kind).toBe('fabriquer');
  });
});

describe('changements de la pièce à l’écran, dits comme on parle', () => {
  const quoi = (d: ReturnType<typeof deciderAtelier>) => (d.kind === 'fabriquer' ? `${d.gabarit.id} | ${d.changement}` : d.kind === 'dire' ? `dire | ${d.texte}` : d.kind);

  it.each([
    ['Rajoute un couvercle', 'boite_couvercle | Couvercle ajouté'],
    ['mets-lui un couvercle', 'boite_couvercle | Couvercle ajouté'],
    ['Tu peux ajouter un couvercle ?', 'boite_couvercle | Couvercle ajouté'],
    ['Et un couvercle aussi', 'boite_couvercle | Couvercle ajouté'],
    ['Il faudrait un couvercle qui se clipse', 'boite_couvercle | Couvercle ajouté, Ajout : un couvercle qui s’emboîte (lèvre de 1,2 mm, 0,25 mm de jeu par côté)'],
    ["j'aimerais un couvercle qui s'emboîte", 'boite_couvercle | Couvercle ajouté, Ajout : un couvercle qui s’emboîte (lèvre de 1,2 mm, 0,25 mm de jeu par côté)'],
    ['perce un trou de 8 mm sur le côté droit', 'boite | Ajout : trou de 8 mm sur le côté droit'],
    ['Peux-tu faire un trou de 8 à droite ?', 'boite | Ajout : trou de 8 mm sur le côté droit'],
    ['je voudrais un trou pour faire passer un câble à droite', 'boite | Ajout : trou de 8 mm sur le côté droit (taille proposée)'],
    ['Il faut un trou pour le câble à droite', 'boite | Ajout : trou de 8 mm sur le côté droit (taille proposée)'],
    ['fais un passage pour le câble à droite de 8 mm', 'boite | Ajout : trou de 8 mm sur le côté droit'],
    ['elle est trop basse', 'boite | Hauteur : 40 mm → 50 mm'],
    ['Augmente la hauteur de 10 mm', 'boite | Hauteur : 40 mm → 50 mm'],
    ['10 mm de plus en largeur', 'boite | Largeur : 94 mm → 104 mm'],
    ['Baisse la hauteur de 5', 'boite | Hauteur : 40 mm → 35 mm'],
    ['plus haute de 1 cm', 'boite | Hauteur : 40 mm → 50 mm'],
    ['mets 50 de haut', 'boite | Hauteur : 40 mm → 50 mm'],
    ['Hauteur 50 mm stp', 'boite | Hauteur : 40 mm → 50 mm'],
    ['Mets des aérations', 'boite | Ajout : 2 trous de 8 mm à l’avant (taille proposée)'],
    ['il faudrait des trous pour la ventilation sur le dessus', 'boite | Ajout : 2 trous de 8 mm sur le dessus (taille proposée)'],
  ])('« %s »', (phrase, attendu) => {
    expect(quoi(deciderAtelier(phrase, piece, {}))).toBe(attendu);
  });

  it.each(['Rends-la plus grande', 'Agrandis-la pour que le Raspberry Pi rentre'])('« %s » : quelle mesure ? (la pièce reste)', (phrase) => {
    expect(deciderAtelier(phrase, piece, {})).toMatchObject({ kind: 'dire', texte: 'Plus longue, plus large ou plus haute ? Dis-moi aussi de combien, par exemple « 10 mm plus haute ».', etat: piece });
  });

  it.each(["Envoie-la à l'imprimante", "Tu peux l'imprimer ?", 'Imprime-la stp'])('« %s » : imprimer (le téléphone le refuse ce soir, ailleurs)', (phrase) => {
    expect(deciderAtelier(phrase, piece, {}).kind).toBe('imprimer');
  });

  it.each(["Remets la version d'avant", 'Annule le dernier changement', 'reviens en arrière'])('« %s » : la version précédente', (phrase) => {
    const deux = ecran('boite', { longueur: 120, largeur: 94, hauteur: 40 }, 2);
    expect(deciderAtelier(phrase, deux, {})).toMatchObject({ kind: 'choisir', numero: 1 });
    expect(deciderAtelier(phrase, piece, {})).toMatchObject({ kind: 'dire', texte: "La version 1 est la première : il n'y a rien avant." });
  });

  it('les phrases d’autres domaines restent hors de l’atelier, même tournées poliment', () => {
    for (const phrase of ['Tu peux mettre de la musique ?', 'Il faudrait un rendez-vous demain', 'Tu peux fermer la fenêtre ?', "Est-ce que tu peux baisser le volume de 10 ?"]) {
      expect(deciderAtelier(phrase, piece, {}).kind).toBe('rien');
    }
  });
});

describe('normaliserOrdre', () => {
  it.each([
    ['tu peux ajouter un couvercle ,', 'ajoute un couvercle'],
    ['il faudrait un trou a droite', 'ajoute un trou a droite'],
    ['tu peux l imprimer ,', 'imprime'],
    ['envoie la a l imprimante', 'imprime la'],
    ['elle est trop basse', 'plus haute'],
    ['et un couvercle aussi', 'un couvercle'],
  ])('« %s » → « %s »', (avant, apres) => {
    expect(normaliserOrdre(avant)).toBe(apres);
  });
});

import { describe, expect, it } from 'vitest';
import { fabriquer, fichePiece, gabarit } from './gabarits.js';
import {
  dernierAtelier,
  deciderAtelier,
  demandePiece,
  mesuresAffichees,
  nomDossierPiece,
  phraseConfirmationAtelier,
  phraseConfirmationFile,
  plateauVideLanceSuivante,
  type AtelierEtat,
} from './discussion.js';

function piece(id: string, valeurs: Record<string, number | string>, numero = 1): Extract<AtelierEtat, { etape: 'piece' }> {
  const g = gabarit(id)!;
  const p = fabriquer(g, valeurs);
  if (!p.ok) throw new Error(p.erreurs.join(' '));
  return {
    etape: 'piece',
    gabarit: id,
    nom: g.nom,
    dossier: 'x',
    versionChoisie: numero,
    plateau: { x: 250, y: 250 },
    versions: [
      {
        numero,
        valeurs: p.valeurs,
        fiche: fichePiece(p),
        mesures: mesuresAffichees(g, p.valeurs),
        taille: p.taille,
        stl: `v${numero}.stl`,
      },
    ],
  };
}

describe('atelier dans la discussion : démarrer', () => {
  it('reconnaît une demande de pièce, pas une image ni une autre phrase', () => {
    expect(demandePiece('Fais-moi une boîte de 80 par 50 par 30')?.gabarit?.id).toBe('boite');
    expect(demandePiece('Jarvis, imprime-moi un support de téléphone')?.gabarit?.id).toBe('support_telephone');
    expect(demandePiece('tu peux me dessiner une entretoise de 12 mm ?')?.gabarit?.id).toBe('entretoise');
    expect(demandePiece("j'ai besoin d'un crochet")?.gabarit?.id).toBe('crochet');
    expect(demandePiece('Dessine-moi un chat')).toBeNull();
    expect(demandePiece('Fais-moi une blague')).toBeNull();
    expect(demandePiece('Quelle heure est-il ?')).toBeNull();
    expect(demandePiece('imprime le fichier cube.gcode')).toBeNull();
    expect(demandePiece('Fais-moi un dragon en 3D')).toEqual({ gabarit: null, valeurs: {} });
  });

  it('pièce inconnue : dite, jamais devinée', () => {
    const d = deciderAtelier('Fais-moi une petite voiture à imprimer', null);
    expect(d.kind).toBe('dire');
    if (d.kind === 'dire') {
      expect(d.texte).toContain('Je ne sais pas encore dessiner ça');
      expect(d.etat).toEqual({ etape: 'choix' });
    }
  });

  it('toutes les mesures dites : on fabrique tout de suite', () => {
    const d = deciderAtelier('Fais-moi une boîte de 80 par 50 par 30', null);
    expect(d.kind).toBe('fabriquer');
    if (d.kind === 'fabriquer') expect(d.valeurs).toMatchObject({ longueur: 80, largeur: 50, hauteur: 30 });
  });

  it('il manque une mesure : une question à la fois, avec une proposition', () => {
    const d = deciderAtelier('Fais-moi un support de téléphone', null);
    expect(d.kind).toBe('dire');
    if (d.kind !== 'dire') return;
    expect(d.texte).toBe("Support de téléphone, d'accord. Inclinaison : je propose 60°. Ça te va, ou tu veux autre chose ?");
    expect(d.etat).toEqual({ etape: 'question', gabarit: 'support_telephone', valeurs: {}, mesure: 'angle' });
  });
});

describe('atelier dans la discussion : répondre aux questions', () => {
  const question: AtelierEtat = { etape: 'question', gabarit: 'support_telephone', valeurs: {}, mesure: 'angle' };

  it('« oui » garde la proposition, un nombre la remplace', () => {
    const oui = deciderAtelier('oui', question);
    expect(oui.kind).toBe('fabriquer');
    if (oui.kind === 'fabriquer') expect(oui.valeurs.angle).toBe(60);
    const autre = deciderAtelier('70°', question);
    if (autre.kind !== 'fabriquer') throw new Error(autre.kind);
    expect(autre.valeurs.angle).toBe(70);
  });

  it('hors des limites : dit, et la même question revient', () => {
    const d = deciderAtelier('20', question);
    expect(d.kind).toBe('dire');
    if (d.kind !== 'dire') return;
    expect(d.texte).toContain('hors des limites');
    expect(d.texte).toContain('Inclinaison : je propose 60°');
    expect(d.etat).toEqual(question);
  });

  it('une autre phrase n’est pas une réponse : le tour suit son chemin', () => {
    expect(deciderAtelier('Quelle heure est-il ?', question).kind).toBe('rien');
    expect(deciderAtelier('mets le volume de la musique à 40 dans le salon stp', question).kind).toBe('rien');
  });

  it('« laisse tomber » arrête la pièce', () => {
    const d = deciderAtelier('laisse tomber', question);
    expect(d).toEqual({ kind: 'dire', texte: "D'accord, je laisse tomber cette pièce." });
  });

  it('une question oubliée ne revient pas après une autre réponse', () => {
    const messages = [
      { role: 'assistant', atelier: question },
      { role: 'user' },
      { role: 'assistant' },
    ];
    expect(dernierAtelier(messages)).toBeNull();
    const avecPiece = [{ role: 'assistant', atelier: piece('boite', {}) }, { role: 'user' }, { role: 'assistant' }];
    expect(dernierAtelier(avecPiece)?.etape).toBe('piece');
  });
});

describe('atelier dans la discussion : nouvelles versions', () => {
  const boite = piece('boite', { longueur: 80, largeur: 50, hauteur: 30 });

  it('« plus haut » : nouvelle version, l’ancienne gardée', () => {
    const d = deciderAtelier('plus haute', boite);
    if (d.kind !== 'fabriquer') throw new Error(d.kind);
    expect(d.valeurs.hauteur).toBe(38);
    expect(d.valeurs.longueur).toBe(80);
    expect(d.base).toBe(boite);
    expect(d.changement).toBe('Hauteur : 30 mm → 38 mm');
  });

  it('une mesure dite : « hauteur 45 », « moins large »', () => {
    const d = deciderAtelier('hauteur 45', boite);
    if (d.kind !== 'fabriquer') throw new Error(d.kind);
    expect(d.valeurs.hauteur).toBe(45);
    const e = deciderAtelier('un peu moins large', boite);
    if (e.kind !== 'fabriquer') throw new Error(e.kind);
    expect(e.valeurs.largeur).toBe(40);
  });

  it('« trou plus gros » sur une entretoise', () => {
    const entretoise = piece('entretoise', {});
    const d = deciderAtelier('le trou plus gros', entretoise);
    if (d.kind !== 'fabriquer') throw new Error(d.kind);
    const avant = Number(entretoise.versions[0]!.valeurs.trou);
    expect(d.valeurs.trou).toBeGreaterThanOrEqual(avant + 1);
  });

  it('hors des limites : refusé, la version reste', () => {
    const d = deciderAtelier('hauteur 400', boite);
    expect(d.kind).toBe('dire');
    if (d.kind === 'dire') expect(d.texte).toContain('La version 1 reste à l');
  });

  it('une phrase sans rapport ne change rien', () => {
    expect(deciderAtelier('Merci beaucoup !', boite).kind).toBe('rien');
    expect(deciderAtelier('mets un minuteur de 10 minutes pour les pâtes stp maintenant', boite).kind).toBe('rien');
  });
});

describe('atelier dans la discussion : imprimer', () => {
  const boite = piece('boite', {}, 2);

  it('« imprime-la », « imprime la version 2 », « lance l’impression »', () => {
    for (const phrase of ['Imprime-la', 'imprime la version 2', 'Jarvis, lance l’impression', 'imprime la boîte']) {
      const d = deciderAtelier(phrase, boite);
      expect(d).toEqual({ kind: 'imprimer', etat: boite, numero: 2 });
    }
  });

  it('version absente : dit', () => {
    const d = deciderAtelier('imprime la version 7', boite);
    expect(d.kind).toBe('dire');
  });

  it('« mets-la dans la file » et ses variantes', () => {
    for (const phrase of ['Mets-la dans la file', 'mets la dans la file d’attente', 'Jarvis, ajoute-la à la file', 'mets-la en file d’attente']) {
      expect(deciderAtelier(phrase, boite)).toEqual({ kind: 'file', etat: boite, numero: 2 });
    }
    expect(deciderAtelier('mets la version 1 dans la file', piece('boite', {}, 1))).toMatchObject({ kind: 'file', numero: 1 });
    expect(deciderAtelier('mets la version 7 dans la file', boite).kind).toBe('dire');
    // Sans pièce dans la discussion : l'atelier le dit (la phrase partait à un modèle, qui répondait « ajoutée à la file »).
    expect(deciderAtelier('mets-la dans la file', null)).toMatchObject({ kind: 'dire', texte: expect.stringContaining('pas de pièce à imprimer') });
  });

  it('relancer la file : seulement si la phrase dit que le plateau est vide', () => {
    for (const phrase of ['Le plateau est vide, lance la suivante', 'Jarvis, plateau vide, lance la prochaine', 'le plateau est libre, imprime la suivante', 'Le plateau est vide. Lance la file.']) {
      expect(deciderAtelier(phrase, null)).toEqual({ kind: 'lancerSuivante' });
      expect(plateauVideLanceSuivante(phrase)).toBe(true);
    }
    for (const phrase of ['lance la suivante', 'lance la file', 'le plateau est vide', 'le plateau n’est pas vide, lance la suivante']) {
      expect(deciderAtelier(phrase, null).kind).toBe('rien');
    }
  });

  it('carte de la file d’attente', () => {
    expect(phraseConfirmationFile('boîte', 1, null, true)).toBe(
      "L'imprimante est occupée. Ajouter à la file d'attente « boîte », version 1. Rien ne sera lancé : l'impression en cours continue, et la file reste en pause jusqu'à ce que tu me dises que le plateau est vide.",
    );
    expect(phraseConfirmationFile('boîte', 1, null, false)).toMatch(/^Ajouter à la file d'attente/);
  });

  it('sans pièce à l’écran, « imprime » n’est pas pour l’atelier (lot B)', () => {
    expect(deciderAtelier('imprime', null).kind).toBe('rien');
    expect(deciderAtelier('imprime le fichier cube.gcode', boite).kind).toBe('rien');
  });

  it('carte de confirmation : temps, filament et plateau', () => {
    expect(phraseConfirmationAtelier('boîte', 2, 'Environ 17 min et 4,3 g de filament (1,40 m).')).toBe(
      "Lancer l'impression de « boîte », version 2. Environ 17 min et 4,3 g de filament (1,40 m). Vérifie que le plateau est vide.",
    );
  });

  it('dossier de pièce sans accent ni espace', () => {
    expect(nomDossierPiece(gabarit('boite_couvercle')!, '2026-11-23', 1)).toBe('boite-avec-couvercle-2026-11-23-1');
  });
});

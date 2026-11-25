import { describe, expect, it } from 'vitest';
import { fabriquer, fichePiece, type Gabarit } from './gabarits.js';
import { deciderAtelier, dernierAtelier, mesuresAffichees, type AtelierDecision, type AtelierEtat } from './discussion.js';

/**
 * L'atelier parlé comme l'utilisateur parle (mission de nuit du 25 au 26 novembre) : chaque phrase
 * corrigée cette nuit est ici. Les phrases sont écrites par Claude dans son style (sans ponctuation,
 * « du coup », « genre », suites de phrase, fautes de dictée) ; elles ne servent qu'aux essais.
 */
const V = { x: 300, y: 300, z: 300 };
type Piece = Extract<AtelierEtat, { etape: 'piece' }>;

/** Dit les phrases l'une après l'autre ; une pièce fabriquée devient « la pièce à l'écran ». */
function discussion(phrases: string[], contexte: Parameters<typeof deciderAtelier>[2] = {}): { decisions: AtelierDecision[]; etat: AtelierEtat | null } {
  let etat: AtelierEtat | null = null;
  const decisions: AtelierDecision[] = [];
  for (const phrase of phrases) {
    const d = deciderAtelier(phrase, etat, contexte);
    decisions.push(d);
    if (d.kind === 'fabriquer') {
      const g: Gabarit = d.gabarit;
      const p = fabriquer(g, d.valeurs, V);
      if (!p.ok) continue;
      const base: Piece | undefined = d.base;
      const versions = [
        ...(base?.versions ?? []),
        {
          numero: (base?.versions.length ?? 0) + 1,
          valeurs: p.valeurs,
          fiche: fichePiece(p),
          mesures: mesuresAffichees(g, p.valeurs),
          taille: p.taille,
          stl: 'v.stl',
          ...(base && g.id !== base.gabarit ? { gabarit: g.id } : {}),
          ...(d.changement ? { changement: d.changement } : {}),
        },
      ];
      etat = { etape: 'piece', gabarit: base?.gabarit ?? g.id, nom: g.nom, dossier: 'x', versions, versionChoisie: versions.length, plateau: { x: 300, y: 300 } };
    } else if (d.kind === 'dire') {
      etat = d.etat ?? (etat?.etape === 'piece' ? etat : null);
    } else if (d.kind === 'choisir') {
      etat = { ...d.etat, versionChoisie: d.numero };
    }
  }
  return { decisions, etat };
}

const derniere = (phrases: string[], contexte: Parameters<typeof deciderAtelier>[2] = {}) => discussion(phrases, contexte).decisions.at(-1)!;

describe('questions : accord, répétition, plusieurs cotes', () => {
  it('« c est quoi deja la question » redit la question, puis les réponses sont lues', () => {
    const { decisions } = discussion(['fais moi une boite', 'c est quoi deja la question', 'cent', 'soixante', 'trente']);
    expect(decisions[1]).toMatchObject({ kind: 'dire', etat: { etape: 'question', mesure: 'longueur' } });
    expect(decisions[4]).toMatchObject({ kind: 'fabriquer', valeurs: { longueur: 100, largeur: 60, hauteur: 30 } });
  });

  it.each(['ouais vas y', 'ouais', 'je sais pas trop fais comme tu veux', 'peu importe', 'nickel', 'pas de probleme'])('« %s » garde la valeur proposée', (accord) => {
    expect(derniere(['jarvis fais moi un support de telephone', accord])).toMatchObject({ kind: 'fabriquer', valeurs: { angle: 60 } });
  });

  it('« 10 par 6 par 3 centimetres » répond à trois questions d’un coup', () => {
    expect(derniere(['du coup il me faut un boitier', 'genre 10 par 6 par 3 centimetres'])).toMatchObject({ kind: 'fabriquer', valeurs: { longueur: 100, largeur: 60, hauteur: 30 } });
  });

  it('une réponse courte illisible repose la question ; une autre demande suit son chemin', () => {
    expect(derniere(['fais moi une boite', 'truc machin'])).toMatchObject({ kind: 'dire', etat: { etape: 'question' } });
    expect(derniere(['fais moi une boite', 'quelle heure il est'])).toEqual({ kind: 'rien' });
    expect(derniere(['fais moi une boite', 'mets la musique'])).toEqual({ kind: 'rien' });
    expect(derniere(['fais moi une boite', 'non'])).toMatchObject({ kind: 'dire', etat: { etape: 'question' } });
  });
});

describe('ce que l’atelier sait faire, pièces inconnues', () => {
  it.each(['tu sais faire quoi comme pieces en 3d', 'qu est ce que tu peux m imprimer', 'j aimerais imprimer un truc en 3d', 'modelise moi ca en 3d', 'modelise', 'imprime moi un pot de fleurs'])(
    '« %s » : la liste des pièces',
    (phrase) => {
      const d = deciderAtelier(phrase, null, {});
      expect(d).toMatchObject({ kind: 'dire', etat: { etape: 'choix' } });
      expect(d.kind === 'dire' ? d.texte : '').toMatch(/boîte.*bac à compartiments/);
    },
  );

  it('après la liste, le nom d’une pièce suffit', () => {
    expect(derniere(['imprime moi un support pour mon ecran', 'bah une boite alors'])).toMatchObject({ kind: 'dire', etat: { etape: 'question', gabarit: 'boite' } });
    expect(derniere(['j aimerais imprimer un truc en 3d', 'genre un truc pour ranger mes vis'])).toMatchObject({ kind: 'dire', etat: { etape: 'choix' } });
    expect(derniere(['j aimerais imprimer un truc en 3d', 'genre un truc pour ranger mes vis', 'un bac'])).toMatchObject({ kind: 'dire', etat: { etape: 'question', gabarit: 'bac' } });
  });

  it.each(['imprime ce document', 'imprime la page', 'tu peux m imprimer la facture', 'dessine moi un chat', 'tu sais faire quoi', 'qu est ce que tu peux faire'])('« %s » n’est pas pour l’atelier', (phrase) => {
    expect(deciderAtelier(phrase, null, {})).toEqual({ kind: 'rien' });
  });
});

describe('lecture des pièces', () => {
  it('« un bac à compartiments de 150 par 100 par 30 avec 3 cases par 2 »', () => {
    expect(deciderAtelier('fais moi un bac a compartiments de 150 par 100 par 30 avec 3 cases par 2', null, {})).toMatchObject({
      kind: 'fabriquer',
      valeurs: { longueur: 150, largeur: 100, hauteur: 30, colonnes: 3, rangees: 2 },
    });
  });

  it('« plutot 4 cases en longueur » sur le bac', () => {
    expect(derniere(['fais moi un bac a compartiments de 150 par 100 par 30 avec 3 cases par 2', 'plutot 4 cases en longueur'])).toMatchObject({ kind: 'fabriquer', valeurs: { colonnes: 4, rangees: 2 } });
  });

  it('une autre pièce nommée avec ses cotes ne change pas la pièce à l’écran', () => {
    const { decisions } = discussion(['fais moi une boite de 60 par 40 par 20', 'et aussi une cale de 60 de long 30 de large et 20 de haut', 'plus haute']);
    expect(decisions[1]).toMatchObject({ kind: 'fabriquer', gabarit: { id: 'cale' } });
    expect(decisions[1]?.kind === 'fabriquer' ? decisions[1].base : null).toBeUndefined();
    expect(decisions[2]).toMatchObject({ kind: 'fabriquer', gabarit: { id: 'cale' } });
  });

  it('« raspberry pi 4 », « pi zero », « arduino uno » ne sont pas le Pi 5 : boîte simple, et c’est dit', () => {
    for (const phrase of ['fais moi une boite pour mon raspberry pi 4', 'fais moi un boitier pour un raspberry pi zero', 'fais moi un boitier pour mon arduino uno']) {
      const d = deciderAtelier(phrase, null, {});
      expect(d).toMatchObject({ kind: 'dire', etat: { etape: 'question', gabarit: 'boite' } });
      expect(d.kind === 'dire' ? d.texte : '').toMatch(/Je n'ai pas les cotes de « /);
    }
    expect(deciderAtelier('je voudrais un boitier pour mon rasberry pie 5', null, {})).toMatchObject({ kind: 'dire', etat: { etape: 'proposition' } });
  });

  it('un écran d’une taille inconnue est dit, pas oublié', () => {
    const d = deciderAtelier('je voudrais un boitier pour mon esp32 avec un ecran de 5 pouces un micro et un haut parleur', null, { rechercheCotes: true });
    expect(d.kind === 'dire' ? d.texte : '').toMatch(/écran de 5 pouces/);
    // L'écran officiel de 7 pouces est connu : pas de phrase d'excuse.
    const hub = deciderAtelier('dessine moi un boitier pour un raspberry pi 5 avec l ecran tactile 7 pouces', null, {});
    expect(hub.kind).toBe('fabriquer');
  });
});

describe('changements sur la pièce à l’écran', () => {
  const boite = ['fais moi une boite de 60 par 40 par 20'];

  it('« ah et les parois plus epaisses »', () => {
    expect(derniere([...boite, 'ah et les parois plus epaisses'])).toMatchObject({ kind: 'fabriquer', valeurs: { paroi: 4 } });
  });

  it('« encore un peu » refait le dernier changement', () => {
    const { decisions } = discussion(['fais moi une boite de 50 par 50 par 50', 'moins haute', 'encore un peu']);
    expect(decisions[1]).toMatchObject({ kind: 'fabriquer', valeurs: { hauteur: 40 } });
    expect(decisions[2]).toMatchObject({ kind: 'fabriquer', valeurs: { hauteur: 30 } });
  });

  it('« non remets le » revient à la version d’avant', () => {
    const { decisions } = discussion([...boite, 'rajoute un trou de 8 a l arriere', 'enleve le trou a l arriere', 'non remets le']);
    expect(decisions[3]).toMatchObject({ kind: 'choisir', numero: 2 });
  });

  it('« la fenetre plus grande » agrandit la découpe, sans demander le sens de la boîte', () => {
    const d = derniere(['fais moi une boite avec couvercle de 100 par 70 par 40', 'fais une fenetre de 40 par 20 sur le dessus', 'la fenetre plus grande']);
    expect(d.kind === 'dire' ? d.texte : '').not.toMatch(/Plus longue, plus large ou plus haute/);
  });

  it('« les ports a gauche plutot » retourne la seule carte de la boîte', () => {
    const d = derniere(['je voudrais un boitier pour mon rasberry pie 5', 'oui', 'les ports a gauche plutot']);
    expect(d).toMatchObject({ kind: 'fabriquer' });
    expect(d.kind === 'fabriquer' ? String(d.valeurs.ajouts) : '').toContain('"ports":"gauche"');
  });

  it('une phrase courte sur la pièce, illisible, reste à l’atelier', () => {
    expect(derniere([...boite, 'le couvercle a charniere'])).toMatchObject({ kind: 'dire', etat: { etape: 'piece' } });
    expect(derniere([...boite, 'ferme la fenetre'])).toEqual({ kind: 'rien' });
    expect(derniere([...boite, 'quelle fenetre est active'])).toEqual({ kind: 'rien' });
  });
});

describe('composant à mesurer : « dessine avec ce que tu as »', () => {
  const contexte = { rechercheCotes: true };

  it.each(['daccord dessinne tout ca', 'vas y modelise', 'bon dessine le avec ce que t as', 'ok'])('« %s » n’est pas une référence de carte à chercher', (phrase) => {
    const d = derniere(['du coup je veux un boitier pour mon esp32', phrase], contexte);
    expect(d.kind).not.toBe('chercherCotes');
    expect(d.kind).not.toBe('rien');
  });

  it('une vraie référence est toujours cherchée', () => {
    expect(derniere(['du coup je veux un boitier pour mon esp32', 'c est une esp32 devkit v1'], contexte)).toMatchObject({ kind: 'chercherCotes' });
    expect(derniere(['du coup je veux un boitier pour mon esp32', 'celle de ta liste'], contexte)).toMatchObject({ kind: 'chercherCotes' });
  });

  it('pendant une mesure, une réponse illisible repose la question', () => {
    const d = derniere(['et un boitier pour esp32', 'je la mesure', 'truc bidule'], contexte);
    expect(d).toMatchObject({ kind: 'dire', etat: { etape: 'mesure' } });
  });
});

describe('la pièce reste à l’écran quelques demandes', () => {
  const piece: Piece = { etape: 'piece', gabarit: 'boite', nom: 'boîte', dossier: 'x', versions: [], versionChoisie: 1, plateau: { x: 300, y: 300 } };
  const tourModele = [
    { role: 'user' },
    { role: 'assistant' },
    { role: 'tool' },
    { role: 'assistant' },
  ];

  it('trois tours du modèle avec un outil ne font pas perdre la pièce', () => {
    const messages = [{ role: 'user' }, { role: 'assistant', atelier: piece }, ...tourModele, ...tourModele, ...tourModele];
    expect(dernierAtelier(messages)).toBe(piece);
  });

  it('après six demandes sans rapport, elle n’y est plus', () => {
    const messages = [{ role: 'user' }, { role: 'assistant', atelier: piece }, ...Array.from({ length: 6 }, () => tourModele).flat()];
    expect(dernierAtelier(messages)).toBeNull();
  });

  it('une question ne vaut que si c’est la dernière réponse', () => {
    const question: AtelierEtat = { etape: 'question', gabarit: 'boite', valeurs: {}, mesure: 'longueur' };
    expect(dernierAtelier([{ role: 'user' }, { role: 'assistant', atelier: question }])).toBe(question);
    expect(dernierAtelier([{ role: 'user' }, { role: 'assistant', atelier: question }, ...tourModele])).toBeNull();
  });
});

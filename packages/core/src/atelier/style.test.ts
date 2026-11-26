import { describe, expect, it } from 'vitest';
import { fabriquer, fichePiece, type Gabarit } from './gabarits.js';
import { ATELIER_REPONSE_MASQUEE, deciderAtelier, dernierAtelier, masquerAtelier, mesuresAffichees, normaliserOrdre, type AtelierDecision, type AtelierEtat } from './discussion.js';
import { plier } from './lecture.js';
import { ajouterCoteTrouvee } from './composants.js';

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
      const base: Piece | undefined = d.base;
      if (!p.ok) {
        // Comme le PC : un changement refusé garde la phrase, pour « bon alors de 10 ».
        if (base) etat = { ...base, refus: normaliserOrdre(plier(phrase)) };
        continue;
      }
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
    } else if (d.kind === 'rien' && etat?.etape === 'piece') {
      // Un autre échange est passé (comme `dernierAtelier`) : ce qui attendait une suite est oublié.
      const { refus: _refus, nombre: _nombre, ...piece } = etat;
      etat = piece;
    } else if (d.kind === 'rien') {
      etat = null;
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

describe('deuxième série de la nuit', () => {
  const boite = ['fais moi une boite de 60 par 40 par 20'];

  it('un trou refusé, puis « bon alors de 10 » : le trou, pas la longueur de la boîte', () => {
    const { decisions } = discussion([...boite, 'rajoute un trou de 50 a l arriere', 'bon alors de 10']);
    expect(decisions[1]).toMatchObject({ kind: 'fabriquer' });
    expect(decisions[2]).toMatchObject({ kind: 'fabriquer', valeurs: { longueur: 60, largeur: 40, hauteur: 20 } });
    expect(decisions[2]?.kind === 'fabriquer' ? String(decisions[2].valeurs.decoupes) : '').toContain('"largeur":10');
  });

  it.each(['bon alors 25', 'mets 50', '30'])('« %s » seul : quelle mesure ? (la longueur ne change pas)', (phrase) => {
    const d = derniere([...boite, phrase]);
    expect(d).toMatchObject({ kind: 'dire', etat: { etape: 'piece' } });
    expect(d.kind === 'dire' ? d.texte : '').toMatch(/pour quelle mesure/);
  });

  it('« fais-la en 60 par 60 » et « hauteur 25 » changent toujours la pièce', () => {
    expect(derniere([...boite, 'fais la en 70 par 60'])).toMatchObject({ kind: 'fabriquer', valeurs: { longueur: 70, largeur: 60 } });
    expect(derniere([...boite, 'hauteur 25'])).toMatchObject({ kind: 'fabriquer', valeurs: { hauteur: 25 } });
  });

  it('« non plus large » après « plus haute » repart de la version d’avant', () => {
    const { decisions } = discussion(['fais moi une boite de 80 par 50 par 30', 'plus haute', 'non plus large']);
    expect(decisions[2]).toMatchObject({ kind: 'fabriquer', valeurs: { hauteur: 30, largeur: 63 } });
  });

  it.each([
    ['reprends la version une', 1],
    ['la version 2', 2],
    ['remets la version 1', 1],
  ])('« %s »', (phrase, numero) => {
    expect(derniere([...boite, 'plus haute', 'plus large', phrase])).toMatchObject({ kind: 'choisir', numero });
  });

  it('« la version 7 » : elle n’existe pas, et c’est dit', () => {
    const d = derniere([...boite, 'la version 7']);
    expect(d.kind === 'dire' ? d.texte : '').toMatch(/pas de version 7/);
  });

  it('« fait un trou de 15mn par 5mn a 20mn de hauteur sur la paroi la plus large »', () => {
    const d = derniere(['fais moi une boite de 80 par 50 par 30', 'fait un trou de 15mn par 5mn a 20mn de hauteur sur la paroi la plus large']);
    const decoupes = d.kind === 'fabriquer' ? String(d.valeurs.decoupes) : '';
    expect(decoupes).toContain('"forme":"rect"');
    expect(decoupes).toContain('"largeur":15');
    expect(decoupes).toContain('"hauteur":5');
    expect(decoupes).toContain('"mm":20');
  });

  it('« lance la suivante » avec une pièce : il faut dire que le plateau est vide', () => {
    const d = derniere([...boite, 'lance la suivante']);
    expect(d.kind === 'dire' ? d.texte : '').toMatch(/le plateau est vide/);
    expect(deciderAtelier('lance la suivante', null, {})).toEqual({ kind: 'rien' });
  });

  it('« imprime-la » sans pièce : réponse de l’atelier dans la Live seulement', () => {
    // Avec le pronom, la phrase vise une pièce : l'atelier répond partout.
    const partout = deciderAtelier('imprime la', null, {});
    expect(partout.kind === 'dire' ? partout.texte : '').toMatch(/pas de pièce à imprimer/);
    expect(deciderAtelier('bon bah mets la dans la file', null, {}).kind).toBe('dire');
    // « imprime » seul : le lot B dans Jarvis Test, l'atelier dans la Live.
    expect(deciderAtelier('imprime', null, {})).toEqual({ kind: 'rien' });
    expect(deciderAtelier('lance l impression', null, {})).toEqual({ kind: 'rien' });
    expect(deciderAtelier('imprime', null, { sansAutreImprimante: true }).kind).toBe('dire');
    // « imprime le fichier x.gcode », « imprime ce document » ne sont jamais pris.
    expect(deciderAtelier('imprime le fichier boite.gcode', null, { sansAutreImprimante: true })).toEqual({ kind: 'rien' });
  });

  it('dans une discussion d’atelier, « fais-moi un pot de fleurs » reçoit la liste ; « dessine-moi un chat » reste une image', () => {
    expect(derniere([...boite, 'fais moi un pot de fleurs'])).toMatchObject({ kind: 'dire', etat: { etape: 'choix' } });
    expect(derniere([...boite, 'dessine moi un chat'])).toEqual({ kind: 'rien' });
    expect(derniere([...boite, 'fais moi un resume de la journee'])).toEqual({ kind: 'rien' });
    expect(deciderAtelier('fais moi un pot de fleurs', null, {})).toEqual({ kind: 'rien' });
  });

  it('« rajoute un ecran tactile avec une camera » sans pièce : l’atelier dit comment demander', () => {
    const d = deciderAtelier('rajoute un ecran tactile avec une camera', null, {});
    expect(d.kind === 'dire' ? d.texte : '').toMatch(/pas de pièce à l'écran/);
  });

  it('« cherche avec ce lien » garde le nom du composant devant le lien', () => {
    const d = derniere(['un boitier pour mon esp32', 'cherche avec ce lien : https://exemple.test/fiche.html'], { rechercheCotes: true });
    expect(d).toMatchObject({ kind: 'chercherCotes' });
    const produit = d.kind === 'chercherCotes' ? d.recherches[0]!.produit : '';
    expect(produit).toMatch(/^ESP32-S3 DevKitC-1 .* https:\/\/exemple\.test\/fiche\.html$/);
  });

  it('la boîte à couvercle se dit à ses cotes, pas à sa place sur le plateau', () => {
    const d = deciderAtelier('je voudrais une boite avec couvercle de 100 par 60 par 40', null, {});
    expect(d.kind).toBe('fabriquer');
    if (d.kind !== 'fabriquer') return;
    const p = fabriquer(d.gabarit, d.valeurs, V);
    expect(p.ok && fichePiece(p)).toMatch(/^Boîte avec couvercle de 100 × 60 × 40 mm \(boîte et couvercle côte à côte sur le plateau : /);
  });
});

describe('cotes lues sur une page : vraisemblables ou pas gardées', () => {
  // Les valeurs rendues par Internet le 25 novembre pour « esp32 S3 ».
  const SOURCE = 'https://exemple.test/esp32';
  const id = 'esp32_s3_devkitc_1_borniers';

  it('53,7 mm au-dessus de la carte, 4,6 mm entre deux trous : refusés', () => {
    expect(ajouterCoteTrouvee({}, id, 'hauteur_dessus', { valeur: 53.7, source: SOURCE }).erreur).toMatch(/trop haut/);
    expect(ajouterCoteTrouvee({}, id, 'entraxe_y', { valeur: 4.6, source: SOURCE }).erreur).toMatch(/trop peu/);
  });

  it('un écart entre les trous plus grand que la carte : refusé', () => {
    const avec = ajouterCoteTrouvee({}, id, 'largeur', { valeur: 23.7, source: SOURCE }).cotes;
    expect(ajouterCoteTrouvee(avec, id, 'entraxe_y', { valeur: 23.7, source: 'https://autre.test/x' }).erreur).toMatch(/impossible/);
  });

  it('les cotes vraisemblables sont gardées ; le plan du fabricant n’est pas discuté', () => {
    expect(ajouterCoteTrouvee({}, id, 'hauteur_dessus', { valeur: 12, source: SOURCE }).erreur).toBeUndefined();
    expect(ajouterCoteTrouvee({}, id, 'entraxe_x', { valeur: 58, source: SOURCE }).erreur).toBeUndefined();
    expect(ajouterCoteTrouvee({}, id, 'hauteur_dessus', { valeur: 45, source: SOURCE, plan: true }).erreur).toBeUndefined();
  });
});

describe('ce qu’un modèle de langage voit de l’atelier', () => {
  it('les réponses de l’atelier sont masquées, le reste ne bouge pas', () => {
    const question: AtelierEtat = { etape: 'question', gabarit: 'boite', valeurs: {}, mesure: 'longueur' };
    const messages = [
      { role: 'user', content: 'fais moi une boite' },
      { role: 'assistant', content: 'Boîte, d’accord. Longueur : je propose 80 mm.', atelier: question },
      { role: 'user', content: 'quelle heure il est' },
      { role: 'assistant', content: 'Il est 14 h.' },
    ];
    const vus = masquerAtelier(messages);
    expect(vus[1]!.content).toBe(ATELIER_REPONSE_MASQUEE);
    expect(vus[0]).toBe(messages[0]);
    expect(vus[3]).toBe(messages[3]);
    expect(messages[1]!.content).toContain('Longueur');
  });

  it('sans réponse d’atelier, la liste est rendue telle quelle', () => {
    const messages = [{ role: 'user', content: 'salut' }, { role: 'assistant', content: 'Bonjour.' }];
    expect(masquerAtelier(messages)).toBe(messages);
  });

  it('proposition en attente : une réponse courte illisible redit la proposition', () => {
    const d = derniere(['je voudrais un boitier pour mon rasberry pie 5', 'prends large partout']);
    expect(d).toMatchObject({ kind: 'dire', etat: { etape: 'proposition' } });
  });
});

describe('troisième série de la nuit', () => {
  it('« mets 50 » puis « en hauteur » : le nombre va à la mesure nommée', () => {
    const { decisions } = discussion(['fais moi une boite de 100 par 80 par 40', 'mets 50', 'en hauteur']);
    expect(decisions[1]).toMatchObject({ kind: 'dire', etat: { etape: 'piece', nombre: '50' } });
    expect(decisions[2]).toMatchObject({ kind: 'fabriquer', valeurs: { longueur: 100, largeur: 80, hauteur: 50 } });
  });

  it('le nombre gardé est oublié à la phrase suivante', () => {
    const { decisions } = discussion(['fais moi une boite de 100 par 80 par 40', 'mets 50', 'quelle heure il est', 'en hauteur']);
    expect(decisions[3]?.kind).not.toBe('fabriquer');
  });

  it('« et un boitier pour un pi zero » avec une pièce à l’écran : une nouvelle pièce, carte inconnue dite', () => {
    const d = derniere(['fais moi une boite de 100 par 70 par 30', 'et un boitier pour un pi zero']);
    expect(d).toMatchObject({ kind: 'dire', etat: { etape: 'question', gabarit: 'boite' } });
    expect(d.kind === 'dire' ? d.texte : '').toMatch(/Je n'ai pas les cotes de « /);
  });

  it('« une boite pour mes bijoux », « une boite de 6 oeufs » sans verbe : pas des demandes', () => {
    expect(deciderAtelier('une boite pour mes bijoux', null, {})).toEqual({ kind: 'rien' });
    expect(deciderAtelier('une boite de 6 oeufs ca coute combien', null, {})).toEqual({ kind: 'rien' });
  });
});

describe('après la série « examen »', () => {
  const entretoise = ['fais moi une entretoise de 10 de diametre et 8 de haut avec un trou de 4'];

  it('« vas y imprime », « bon mets la plutot en file d attente » : l’ordre sans ses mots de liaison', () => {
    expect(derniere([...entretoise, 'vas y imprime'])).toMatchObject({ kind: 'imprimer', numero: 1 });
    expect(derniere([...entretoise, 'bon mets la plutot en file d attente'])).toMatchObject({ kind: 'file', numero: 1 });
    expect(derniere([...entretoise, 'du coup imprime la'])).toMatchObject({ kind: 'imprimer' });
  });

  it('« ca me va », « nickel » après une pièce : rien à valider, dit par l’atelier ; « merci beaucoup » reste au chat', () => {
    expect(derniere([...entretoise, 'ca me va'])).toMatchObject({ kind: 'dire' });
    expect(derniere([...entretoise, 'nickel'])).toMatchObject({ kind: 'dire' });
    expect(derniere([...entretoise, 'Merci beaucoup !'])).toEqual({ kind: 'rien' });
  });

  it('« tu peux m imprimer quelque chose » : la liste, puis « un bac pour trier mes vis »', () => {
    const { decisions } = discussion(['jarvis tu peux m imprimer quelque chose', 'un bac pour trier mes vis', '20 par 15 par 4 cm', 'quatre']);
    expect(decisions[0]).toMatchObject({ kind: 'dire', etat: { etape: 'choix' } });
    expect(decisions[1]).toMatchObject({ kind: 'dire', etat: { etape: 'question', gabarit: 'bac' } });
    expect(decisions[3]).toMatchObject({ kind: 'fabriquer', valeurs: { longueur: 200, largeur: 150, hauteur: 40, colonnes: 4 } });
  });

  it('« et le meme a droite », « pareil a l arriere » : la dernière découpe, ailleurs', () => {
    const { decisions } = discussion(['fais moi un boitier avec couvercle de 80 par 80 par 50', 'rajoute moi un trou de 12 sur le cote gauche', 'et le meme a droite', 'pareil a l arriere']);
    expect(decisions[2]).toMatchObject({ kind: 'fabriquer', changement: 'Ajout : trou de 12 mm sur le côté droit' });
    expect(decisions[3]).toMatchObject({ kind: 'fabriquer', changement: 'Ajout : trou de 12 mm à l’arrière' });
  });
});

describe('après la deuxième série « examen »', () => {
  const boite = ['dessine moi une boite de 7 par 7 par 3 cm'];

  it('« non enleve le » juste après un ajout : la version d’avant', () => {
    expect(derniere([...boite, 'perce un trou de 10 au milieu du fond', 'non enleve le'])).toMatchObject({ kind: 'choisir', numero: 1 });
  });

  it('« tu peux la lancer » = « imprime-la »', () => {
    expect(derniere([...boite, 'tu peux la lancer'])).toMatchObject({ kind: 'imprimer', numero: 1 });
  });

  it('« envoie moi les images » remontre la pièce', () => {
    expect(derniere([...boite, 'Envoie moi les images'])).toMatchObject({ kind: 'choisir', numero: 1 });
  });

  it('« mets pause » pendant une question : la musique, pas l’atelier', () => {
    expect(derniere(['fais moi un crochet', 'mets pause'])).toEqual({ kind: 'rien' });
    expect(derniere(['fais moi un crochet', 'morceau suivant'])).toEqual({ kind: 'rien' });
  });

  it('à la question du modèle exact, « je sais pas c est quoi comme modele » n’est pas cherché sur Internet', () => {
    const contexte = { rechercheCotes: true };
    const d = derniere(['il me faut un boitier pour une esp32', 'je sais pas c est quoi comme modele'], contexte);
    expect(d).toMatchObject({ kind: 'dire', etat: { etape: 'produit' } });
    expect(d.kind === 'dire' ? d.texte : '').toMatch(/je la mesure/);
    expect(derniere(['il me faut un boitier pour une esp32', 'attends je regarde'], contexte)).toMatchObject({ kind: 'dire', etat: { etape: 'produit' } });
  });

  it('pendant une mesure : « attends je reviens » et « je la mesure » reposent la question sans reproche', () => {
    const contexte = { rechercheCotes: true };
    for (const phrase of ['attends je reviens', 'bon je la mesure']) {
      const d = derniere(['il me faut un boitier pour une esp32', 'je la mesure', phrase], contexte);
      expect(d).toMatchObject({ kind: 'dire', etat: { etape: 'mesure' } });
      expect(d.kind === 'dire' ? d.texte : '').not.toMatch(/pas compris/);
    }
  });
});

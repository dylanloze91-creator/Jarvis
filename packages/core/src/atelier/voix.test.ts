import { describe, expect, it } from 'vitest';
import { fabriquer, fichePiece, gabarit } from './gabarits.js';
import { deciderAtelier, mesuresAffichees, type AtelierEtat } from './discussion.js';
import { nombresEnChiffres, plier } from './lecture.js';

/**
 * L'atelier à la voix (demande de l'utilisateur, 24 novembre au soir : « c'est une utilisation
 * souvent à la voix, il faut qu'il comprenne un peu tout »). Les phrases sont écrites comme une
 * dictée les rend : sans ponctuation, nombres en lettres, « euh », « du coup », « Hey Jarvis »,
 * « rasberry pie ».
 */
const V = { x: 300, y: 300, z: 300 };
function ecran(gid: string, valeurs: Record<string, number | string>): Extract<AtelierEtat, { etape: 'piece' }> {
  const g = gabarit(gid)!;
  const p = fabriquer(g, valeurs, V);
  if (!p.ok) throw new Error(p.erreurs.join(' '));
  const versions = [1, 2].map((numero) => ({ numero, valeurs: p.valeurs, fiche: fichePiece(p), mesures: mesuresAffichees(g, p.valeurs), taille: p.taille, stl: `v${numero}.stl` }));
  return { etape: 'piece', gabarit: gid, nom: g.nom, dossier: 'x', versionChoisie: 2, plateau: { x: 300, y: 300 }, versions };
}
const piece = ecran('boite', { longueur: 120, largeur: 94, hauteur: 40 });
const proposition: AtelierEtat = { etape: 'proposition', gabarit: 'boite', valeurs: { longueur: 120, largeur: 94, hauteur: 40 }, base: null };
const quoi = (d: ReturnType<typeof deciderAtelier>) => (d.kind === 'fabriquer' ? `${d.gabarit.id} | ${d.changement}` : d.kind === 'dire' ? `dire | ${d.texte}` : d.kind);

describe('nombres dits en lettres', () => {
  it.each([
    ['cent vingt par quatre vingt par quarante', '120 par 80 par 40'],
    ['quatre vingt dix', '90'],
    ['soixante dix sept', '77'],
    ['vingt et un', '21'],
    ['deux cent cinquante', '250'],
    ['deux virgule cinq', '2.5'],
    ['trois et demi', '3.5'],
    ['un trou de huit', 'un trou de 8'],
    ['quatre bossages', 'quatre bossages'],
    ['les deux cotes', 'les deux cotes'],
    ['raspberry pi cinq', 'raspberry pi 5'],
    ['la version deux', 'la version 2'],
  ])('« %s » → « %s »', (avant, apres) => {
    expect(nombresEnChiffres(avant)).toBe(apres);
  });

  it('dictée : « euh », « du coup », « Hey Jarvis », « rasberry pie », « quoi » en fin', () => {
    expect(plier('Hey Jarvis, euh, du coup un boîtier pour mon rasberry pie cinq quoi')).toBe('un boitier pour mon raspberry pi 5');
  });
});

describe('nouvelle pièce, dictée', () => {
  it.each([
    ["euh Jarvis fais moi une boîte de cent vingt par quatre vingt par quarante avec des plots pour un raspberry pi cinq les ports vers l'arrière", { longueur: 120, largeur: 80, hauteur: 40 }],
    ["est-ce que tu pourrais me faire une boîte de cent sur soixante sur trente s'il te plaît", { longueur: 100, largeur: 60, hauteur: 30 }],
    ['fais moi une boîte de douze centimètres par huit par quatre', { longueur: 120, largeur: 80, hauteur: 40 }],
    ['une boîte de quatre-vingt-dix par cinquante par trente', { longueur: 90, largeur: 50, hauteur: 30 }],
    ['fais-moi une boîte de deux cent cinquante par cent par cinquante', { longueur: 250, largeur: 100, hauteur: 50 }],
  ])('« %s »', (phrase, cotes) => {
    expect(deciderAtelier(phrase, null, {})).toMatchObject({ kind: 'fabriquer', valeurs: cotes });
  });

  it.each([
    'Hey Jarvis fais moi un boîtier pour mon raspberry',
    'je voudrais un boitier pour mon rasberry pie 5',
    'du coup tu peux me faire un boîtier pour le Raspberry Pi 5 avec les prises derrière',
  ])('« %s » : la boîte pour la carte est proposée', (phrase) => {
    expect(deciderAtelier(phrase, null, {})).toMatchObject({ kind: 'dire', etat: { etape: 'proposition' } });
  });
});

describe('dire oui, à la voix', () => {
  it.each(["ouais ok vas-y c'est bon", 'OK impec', 'ça marche merci', "d'acc", "parfait c'est nickel vas-y", 'oui oui', 'euh oui vas-y', "ouais c'est bon fais-la", 'bah oui', 'yes', 'carrément'])(
    '« %s »',
    (phrase) => {
      expect(deciderAtelier(phrase, proposition, {}).kind).toBe('fabriquer');
    },
  );
});

describe('changer la pièce, à la voix', () => {
  it.each([
    ['rajoute moi un couvercle qui se clipse dessus', 'boite_couvercle | Couvercle ajouté, Ajout : un couvercle qui s’emboîte (lèvre de 1,2 mm, 0,25 mm de jeu par côté)'],
    ['fais moi un trou de huit millimètres sur le côté droit pour passer un câble', 'boite | Ajout : trou de 8 mm sur le côté droit'],
    ["en fait il faudrait qu'elle soit un peu plus haute genre de dix millimètres", 'boite | Hauteur : 40 mm → 50 mm'],
    ['agrandis de 2 cm en hauteur', 'boite | Hauteur : 40 mm → 60 mm'],
    ['fais-la plus haute de deux centimètres', 'boite | Hauteur : 40 mm → 60 mm'],
    // Avant, « cinq » n'était pas lu et le trou passait à 8 mm sans rien dire.
    ['met un trou de cinq à gauche', 'boite | Ajout : trou de 5 mm sur le côté gauche'],
    ['fait un trou de huit à droite', 'boite | Ajout : trou de 8 mm sur le côté droit'],
    ['ok et maintenant un trou de huit à droite pour le câble', 'boite | Ajout : trou de 8 mm sur le côté droit'],
    ['euh ajoute un trou de huit euh sur le côté droit quoi', 'boite | Ajout : trou de 8 mm sur le côté droit'],
    ['dix de plus en largeur', 'boite | Largeur : 94 mm → 104 mm'],
    ['la hauteur mets la à cinquante', 'boite | Hauteur : 40 mm → 50 mm'],
    ['mets la hauteur à cinquante', 'boite | Hauteur : 40 mm → 50 mm'],
    ['hauteur cinquante', 'boite | Hauteur : 40 mm → 50 mm'],
  ])('« %s »', (phrase, attendu) => {
    expect(quoi(deciderAtelier(phrase, piece, {}))).toBe(attendu);
  });

  it('« non en fait remets comme avant » : la version précédente', () => {
    expect(deciderAtelier('non en fait remets comme avant', piece, {})).toMatchObject({ kind: 'choisir', numero: 1 });
  });

  it.each(['mets la dans la file', "envoie la dans la file d'attente"])('« %s » : file d’attente', (phrase) => {
    expect(deciderAtelier(phrase, piece, {}).kind).toBe('file');
  });

  it.each(['elle fait combien de haut là', 'quelles sont les dimensions', 'c’est quoi la taille de la boîte'])('« %s » : les cotes de la version à l’écran', (phrase) => {
    expect(deciderAtelier(phrase, piece, {})).toMatchObject({ kind: 'dire', texte: expect.stringMatching(/^Version 2 : longueur 120 mm, largeur 94 mm, hauteur 40 mm/) });
  });

  it.each(['ouais vas-y', 'ok super merci', "c'est bon", 'oui parfait'])('« %s » juste après une pièce : rien à valider, l’atelier le dit', (phrase) => {
    expect(deciderAtelier(phrase, piece, {})).toMatchObject({ kind: 'dire', texte: "La version 2 est faite. Dis-moi ce qu'il faut changer, ou « mets-la dans la file »." });
    // « fais-la plus haute » n'est pas un simple « ok ».
    expect(deciderAtelier('fais-la plus haute', piece, {}).kind).toBe('fabriquer');
  });

  // Essai de l'utilisateur, 19 h 50 : « Reessaye » après la boîte était parti au cerveau, qui avait
  // prétendu « ajuster la boîte » sans rien faire.
  it.each(['Reessaye', 'réessaie', 'remontre-la moi', 'renvoie les images', 'je la vois pas', "les images s'affichent pas", 'montre-la'])(
    '« %s » : la même version, renvoyée telle quelle',
    (phrase) => {
      expect(deciderAtelier(phrase, piece, {})).toMatchObject({ kind: 'choisir', numero: 2 });
    },
  );

  // Essai de l'utilisateur, 24 novembre à 22 h : « Et un boîtier pour un esp32 » était parti au
  // cerveau (taille inventée), « Dessine une version adaptée à l’esp32 » à l'équipe Code (refus).
  it.each(['Et un boîtier pour un esp32', 'Dessine une version adaptée à l’esp32', 'fais la même pour un esp32', 'aussi une boîte pour mon ESP32'])(
    '« %s » : nouvelle boîte pour l’ESP32, cotes demandées au pied à coulisse',
    (phrase) => {
      for (const etat of [piece, null]) {
        expect(deciderAtelier(phrase, etat, {})).toMatchObject({ kind: 'dire', etat: { etape: 'mesure' } });
      }
    },
  );

  it('« une boîte de six œufs » ou « une boîte pour mes bijoux » sans verbe ne sont pas des demandes', () => {
    expect(deciderAtelier('une boîte de six œufs', null, {}).kind).toBe('rien');
    expect(deciderAtelier('et une boîte pour mes bijoux', null, {}).kind).toBe('rien');
  });

  // Même essai : « Rajoute un écran tactile avec une caméra » recevait « je n'ai pas su faire ce
  // changement » ; l'écran et la caméra viennent avec le boîtier électronique, et l'atelier le dit.
  it.each(['Rajoute un écran tactile avec une caméra', 'Rajoute un écran tactile', 'intègre une caméra'])('« %s » : l’atelier dit pourquoi pas encore', (phrase) => {
    expect(deciderAtelier(phrase, piece, {})).toMatchObject({ kind: 'dire', texte: expect.stringMatching(/se tient autrement .*boîtier électronique/) });
  });

  it('« montre-moi la file d’attente » n’est pas pour la pièce', () => {
    expect(deciderAtelier("montre moi la file d'attente", piece, {}).kind).not.toBe('choisir');
  });

  it('les questions d’un autre sujet ne sont pas prises', () => {
    for (const phrase of ['combien de temps pour l’imprimer', 'il fait combien dehors', 'quelle heure est-il']) {
      expect(deciderAtelier(phrase, piece, {}).kind).toBe('rien');
    }
  });
});

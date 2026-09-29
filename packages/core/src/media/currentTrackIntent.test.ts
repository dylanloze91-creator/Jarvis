import { describe, expect, it } from 'vitest';
import { isCurrentTrackQuestion } from './currentTrackIntent.js';

describe('isCurrentTrackQuestion', () => {
  it.each([
    'Que joue Spotify en ce moment ?',
    'Que joue Spotify ?',
    "Qu'est-ce que joue Spotify ?",
    'Spotify joue quoi ?',
    "Qu'est-ce qui joue ?",
    "Qu'est-ce qui passe ?",
    "Qu'est-ce qui passe en ce moment ?",
    'Qu’est-ce qui passe sur Spotify ?',
    'Dis-moi ce qui passe sur Spotify',
    "C'est quoi cette musique ?",
    "Jarvis, c'est quoi cette musique ?",
    "C'est quoi cette musique ? Elle est trop bien.",
    "Cette musique, c'est quoi ?",
    "C'est quoi ce son ?",
    'Quel est ce morceau ?',
    'Quel est ce son ?',
    'Quelle est cette chanson ?',
    "Comment s'appelle cette chanson ?",
    "C'est quoi le nom de cette chanson ?",
    "C'est qui qui chante ?",
    "C'est qui qui chante là ?",
    "Qui c'est qui chante ?",
    'Qui chante ça ?',
    "C'est qui l'artiste de cette chanson ?",
    'Quelle musique tourne ?',
    'Quelle musique tourne en ce moment ?',
    'Quel son passe là ?',
    "C'est quoi le son qui passe ?",
    'Quel est le morceau actuel ?',
    "C'est quoi le morceau en cours ?",
    "Qu'est-ce que j'écoute ?",
    "Écoute, c'est quoi ce son ?",
  ])('reconnaît « %s »', (prompt) => {
    expect(isCurrentTrackQuestion(prompt)).toBe(true);
  });

  it.each([
    ["qu'est ce qui passe là", 'sans trait d’union'],
    ['quest-ce qui passe', 'apostrophe perdue'],
    ["Qu'est-ce qu'il passe ?", '« qu’il » pour « qui »'],
    ["C'est qui qu'il chante ?", '« qu’il » pour « qui »'],
    ['C quoi cette musique', '« c » pour « c’est »'],
    ["c'est quoi c'te musique", '« c’te » pour « cette »'],
    ["C'est quoi ce sont ?", '« ce sont » pour « ce son »'],
    ['quel est se morceau', '« se » pour « ce »'],
    ["Qu'est-ce qui passe sur Spotifaï ?", '« Spotifaï »'],
    ['kel musique tourne', '« kel »'],
  ])('reconnaît la graphie Whisper « %s » (%s)', (prompt) => {
    expect(isCurrentTrackQuestion(prompt)).toBe(true);
  });

  it.each([
    'joue du Nekfeu',
    'lance lomepal sur spotify',
    'mets du Jul',
    'écouter On Verra de Nekfeu',
    'Lance Spotify',
    'pause',
    'mets cette chanson en boucle',
    'mets le morceau en cours en boucle',
    'joue la musique qui passe sur spotify',
  ])('laisse la commande « %s » aux autres outils', (prompt) => {
    expect(isCurrentTrackQuestion(prompt)).toBe(false);
  });

  it.each([
    'Qui chante Bohemian Rhapsody ?',
    "C'est qui le chanteur de Queen ?",
    'Quel est le meilleur morceau de Lomepal ?',
    'Quel est le dernier album de Nekfeu ?',
    "C'est quoi le rap ?",
    "La musique, c'est quoi ?",
    "C'est quoi la musique la plus écoutée au monde ?",
    'Quelle musique tu aimes ?',
    'Quels sont les sons du moment ?',
    'Quel est ton morceau préféré ?',
    'Que penses-tu de la musique actuelle ?',
    "Qu'est-ce qu'on écoute ce soir ?",
    "C'est quoi ce genre de musique ?",
    'Qui chante la Marseillaise ?',
  ])('ne prend pas la question générale « %s »', (prompt) => {
    expect(isCurrentTrackQuestion(prompt)).toBe(false);
  });

  it.each([
    "Qu'est-ce qui se passe ?",
    "Qu'est-ce qui passe à la télé ce soir ?",
    'Quelle musique passe à la radio ?',
    "C'est quoi la musique de cette vidéo YouTube ?",
    "C'est quoi cette erreur ?",
    'Quel est ce fichier ?',
    'Quel est le titre de ce film ?',
    "C'est quoi Spotify ?",
    'Quel temps fait-il en ce moment ?',
    'quelle heure est-il ?',
    "j'adore cette chanson",
    'tu joues à quoi ?',
  ])('ne prend pas « %s »', (prompt) => {
    expect(isCurrentTrackQuestion(prompt)).toBe(false);
  });
});

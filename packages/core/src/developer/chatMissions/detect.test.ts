import { describe, expect, it } from 'vitest';
import {
  CHAT_MISSION_DIRECT_INTRO,
  cleanMissionObjective,
  detectRequestedLanguage,
  directMissionRequest,
  isJarvisSupportedLanguage,
  looksLikeCodeExplanationOnly,
  looksLikeWrittenMissionProposal,
  missionFromUserPhrase,
  objectifForMissionLaunch,
  unsupportedLanguageNotice,
} from './detect.js';

describe('directMissionRequest (5.0.69)', () => {
  it('demandes claires de fichiers', () => {
    const mainsail = directMissionRequest(
      'Jarvis, écris-moi un script Python pour lancer mes impressions 3D depuis Mainsail',
    );
    expect(mainsail).toMatchObject({
      type: 'nouveau-projet',
      langage: 'Python',
    });
    expect(mainsail?.objectif.toLowerCase()).not.toContain('jarvis');
    expect(mainsail?.objectif).toContain('impressions 3D');

    expect(directMissionRequest('fais-moi un jeu de serpent')).toMatchObject({
      type: 'nouveau-projet',
      objectif: 'fais-moi un jeu de serpent',
    });

    expect(
      directMissionRequest('corrige le bug du bouton exporter dans Jarvis'),
    ).toMatchObject({ type: 'corriger' });

    expect(
      directMissionRequest('ajoute un bouton pause dans mon Pong', { knownProjectNames: ['Pong'] }),
    ).toMatchObject({ type: 'modifier' });
  });

  it('refus : questions, exemples, conseils, merci (synthetique-test)', () => {
    expect(directMissionRequest("c'est quoi une boucle for")).toBeNull();
    expect(directMissionRequest('comment on fait un script Python ?')).toBeNull();
    expect(directMissionRequest('montre-moi un exemple de fonction')).toBeNull();
    expect(directMissionRequest('tu me conseilles quel langage pour un robot ?')).toBeNull();
    expect(directMissionRequest('merci')).toBeNull();
    expect(looksLikeCodeExplanationOnly("C'est quoi une boucle for ?")).toBe(true);
  });

  it('questions en tête de phrase : pas de mission, sauf « est-ce que tu peux » (synthetique-test)', () => {
    expect(directMissionRequest('Comment je peux créer un script Python ?')).toBeNull();
    expect(directMissionRequest("Est-ce qu'on peut faire un jeu en Python ?")).toBeNull();
    expect(directMissionRequest('Pourquoi créer un script de sauvegarde ?')).toBeNull();
    expect(directMissionRequest('Quel script dois-je écrire pour mes sauvegardes ?')).toBeNull();
    expect(directMissionRequest("Jarvis, comment je fais un script qui envoie un ping ?")).toBeNull();
    expect(looksLikeCodeExplanationOnly('Comment je peux créer un script Python ?')).toBe(true);
    expect(looksLikeCodeExplanationOnly("Est-ce qu'on peut faire un jeu en Python ?")).toBe(true);
    expect(looksLikeCodeExplanationOnly('Quelles fonctions ajouter à mon appli ?')).toBe(true);
    expect(looksLikeCodeExplanationOnly('Est-ce que tu peux me faire un script de sauvegarde ?')).toBe(false);
    expect(
      directMissionRequest('Est-ce que tu peux me faire un script de sauvegarde ?'),
    ).toMatchObject({ type: 'nouveau-projet' });
    expect(
      directMissionRequest('Est-ce que tu pourrais créer un jeu de pong ?'),
    ).toMatchObject({ type: 'nouveau-projet' });
  });

  it('formes parlées (synthetique-test)', () => {
    expect(
      directMissionRequest('Jarvis, tu peux me faire un script qui envoie un ping'),
    ).toMatchObject({ type: 'nouveau-projet' });
    expect(
      directMissionRequest("j'aimerais un programme qui trie mes photos"),
    ).toMatchObject({ type: 'nouveau-projet' });
    expect(
      directMissionRequest('il me faudrait un script pour exporter mes contacts'),
    ).toMatchObject({ type: 'nouveau-projet' });
  });

  it('au moins trente phrases marquées synthetique-test', () => {
    const samples: Array<{ text: string; expect: 'yes' | 'no'; type?: string }> = [
      { text: 'Crée un module de logs pour mon appli', expect: 'yes' },
      { text: 'Fabrique une petite appli de notes', expect: 'yes' },
      { text: 'Programme un outil qui compresse des images', expect: 'yes' },
      { text: 'Développe un site vitrine simple', expect: 'yes' },
      { text: 'Écris-moi une fonction qui calcule la TVA', expect: 'yes' },
      { text: 'Code-moi un script de sauvegarde', expect: 'yes' },
      { text: 'Documente le module auth avec un README', expect: 'yes', type: 'documenter' },
      { text: 'Répare le bug de connexion dans Jarvis', expect: 'yes', type: 'corriger' },
      { text: 'Modifie le bouton export dans Jarvis', expect: 'yes', type: 'modifier' },
      { text: 'Change la couleur du bouton dans mon Tetris', expect: 'yes', type: 'modifier' },
      { text: 'Ajoute des tests au projet Jarvis', expect: 'yes', type: 'modifier' },
      { text: 'Fais une appli CLI pour renommer des fichiers', expect: 'yes' },
      { text: 'Construis un petit jeu de pong', expect: 'yes' },
      { text: 'Prépare un script bash pour mes logs', expect: 'yes' },
      { text: 'Installe un module npm via un script', expect: 'yes' },
      { text: 'Génère un fichier de config pour mon outil', expect: 'yes' },
      { text: 'Jarvis fais un script rust pour trier', expect: 'yes' },
      { text: 'Peux-tu me coder une page web de démo', expect: 'yes' },
      { text: 'Il me faudrait un logiciel qui lit la météo', expect: 'yes' },
      { text: 'Crée-moi un projet node pour parser du csv', expect: 'yes' },
      { text: 'Explique les promesses JavaScript', expect: 'no' },
      { text: 'Qu’est-ce qu’un fichier package.json ?', expect: 'no' },
      { text: 'Montre-moi un exemple de composant React', expect: 'no' },
      { text: 'Comment on écrit une boucle while ?', expect: 'no' },
      { text: 'Tu me conseilles Rust ou Go ?', expect: 'no' },
      { text: 'Salut', expect: 'no' },
      { text: 'Ok merci beaucoup', expect: 'no' },
      { text: 'Raconte une blague', expect: 'no' },
      { text: 'Quelle heure est-il ?', expect: 'no' },
      { text: 'Augmente le volume', expect: 'no' },
      { text: 'Ouvre Chrome', expect: 'no' },
      { text: 'Résume ce paragraphe', expect: 'no' },
    ];
    expect(samples.length).toBeGreaterThanOrEqual(30);
    for (const sample of samples) {
      const result = directMissionRequest(sample.text, { knownProjectNames: ['Tetris', 'Pong'] });
      if (sample.expect === 'no') {
        expect(result, sample.text).toBeNull();
      } else {
        expect(result, sample.text).not.toBeNull();
        if (sample.type) expect(result?.type).toBe(sample.type);
      }
    }
  });
});

describe('langage et filet mission écrite', () => {
  it('détecte Python et avertissement Node', () => {
    expect(detectRequestedLanguage('un script Python pour Mainsail')).toBe('Python');
    expect(isJarvisSupportedLanguage('Python')).toBe(false);
    expect(unsupportedLanguageNotice('Python')).toContain('Python');
    expect(objectifForMissionLaunch('Lancer mes impressions', 'Python')).toContain('JavaScript / Node');
  });

  it('looksLikeWrittenMissionProposal', () => {
    expect(
      looksLikeWrittenMissionProposal(
        'Objectif : SSH vers Mainsail\nProjet : nouveau\nType : Nouveau-projet\nEst-ce que cela te convient ?',
      ),
    ).toBe(true);
    expect(looksLikeWrittenMissionProposal('Voici un script simple.')).toBe(false);
  });

  it('missionFromUserPhrase garde la phrase utilisateur', () => {
    const fuzzy = missionFromUserPhrase('Peut-être un petit utilitaire pour mes fichiers csv demain');
    expect(fuzzy?.type).toBe('nouveau-projet');
    expect(fuzzy?.objectif.length).toBeGreaterThanOrEqual(8);
  });

  it('intro mission directe fixe', () => {
    expect(CHAT_MISSION_DIRECT_INTRO).toContain('Vérifie l’objectif');
    expect(cleanMissionObjective('Jarvis, fais un script')).toBe('fais un script');
  });
});

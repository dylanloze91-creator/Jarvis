import { describe, expect, it } from 'vitest';
import { createMessage } from '../types.js';
import {
  addresseeCheckEnabled,
  addresseeUserPrompt,
  followUpAddressee,
  followUpWindowMs,
  parseAddresseeReply,
  stripTrailingWakeWord,
  wakeWordAddress,
} from './addressee.js';

const wake = { word: 'jarvis' };

describe('wakeWordAddress : à Jarvis ou de Jarvis', () => {
  it.each([
    'Jarvis, ouvre Chrome',
    'Jarvis ouvre Chrome',
    'Bon, Jarvis, ouvre Chrome',
    'Ok Jarvis, mets de la musique',
    'Hey Jarvis',
    'Jarvis ?',
    'Quelle heure est-il, Jarvis ?',
    'Dis-moi, Jarvis, quelle heure il est',
    'C’est quoi la météo Jarvis',
    'Euh… Jarvis, tu peux baisser le son ?',
    'Djarvis, lance Spotify',
  ])('« %s » lui parle', (text) => {
    expect(wakeWordAddress(text, wake)).toBe('address');
  });

  it.each([
    'Tu connais Jarvis ?',
    'Tu connais Jarvis, c’est mon assistant',
    'le Jarvis de mon frère',
    'J’ai parlé à Jarvis ce matin',
    'Je code Jarvis depuis des mois',
    'Mon Jarvis est trop lent',
    'Il faut que Jarvis apprenne à se taire',
    'Ce soir je montre Jarvis à Paul',
  ])('« %s » parle de lui', (text) => {
    expect(wakeWordAddress(text, wake)).toBe('mention');
  });

  describe('revue 5.0.64, point 7 : possessif et « au »', () => {
    it.each([
      'Mon assistant Jarvis, il est génial',
      'Mon assistant Jarvis, il ne répond plus',
      'Ma copine adore Jarvis, elle lui parle tout le temps',
      'Notre Jarvis, il bugue depuis hier',
      'Bon, mon assistant Jarvis, il a planté',
      'Tu sais, mon assistant Jarvis, il m’a fait rire',
      'Je pense au Jarvis de mon frère, il marche bien',
      'Il est fier de son Jarvis, c’est son bébé',
    ])('« %s » parle de lui (la virgule après le mot ne suffit pas)', (text) => {
      expect(wakeWordAddress(text, wake)).toBe('mention');
    });

    it.each([
      'Au fait Jarvis, c’est quoi la météo ?',
      'Au fait, Jarvis, ouvre Chrome',
      'Ouvre mon dossier Jarvis',
      'Montre-moi mon agenda, Jarvis',
      'Bon, Jarvis, ouvre Chrome',
      'Et toi Jarvis, tu en penses quoi ?',
    ])('« %s » lui parle toujours', (text) => {
      expect(wakeWordAddress(text, wake)).toBe('address');
    });

    it('« au » seul n’est plus un mot d’appel : il marque une mention', () => {
      expect(wakeWordAddress('Je parle au Jarvis de Paul, il est lent', wake)).toBe('mention');
      expect(wakeWordAddress('On a donné le nom au Jarvis, il était content', wake)).toBe('mention');
    });
  });

  it('sans le mot dans le texte : absent (comportement d’avant)', () => {
    expect(wakeWordAddress('Ouvre Chrome', wake)).toBe('absent');
    expect(wakeWordAddress('', wake)).toBe('absent');
  });

  it('respecte un mot de réveil personnalisé et ses variantes', () => {
    expect(wakeWordAddress('Friday, ouvre Chrome', { word: 'friday' })).toBe('address');
    expect(wakeWordAddress('tu connais Friday ?', { word: 'friday' })).toBe('mention');
    expect(wakeWordAddress('Djeeves, ouvre Chrome', { word: 'jeeves', variants: ['djeeves'] })).toBe('address');
  });
});

describe('stripTrailingWakeWord', () => {
  it('retire « , Jarvis » en fin de phrase et garde la ponctuation', () => {
    expect(stripTrailingWakeWord('Quelle heure est-il, Jarvis ?', wake)).toBe('Quelle heure est-il ?');
    expect(stripTrailingWakeWord('Merci Jarvis.', wake)).toBe('Merci.');
    expect(stripTrailingWakeWord('Ouvre Chrome', wake)).toBe('Ouvre Chrome');
    expect(stripTrailingWakeWord('Jarvis', wake)).toBe('Jarvis');
  });
});

describe('followUpAddressee : suite sans « Jarvis »', () => {
  it.each([
    'Ouvre Chrome',
    'et demain ?',
    'Et pour Lyon ?',
    'Tu peux répéter ?',
    'Est-ce que tu sais à quelle heure ça ferme ?',
    'Merci',
    'Vas-y',
    'Baisse le son',
    'Explique-moi plus simplement',
  ])('« %s » : oui sans demander au modèle', (text) => {
    expect(followUpAddressee(text, wake)).toBe('yes');
  });

  it('une mention de Jarvis à quelqu’un d’autre : non', () => {
    expect(followUpAddressee('Tu vois, Jarvis il fait ça tout seul', wake)).toBe('no');
    expect(followUpAddressee('le Jarvis de mon frère est plus rapide', wake)).toBe('no');
  });

  it('le reste : à demander au modèle', () => {
    expect(followUpAddressee('Chérie, tu as vu mes clés ?', wake)).toBe('unsure');
    expect(followUpAddressee('Il fait super beau aujourd’hui', wake)).toBe('unsure');
  });
});

describe('question au modèle', () => {
  it('le prompt contient la fin de la conversation et la phrase', () => {
    const prompt = addresseeUserPrompt('Il fait beau', [
      createMessage('user', 'Quelle météo demain ?'),
      createMessage('assistant', 'Soleil, 22 degrés.'),
    ]);
    expect(prompt).toContain('Utilisateur : Quelle météo demain ?');
    expect(prompt).toContain('Jarvis : Soleil, 22 degrés.');
    expect(prompt).toContain('« Il fait beau »');
  });

  it('« non » seulement s’il est clair, sinon oui', () => {
    expect(parseAddresseeReply('non')).toBe('no');
    expect(parseAddresseeReply('Non.')).toBe('no');
    expect(parseAddresseeReply('oui')).toBe('yes');
    expect(parseAddresseeReply('')).toBe('yes');
    expect(parseAddresseeReply('peut-être')).toBe('yes');
  });
});

describe('réglages', () => {
  it('fenêtre de suivi : 8 s par défaut, 0 possible, bornée', () => {
    expect(followUpWindowMs(undefined)).toBe(8_000);
    expect(followUpWindowMs({})).toBe(8_000);
    expect(followUpWindowMs({ followUpSeconds: 0 })).toBe(0);
    expect(followUpWindowMs({ followUpSeconds: 15 })).toBe(15_000);
    expect(followUpWindowMs({ followUpSeconds: 999 })).toBe(120_000);
  });

  it('vérification du destinataire active sauf si coupée', () => {
    expect(addresseeCheckEnabled(undefined)).toBe(true);
    expect(addresseeCheckEnabled({})).toBe(true);
    expect(addresseeCheckEnabled({ addresseeCheck: false })).toBe(false);
  });
});

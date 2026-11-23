import { describe, expect, it } from 'vitest';
import { LIVE_EDITION, TEST_EDITION } from '../edition.js';
import { parseSettings } from '../settings.js';
import {
  APPENDICE_CONTRACT,
  APPENDICE_POLICY,
  APPENDICE_RISKS,
  actionMeasured,
  appendiceActionNeedsCard,
  appendiceParamsSchema,
  checkAppendiceBaseUrl,
  describeAppendiceAction,
  describeAppendiceState,
  parseAppendiceHello,
} from './contract.js';
import { isStopAllPhrase, stopAllSentence } from './stopAll.js';

const hello = {
  contrat: APPENDICE_CONTRACT,
  id: 'faux-bras',
  genre: 'bras',
  nom: 'Faux bras',
  piece: 'établi',
  version: '0.1.0',
  risque: 'bouger',
  capacites: [{ nom: 'saisir', description: 'Ferme la pince.' }, { nom: 'mesurer', risque: 'lire' }],
};

describe('contrat des appendices : présentation', () => {
  it('lit une présentation conforme', () => {
    const check = parseAppendiceHello(hello);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.hello.capacites.map((capacity) => capacity.nom)).toEqual(['saisir', 'mesurer']);
  });

  it('refuse une autre version du contrat, sans deviner', () => {
    const check = parseAppendiceHello({ ...hello, contrat: 2 });
    expect(check).toEqual({ ok: false, reason: expect.stringContaining('version 2') });
  });

  it('refuse un genre inconnu, un identifiant bizarre, une capacité au nom réservé ou en double', () => {
    expect(parseAppendiceHello({ ...hello, genre: 'canon' }).ok).toBe(false);
    expect(parseAppendiceHello({ ...hello, id: '../etc' }).ok).toBe(false);
    expect(parseAppendiceHello({ ...hello, capacites: [{ nom: 'stop' }] }).ok).toBe(false);
    expect(parseAppendiceHello({ ...hello, capacites: [{ nom: 'saisir' }, { nom: 'saisir' }] }).ok).toBe(false);
    expect(parseAppendiceHello({ ...hello, capacites: [{ nom: 'Saisir Vite' }] }).ok).toBe(false);
    expect(parseAppendiceHello(null).ok).toBe(false);
  });

  it('ramène les textes de l’appendice sur une ligne, sans caractère de contrôle', () => {
    const check = parseAppendiceHello({ ...hello, nom: 'Bras\n\u0007  du   robot' });
    expect(check.ok && check.hello.nom).toBe('Bras du robot');
  });
});

describe('contrat des appendices : adresse', () => {
  it('accepte le réseau local seulement', () => {
    expect(checkAppendiceBaseUrl('http://127.0.0.1:8770').ok).toBe(true);
    expect(checkAppendiceBaseUrl('http://192.168.1.50:8770')).toEqual({ ok: true, origin: 'http://192.168.1.50:8770' });
    expect(checkAppendiceBaseUrl('http://bras.local').ok).toBe(true);
  });

  it('refuse Internet, les identifiants dans l’adresse et les autres protocoles, avec une phrase sur l’appendice', () => {
    for (const url of ['http://example.com', 'http://8.8.8.8', 'http://moi:secret@192.168.1.5', 'ftp://192.168.1.5', '']) {
      const check = checkAppendiceBaseUrl(url);
      expect(check.ok, url).toBe(false);
      if (!check.ok) expect(check.reason.toLowerCase(), url).not.toContain('robot');
    }
  });
});

describe('contrat des appendices : accord', () => {
  it('réglage prudent : chaque action demande une carte, quel que soit le risque', () => {
    expect(APPENDICE_POLICY.everyActionConfirmed).toBe(true);
    expect(APPENDICE_POLICY.speakerMayStart).toBe(false);
    for (const risk of APPENDICE_RISKS) expect(appendiceActionNeedsCard(risk), risk).toBe(true);
  });

  it('paramètres d’action : valeurs simples et peu nombreuses', () => {
    expect(appendiceParamsSchema.safeParse({ distance_mm: 20, lent: true, cible: 'boite' }).success).toBe(true);
    expect(appendiceParamsSchema.safeParse({ cible: { x: 1 } }).success).toBe(false);
    expect(appendiceParamsSchema.safeParse({ 'Mauvais Nom': 1 }).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`p${index}`, index]));
    expect(appendiceParamsSchema.safeParse(many).success).toBe(false);
  });
});

describe('contrat des appendices : résultat clair', () => {
  it('« terminé » seulement avec une mesure', () => {
    const done = describeAppendiceAction('Faux bras', 'saisir', { statut: 'termine', mesure: { ouverture_mm: 12 } });
    expect(done.outcome).toBe('success');
    expect(done.content).toContain('terminé');
    expect(done.content).toContain('ouverture_mm');
  });

  it('« terminé » sans mesure n’est jamais dit comme fait', () => {
    for (const mesure of [undefined, null, '', '  ', {}, []]) {
      const report = describeAppendiceAction('Faux bras', 'saisir', { statut: 'termine', mesure });
      expect(report.outcome).toBe('recoverable');
      expect(report.content).toContain('Je ne peux pas dire que c’est fait');
    }
    expect(actionMeasured({ statut: 'termine', mesure: 0 })).toBe(true);
    expect(actionMeasured({ statut: 'termine', mesure: false })).toBe(true);
  });

  it('chaque autre statut est dit tel quel ; une action qui dure encore demande un arrêt', () => {
    expect(describeAppendiceAction('B', 'saisir', { statut: 'en_cours' })).toMatchObject({ outcome: 'timeout', stopNeeded: true });
    expect(describeAppendiceAction('B', 'saisir', { statut: 'bloque', message: 'effort trop grand' })).toMatchObject({
      outcome: 'definitive',
      content: expect.stringContaining('effort trop grand'),
    });
    expect(describeAppendiceAction('B', 'saisir', { statut: 'refuse' }).outcome).toBe('definitive');
    expect(describeAppendiceAction('B', 'saisir', { statut: 'erreur' }).outcome).toBe('definitive');
    expect(describeAppendiceAction('B', 'saisir', { statut: 'interrompu' }).outcome).toBe('cancelled');
    expect(describeAppendiceAction('B', 'saisir', { statut: 'remplace' }).outcome).toBe('cancelled');
  });

  it('dit l’état en français', () => {
    expect(describeAppendiceState('Faux bras', { etat: 'arret_urgence' })).toBe('Faux bras : en arrêt d’urgence.');
    expect(
      describeAppendiceState('Faux bras', { etat: 'occupe', action: { statut: 'en_cours', type: 'saisir' }, mesures: { charge_g: 120 } }),
    ).toBe('Faux bras : occupé ; action en cours : saisir ; charge_g = 120.');
  });
});

describe('« arrête tout »', () => {
  it('reconnaît l’ordre seul, avec ou sans « Jarvis » et politesse', () => {
    for (const text of [
      'Arrête tout',
      'Jarvis, arrête tout !',
      'arrête tout, Jarvis',
      'Arrête tout tout de suite',
      'Stop, arrête tout',
      'STOP TOUT',
      'Stoppe tout s’il te plaît',
      'Arrêtez tout',
      'Tout arrêter',
      'Coupe tout maintenant',
      'arret total',
    ]) {
      expect(isStopAllPhrase(text), text).toBe(true);
    }
  });

  it('ne prend pas une autre phrase pour un arrêt général', () => {
    for (const text of [
      'Arrête tout de suite la musique',
      'Arrête tout ce bruit',
      'Arrête la musique',
      'stop',
      'Stop la musique',
      'Je veux tout arrêter demain',
      'Tu peux arrêter ?',
      'Arrête',
      '',
      'tout',
    ]) {
      expect(isStopAllPhrase(text), text).toBe(false);
    }
  });

  it('dit qui a reçu l’arrêt et nomme celui qui ne répond pas', () => {
    expect(stopAllSentence([{ name: 'Faux bras', ok: true }, { name: 'Robot', ok: true }])).toBe('Arrêt envoyé : Faux bras et Robot.');
    const mixed = stopAllSentence([{ name: 'Faux bras', ok: true }, { name: 'Robot', ok: false }]);
    expect(mixed).toContain('Arrêt envoyé : Faux bras.');
    expect(mixed).toContain('Pas de réponse de Robot');
    expect(mixed).toContain('bouton d’arrêt d’urgence');
  });
});

describe('appendices : Test seulement, réglages inchangés', () => {
  it('Live n’a pas le champ ; Test réserve le port base + 8', () => {
    expect(LIVE_EDITION.appendices).toBeUndefined();
    expect(TEST_EDITION.appendices).toEqual({ port: TEST_EDITION.portBase + 8 });
    expect(Object.values(TEST_EDITION.ports)).not.toContain(TEST_EDITION.appendices?.port);
  });

  it('parseSettings({}) ne gagne aucune clé pour les appendices', () => {
    const keys = Object.keys(parseSettings({}));
    expect(keys.filter((key) => /appendice/i.test(key))).toEqual([]);
  });
});

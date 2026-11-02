import { describe, expect, it } from 'vitest';
import { toolLabel } from './toolLabels';
import { needsCompletion, requestComposerDraft, setComposerDraftTarget } from './composerDraft';

describe('toolLabel (5.0.64)', () => {
  it('traduit les outils du catalogue', () => {
    expect(toolLabel('web_search')).toBe('Recherche web');
    expect(toolLabel('run_command')).toBe('Commande système');
    expect(toolLabel('google_gmail_send')).toBe('Gmail : envoi d’un mail');
    expect(toolLabel('rover_emergency_stop')).toBe('Robot : arrêt d’urgence');
  });

  it('garde un libellé lisible pour un outil inconnu, jamais vide', () => {
    expect(toolLabel('dev_search_code')).toBe('dev search code');
    expect(toolLabel('')).toBe('outil');
    expect(toolLabel('___')).toBe('outil');
  });
});

describe('composerDraft (5.0.64)', () => {
  it('une demande qui finit par « : » attend un complément', () => {
    expect(needsCompletion('Analyse cette vidéo YouTube : ')).toBe(true);
    expect(needsCompletion('Analyse cette vidéo YouTube :')).toBe(true);
    expect(needsCompletion('Que joue Spotify en ce moment ?')).toBe(false);
  });

  it('livre le texte au composer monté, ou le garde jusqu’à son montage', () => {
    const received: string[] = [];
    setComposerDraftTarget(null);
    requestComposerDraft('Analyse cette vidéo YouTube : ');
    expect(received).toEqual([]);
    setComposerDraftTarget((text) => received.push(text));
    expect(received).toEqual(['Analyse cette vidéo YouTube : ']);
    requestComposerDraft('Autre');
    expect(received).toEqual(['Analyse cette vidéo YouTube : ', 'Autre']);
    setComposerDraftTarget(null);
  });
});

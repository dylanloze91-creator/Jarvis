import { describe, expect, it } from 'vitest';
import { expressTeam } from '../agent/orchestra.js';
import { ORCHESTRA_TEAMS, teamHasTool, type OrchestraTeam } from '../agent/orchestraTeams.js';
import {
  SPEAKER_SCREEN_LINE_MAX_BYTES,
  SPEAKER_SCREEN_TITLE_MAX_BYTES,
  SPEAKER_SCREEN_TOOL,
  looksLikeSpeakerScreenIntent,
  parseSpeakerScreenHeader,
  speakerScreenClear,
  speakerScreenHeader,
  speakerScreenSeconds,
  speakerScreenText,
} from './screen.js';

const bytes = (text: string) => new TextEncoder().encode(text).length;

describe('lecture de l’en-tête, comme la carte (cas de host-tests/display_test.c)', () => {
  it('lit titre, ligne et secondes', () => {
    expect(parseSpeakerScreenHeader('Imprimante|Impression%20termin%C3%A9e|30')).toEqual({
      clear: false,
      title: 'Imprimante',
      line: 'Impression terminée',
      seconds: 30,
    });
  });

  it('titre seul : 20 s, ligne vide', () => {
    expect(parseSpeakerScreenHeader('Minuteur')).toEqual({ clear: false, title: 'Minuteur', line: '', seconds: 20 });
  });

  it('garde une lettre accentuée entière en fin de texte', () => {
    expect(parseSpeakerScreenHeader('Termin%C3%A9|C%27est%20pr%C3%AAt%20%E2%82%AC')).toMatchObject({
      title: 'Terminé',
      line: "C'est prêt €",
    });
  });

  it('borne à 300 s', () => {
    expect(parseSpeakerScreenHeader('A|b|9999')).toMatchObject({ seconds: 300 });
  });

  it('« - » et le vide effacent', () => {
    expect(parseSpeakerScreenHeader('-')).toEqual({ clear: true });
    expect(parseSpeakerScreenHeader('')).toEqual({ clear: true });
  });

  it('refuse l’illisible, le retour à la ligne, l’absence de titre et des secondes fausses', () => {
    expect(parseSpeakerScreenHeader('%ZZ|x')).toBeNull();
    expect(parseSpeakerScreenHeader('a%0Ab|x')).toBeNull();
    expect(parseSpeakerScreenHeader('|ligne')).toBeNull();
    expect(parseSpeakerScreenHeader('A|b|12x')).toBeNull();
  });

  it('coupe sans casser une lettre accentuée (tampon de 6 octets dans le test de la carte)', () => {
    // Avec les tampons réels : 24 « é » (48 octets) dans un titre de 47 octets → 23 « é ».
    const parsed = parseSpeakerScreenHeader('%C3%A9'.repeat(24));
    expect(parsed).toMatchObject({ title: 'é'.repeat(23) });
  });
});

describe('speakerScreenHeader', () => {
  it('encode pour une URL et écrit toujours titre|ligne|secondes', () => {
    expect(speakerScreenHeader({ title: 'Imprimante', line: 'Impression terminée', seconds: 30 })).toBe(
      'Imprimante|Impression%20termin%C3%A9e|30',
    );
    expect(speakerScreenHeader({ title: 'Minuteur' })).toBe('Minuteur||20');
  });

  it('encode | % et + dans le titre et la ligne : la carte relit le même texte', () => {
    const header = speakerScreenHeader({ title: 'A|B 100%', line: '1+1 = 2 | fin', seconds: 45 })!;
    expect(header.split('|')).toHaveLength(3);
    expect(header).not.toMatch(/\+/);
    expect(parseSpeakerScreenHeader(header)).toEqual({ clear: false, title: 'A|B 100%', line: '1+1 = 2 | fin', seconds: 45 });
  });

  it('retire les retours à la ligne et les caractères de contrôle', () => {
    const header = speakerScreenHeader({ title: ' Jarvis\r\n', line: 'Ollama\nne répond\tpas\u0007.' })!;
    expect(header).not.toMatch(/%0[0-9A-F]|%1[0-9A-F]|%7F/i);
    expect(parseSpeakerScreenHeader(header)).toMatchObject({ title: 'Jarvis', line: 'Ollama ne répond pas .' });
  });

  it('coupe proprement : 47 et 95 octets au plus, jamais au milieu d’un accent ou d’un émoji', () => {
    const title = speakerScreenText('é'.repeat(40), SPEAKER_SCREEN_TITLE_MAX_BYTES);
    expect(title).toBe('é'.repeat(23));
    expect(bytes(title)).toBeLessThanOrEqual(SPEAKER_SCREEN_TITLE_MAX_BYTES);
    const line = speakerScreenText(`${'a'.repeat(93)}😀suite`, SPEAKER_SCREEN_LINE_MAX_BYTES);
    expect(line).toBe('a'.repeat(93));
    // Ce que la carte relit est exactement ce qui a été coupé ici : elle n'a plus rien à couper.
    const header = speakerScreenHeader({ title: 'é'.repeat(40), line: 'à'.repeat(80) })!;
    const parsed = parseSpeakerScreenHeader(header);
    expect(parsed).toMatchObject({ title: 'é'.repeat(23), line: 'à'.repeat(47) });
  });

  it('une espace laissée par la coupe est retirée', () => {
    expect(speakerScreenText(`${'a'.repeat(46)} b`, SPEAKER_SCREEN_TITLE_MAX_BYTES)).toBe('a'.repeat(46));
  });

  it('borne la durée : 20 s par défaut, 1 à 300 s', () => {
    expect(speakerScreenSeconds(undefined)).toBe(20);
    expect(speakerScreenSeconds(0)).toBe(20);
    expect(speakerScreenSeconds(-5)).toBe(20);
    expect(speakerScreenSeconds(Number.NaN)).toBe(20);
    expect(speakerScreenSeconds(0.2)).toBe(1);
    expect(speakerScreenSeconds(59.6)).toBe(60);
    expect(speakerScreenSeconds(9999)).toBe(300);
    expect(speakerScreenHeader({ title: 'A', line: 'b', seconds: 9999 })).toBe('A|b|300');
  });

  it('sans titre lisible : rien à envoyer', () => {
    expect(speakerScreenHeader({ title: '  \n ' })).toBeNull();
    expect(speakerScreenHeader({ title: '\ud800' })).toBeNull();
  });

  it('une demi-paire isolée ne fait pas échouer l’encodage', () => {
    expect(speakerScreenHeader({ title: 'A\ud83dB' })).toBe('AB||20');
  });

  it('speakerScreenClear efface', () => {
    expect(speakerScreenClear()).toBe('-');
    expect(parseSpeakerScreenHeader(speakerScreenClear())).toEqual({ clear: true });
  });
});

describe('demande d’affichage sur une enceinte (règle, sans modèle)', () => {
  const ALL = new Set<OrchestraTeam>(ORCHESTRA_TEAMS);

  it('reconnaît « affiche … sur l’enceinte », pas la musique ni une phrase ordinaire', () => {
    for (const text of [
      'Affiche « Dîner prêt » sur l’enceinte de la chambre',
      'Jarvis, écris à table sur les enceintes',
      'Montre-moi le minuteur sur l’enceinte',
    ]) {
      expect(looksLikeSpeakerScreenIntent(text), text).toBe(true);
    }
    for (const text of ['Mets du jazz sur l’enceinte', 'Affiche la météo', 'Quelle enceinte est reliée ?', 'Monte le son de l’enceinte']) {
      expect(looksLikeSpeakerScreenIntent(text), text).toBe(false);
    }
  });

  it('va à l’équipe PC seulement si une enceinte est reliée ; sinon le chemin d’avant', () => {
    const text = 'Affiche « Dîner prêt » sur l’enceinte de la chambre';
    const before = expressTeam({ text, history: [], available: ALL });
    expect(expressTeam({ text, history: [], available: ALL, speakerScreen: false })).toBe(before);
    expect(expressTeam({ text, history: [], available: ALL, speakerScreen: true })).toBe('pc');
    // Une autre phrase ne change pas de chemin parce qu'une enceinte est reliée.
    for (const other of ['Mets du jazz sur l’enceinte', 'Ouvre le Bloc-notes', 'Quelle heure est-il ?']) {
      expect(expressTeam({ text: other, history: [], available: ALL, speakerScreen: true }), other).toBe(
        expressTeam({ text: other, history: [], available: ALL }),
      );
    }
  });

  it('l’outil appartient à l’équipe PC, et à elle seule', () => {
    expect(SPEAKER_SCREEN_TOOL).toBe('afficher_sur_enceinte');
    expect(ORCHESTRA_TEAMS.filter((team) => teamHasTool(team, SPEAKER_SCREEN_TOOL))).toEqual(['pc']);
  });
});

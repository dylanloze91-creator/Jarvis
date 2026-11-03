import { describe, expect, it } from 'vitest';
import { defaultSettings, parseSettings } from '../settings.js';
import { applyMachineProfile, type ProfileDecision } from '../machine/profile.js';
import {
  DEFAULT_PERSONA,
  activePersona,
  dayPeriod,
  personaGreeting,
  personaPrompt,
  userFirstName,
  withPersonaPrompt,
} from './persona.js';

const NOON = new Date('2026-11-03T12:00:00+01:00');
const NIGHT = new Date('2026-11-03T02:30:00+01:00');
const TZ = 'Europe/Paris';

describe('caractère de Jarvis — réglage', () => {
  it('absent ou coupé : aucun caractère, les défauts figés ne gagnent pas de clé', () => {
    expect('persona' in parseSettings({})).toBe(false);
    expect(activePersona(parseSettings({}))).toBeNull();
    expect(activePersona(parseSettings({ persona: { enabled: false } }))).toBeNull();
    expect(withPersonaPrompt('BASE', null, { now: NOON })).toBe('BASE');
  });

  it('activé : style et humour avec leurs défauts, style inconnu remis à « complice »', () => {
    expect(activePersona(parseSettings({ persona: { enabled: true } }))).toEqual(DEFAULT_PERSONA);
    expect(activePersona(parseSettings({ persona: { enabled: true, style: 'direct', humour: false } }))).toEqual({
      enabled: true,
      style: 'direct',
      humour: false,
    });
    expect(activePersona({ persona: { enabled: true, style: 'pirate' as never } })?.style).toBe('complice');
  });

  it('un style inconnu dans settings.json ne fait pas perdre le reste des réglages', () => {
    const settings = parseSettings({ hotkey: 'Alt+J', persona: { enabled: true, style: 'pirate' } });
    expect(settings.hotkey).toBe('Alt+J');
  });

  it('le profil matériel ne touche pas au caractère (prompts du premier lancement figés)', () => {
    const decision: ProfileDecision = {
      profile: 'standard',
      cpuOnly: false,
      measureFailed: false,
      detected: 'x',
      chosen: 'y',
      chatModel: 'qwen2.5:3b',
    };
    expect('persona' in applyMachineProfile(defaultSettings, decision)).toBe(false);
    const on = parseSettings({ persona: { enabled: true, style: 'direct' } });
    expect(applyMachineProfile(on, decision).persona).toEqual({ enabled: true, style: 'direct', humour: true });
  });
});

describe('caractère de Jarvis — fiche de personnage', () => {
  it('contient le caractère, l’honnêteté sur ce qu’il est, et garde les règles d’action', () => {
    const text = personaPrompt(DEFAULT_PERSONA, { now: NOON, userName: 'Dylan', timeZone: TZ });
    expect(text).toMatch(/^CARACTÈRE DE JARVIS\./);
    expect(text).toContain('tu as un caractère');
    expect(text).toContain('un programme qui tourne sur ce PC');
    expect(text).toContain('les outils restent le seul moyen d’agir');
    expect(text).toContain('s’appelle Dylan');
    expect(text).toContain('après-midi');
    expect(text).toContain('Humour : sec, rare');
  });

  it('style, humour, prénom inconnu et origine vocale changent la fiche', () => {
    const butler = personaPrompt({ enabled: true, style: 'majordome', humour: false }, { now: NIGHT, timeZone: TZ, source: 'voice' });
    expect(butler).toContain('Tu vouvoies');
    expect(butler).toContain('Pas de plaisanterie');
    expect(butler).toContain('nuit');
    expect(butler).toContain('tu peux le lui demander une fois');
    expect(butler).toContain('lue à voix haute');
    const direct = personaPrompt({ enabled: true, style: 'direct', humour: true }, { now: NOON, timeZone: TZ, source: 'text' });
    expect(direct).toContain('Ton : direct');
    expect(direct).not.toContain('lue à voix haute');
  });

  it('withPersonaPrompt place la fiche après la consigne de base', () => {
    const text = withPersonaPrompt('BASE', DEFAULT_PERSONA, { now: NOON, timeZone: TZ });
    expect(text.startsWith('BASE\n\nCARACTÈRE DE JARVIS.')).toBe(true);
  });
});

describe('caractère de Jarvis — accueil et prénom', () => {
  it('moment de la journée dans le fuseau du PC', () => {
    expect(dayPeriod(new Date('2026-11-03T07:00:00+01:00'), TZ)).toBe('matin');
    expect(dayPeriod(NOON, TZ)).toBe('après-midi');
    expect(dayPeriod(new Date('2026-11-03T20:00:00+01:00'), TZ)).toBe('soir');
    expect(dayPeriod(NIGHT, TZ)).toBe('nuit');
  });

  it('accueil selon le ton, l’heure et le prénom', () => {
    expect(personaGreeting(DEFAULT_PERSONA, { now: NOON, userName: 'Dylan', timeZone: TZ })).toBe('Bonjour Dylan. Je t’écoute.');
    expect(personaGreeting(DEFAULT_PERSONA, { now: NIGHT, timeZone: TZ })).toBe('Bonsoir. Tu ne dors pas ? Je suis là.');
    expect(personaGreeting({ ...DEFAULT_PERSONA, style: 'majordome' }, { now: NOON, userName: 'Dylan', timeZone: TZ })).toBe(
      'Bonjour Dylan. À votre service.',
    );
    expect(personaGreeting({ ...DEFAULT_PERSONA, style: 'direct' }, { now: NIGHT, timeZone: TZ })).toBe('Bonsoir. Je t’écoute.');
  });

  it('prénom tiré de la personnalisation, premier mot seulement', () => {
    expect(userFirstName({ prenom: 'Dylan' })).toBe('Dylan');
    expect(userFirstName({ prénom: ' Marie Claire ' })).toBe('Marie');
    expect(userFirstName({ name: 'Paul Martin' })).toBe('Paul');
    expect(userFirstName({ 'Prénom de l’utilisateur': 'Léa' })).toBe('Léa');
    expect(userFirstName({ ton: 'direct' })).toBeNull();
    expect(userFirstName(undefined)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings.js';
import { DEFAULT_SITEBLOCK_BASE_URL } from './siteblock/url.js';

describe('parseSettings', () => {
  it('reste ouverte au clic ailleurs par défaut', () => {
    expect(parseSettings({}).stayVisibleOnBlur).toBe(true);
  });

  it('ignore l’ancien hideOnBlur:true des installations 0.4.0', () => {
    expect(parseSettings({ hideOnBlur: true }).stayVisibleOnBlur).toBe(true);
  });

  it('conserve un choix explicite de masquer au focus perdu', () => {
    expect(parseSettings({ stayVisibleOnBlur: false }).stayVisibleOnBlur).toBe(false);
  });

  it('rend le mot de réveil plus sensible par défaut', () => {
    expect(parseSettings({}).voice.wakeWordSensitivity).toBe(0.7);
  });

  it('ignore les anciens réglages voix retirés sans toucher au reste', () => {
    const parsed = parseSettings({
      provider: 'ollama',
      model: 'qwen2.5:3b',
      voice: {
        enabled: true,
        wakeWordEngine: 'porcupine',
        wakeWordAccessKey: 'clé-picovoice',
        sttModel: 'small',
        wakeWordSensitivity: 0.4,
      },
    });
    expect(parsed.provider).toBe('ollama');
    expect(parsed.model).toBe('qwen2.5:3b');
    expect(parsed.voice.enabled).toBe(true);
    expect(parsed.voice.wakeWordSensitivity).toBe(0.4);
    expect(parsed.voice).not.toHaveProperty('wakeWordEngine');
    expect(parsed.voice).not.toHaveProperty('wakeWordAccessKey');
    expect(parsed.voice).not.toHaveProperty('sttModel');
  });

  it('garde le gabarit d’énergie vide tant qu’on n’a rien importé (repli seulement)', () => {
    expect(parseSettings({}).voice.wakeWordProfiles).toEqual([]);
  });

  it('prend Google sans clé comme moteur de recherche par défaut', () => {
    expect(parseSettings({}).searchProvider).toBe('google');
    expect(parseSettings({}).searchApiKey).toBe('');
    expect(parseSettings({ searchProvider: 'wikipedia' }).searchProvider).toBe('wikipedia');
  });

  it('ne perd pas les clés quand un seul champ est invalide', () => {
    const parsed = parseSettings({
      provider: 'openai',
      model: '',
      apiKey: 'sk-local',
      hotkey: '',
      spotifyClientId: 'client',
      voice: { enabled: true, wakeWord: '' },
    });
    expect(parsed.provider).toBe('openai');
    expect(parsed.apiKey).toBe('sk-local');
    expect(parsed.spotifyClientId).toBe('client');
    expect(parsed.model).toBe('jarvis-demo');
    expect(parsed.hotkey).toBe('Control+Space');
    expect(parsed.voice.enabled).toBe(true);
    expect(parsed.voice.wakeWord).toBe('jarvis');
  });

  it('reprend la valeur précédente d’un champ vidé à l’enregistrement', () => {
    const previous = parseSettings({ provider: 'ollama', model: 'qwen2.5:3b', apiKey: 'k' });
    const next = parseSettings({ ...previous, model: '', temperature: 9 }, previous);
    expect(next.provider).toBe('ollama');
    expect(next.model).toBe('qwen2.5:3b');
    expect(next.temperature).toBe(previous.temperature);
    expect(next.apiKey).toBe('k');
  });

  it('place l’URL et le jeton SiteBlock dans les réglages, pas dans l’environnement', () => {
    const defaults = parseSettings({});
    expect(defaults.siteBlockBaseUrl).toBe(DEFAULT_SITEBLOCK_BASE_URL);
    expect(defaults.siteBlockToken).toBe('');
    expect(
      parseSettings({ siteBlockBaseUrl: 'http://127.0.0.1:19001', siteBlockToken: 'abc' }),
    ).toMatchObject({
      siteBlockBaseUrl: 'http://127.0.0.1:19001',
      siteBlockToken: 'abc',
    });
  });
});

describe('réglages Jarvis Développeur', () => {
  it('coupé par défaut, sans copie de travail choisie', () => {
    expect(parseSettings({}).developer).toEqual({
      enabled: false,
      repoPath: '',
      codeModel: '',
      worktreeRoot: '',
    });
  });

  it('un bloc developer de 0.4.23 (sans modèle de code) se lit sans rien perdre', () => {
    const parsed = parseSettings({ developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis' } });
    expect(parsed.developer).toEqual({
      enabled: true,
      repoPath: 'C:\\dev\\Jarvis',
      codeModel: '',
      worktreeRoot: '',
    });
  });

  it('un settings.json de 0.4.22 (sans bloc developer) se lit sans rien perdre', () => {
    const old = {
      provider: 'ollama',
      model: 'qwen2.5:3b',
      searchApiKey: 'tvly-x',
      voice: { enabled: true },
    };
    const parsed = parseSettings(old);
    expect(parsed.developer.enabled).toBe(false);
    expect(parsed).toMatchObject({
      provider: 'ollama',
      model: 'qwen2.5:3b',
      searchApiKey: 'tvly-x',
    });
    expect(parsed.voice.enabled).toBe(true);
  });

  it('un bloc developer invalide reprend le précédent sans toucher au reste', () => {
    const previous = parseSettings({
      apiKey: 'sk-garde',
      developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis' },
    });
    const parsed = parseSettings(
      { ...previous, developer: { enabled: 'oui', repoPath: 42 } },
      previous,
    );
    expect(parsed.developer).toEqual({
      enabled: true,
      repoPath: 'C:\\dev\\Jarvis',
      codeModel: '',
      worktreeRoot: '',
    });
    expect(parsed.apiKey).toBe('sk-garde');
  });
});

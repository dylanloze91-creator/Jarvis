import { describe, expect, it } from 'vitest';
import { parseSettings } from '@jarvis/core';
import { absorbSavedSettings, settingsPatch } from './settingsPatch';

describe('settingsPatch (5.0.64)', () => {
  it('ne renvoie que les clés modifiées par le brouillon', () => {
    const base = parseSettings({ hotkey: 'Control+Space', model: 'qwen2.5:3b' });
    const draft = { ...base, model: 'qwen3.5:4b', voice: { ...base.voice, enabled: true } };
    expect(settingsPatch(base, draft)).toEqual({ model: 'qwen3.5:4b', voice: draft.voice });
  });

  it('un bloc écrit entre-temps par le processus principal n’est pas renvoyé', () => {
    const base = parseSettings({});
    const draft = { ...base, hotkey: 'Alt+J' };
    const patch = settingsPatch(base, draft);
    expect(Object.keys(patch)).toEqual(['hotkey']);
    expect('localLearning' in patch).toBe(false);
  });

  it('brouillon identique = aucune clé', () => {
    const base = parseSettings({});
    expect(settingsPatch(base, { ...base })).toEqual({});
  });
});

describe('brouillon gardé puis réglage changé ailleurs (revue 5.0.64, point 1)', () => {
  it('« Enregistrer » ne renvoie pas l’ancienne valeur d’un réglage fait ailleurs', () => {
    // 1. Le brouillon part d'un instantané et change seulement le raccourci.
    const base = parseSettings({});
    let state = { base, draft: { ...base, hotkey: 'Alt+J' } };

    // 2. Pendant que le brouillon attend : Développeur activé, politique « fichiers »
    //    assouplie, modèle adopté par l'apprentissage local (écrits hors du panneau).
    const saved = parseSettings({
      developer: { ...base.developer, enabled: true },
      toolPolicies: { ...base.toolPolicies, files: 'destructive-only' },
      localLearning: { ...base.localLearning, activeOllamaModel: 'jarvis-appris:latest' },
    });
    state = absorbSavedSettings(state, saved);

    // 3. Le brouillon garde le raccourci de l'utilisateur et prend les réglages faits ailleurs.
    expect(state.draft.hotkey).toBe('Alt+J');
    expect(state.draft.developer.enabled).toBe(true);
    expect(state.draft.toolPolicies.files).toBe('destructive-only');
    expect(state.draft.localLearning.activeOllamaModel).toBe('jarvis-appris:latest');

    // 4. « Enregistrer » n'envoie que le raccourci : rien n'est défait.
    const patch = settingsPatch(state.base, state.draft);
    expect(patch).toEqual({ hotkey: 'Alt+J' });
    const merged = parseSettings({ ...saved, ...patch });
    expect(merged.developer.enabled).toBe(true);
    expect(merged.toolPolicies.files).toBe('destructive-only');
    expect(merged.localLearning.activeOllamaModel).toBe('jarvis-appris:latest');
  });

  it('comparer aux réglages courants au lieu de l’instantané défaisait le réglage (le bogue)', () => {
    const base = parseSettings({});
    const draft = { ...base, hotkey: 'Alt+J' };
    const saved = parseSettings({ developer: { ...base.developer, enabled: true } });
    // Ancien calcul : le brouillon (Développeur coupé) comparé aux réglages courants (activé)
    // renvoyait `developer` et le remettait à « coupé ».
    expect(Object.keys(settingsPatch(saved, draft))).toContain('developer');
    // Nouveau calcul : seul le raccourci part.
    expect(settingsPatch(absorbSavedSettings({ base, draft }, saved).base, absorbSavedSettings({ base, draft }, saved).draft)).toEqual({
      hotkey: 'Alt+J',
    });
  });

  it('une clé modifiée par l’utilisateur garde sa valeur même si elle a aussi changé ailleurs', () => {
    const base = parseSettings({});
    const draft = { ...base, model: 'qwen3.5:4b' };
    const saved = parseSettings({ model: 'qwen2.5:7b', hotkey: 'Alt+K' });
    const state = absorbSavedSettings({ base, draft }, saved);
    expect(state.draft.model).toBe('qwen3.5:4b');
    expect(state.draft.hotkey).toBe('Alt+K');
    expect(settingsPatch(state.base, state.draft)).toEqual({ model: 'qwen3.5:4b' });
  });
});

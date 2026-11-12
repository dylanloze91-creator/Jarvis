import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSettings } from '../settings.js';
import { RoutineBook, handleRoutinePhrase, routineAction, routinesFilePath, runRoutineSteps } from './routines.js';

const PHRASE = 'crée une routine Travail : ouvre Chrome, mets ma playlist Focus, bloque les réseaux sociaux 2 heures';

describe('routines', () => {
  it('parseSettings({}) ne gagne pas la clé routines', () => {
    expect(parseSettings({})).not.toHaveProperty('routines');
  });

  it('découpe la phrase en trois outils, sans commande libre', () => {
    const action = routineAction(PHRASE, []);
    expect(action?.kind).toBe('create');
    if (action?.kind !== 'create') return;
    expect(action.name).toBe('Travail');
    expect(action.steps.map((step) => step.tool)).toEqual([
      'open_application',
      'spotify_play',
      'siteblock_start_focus',
    ]);
    expect(action.steps[2]?.args.minutes).toBe(120);
    expect(action.steps.every((step) => !step.dependsOnPrevious)).toBe(true);
    expect(routineAction('crée une routine Sale : run_command dir', [])?.kind).toBe('refused');
  });

  it('la carte refusée n’enregistre rien ; « C’est bon » enregistre', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jarvis-routines-'));
    const book = new RoutineBook(() => routinesFilePath(root));
    const refused = await handleRoutinePhrase(book, PHRASE, {
      confirm: async () => false,
      run: async () => ({ ok: true, content: '' }),
    });
    expect(refused).toMatch(/Rien n'a été enregistré/);
    expect(await book.list()).toEqual([]);
    const later = await handleRoutinePhrase(book, "C'est bon", {
      confirm: async () => false,
      run: async () => ({ ok: true, content: '' }),
    });
    expect(later).toBeNull();
    const action = routineAction(PHRASE, []);
    if (action?.kind !== 'create') throw new Error('découpage');
    await book.stage(action.name, action.steps);
    const saved = await handleRoutinePhrase(book, "C'est bon", {
      confirm: async () => false,
      run: async () => ({ ok: true, content: '' }),
    });
    expect(saved).toMatch(/enregistré : Travail/);
    expect(await book.names()).toEqual(['Travail']);
  });

  it('une étape ratée est dite et la suivante continue, sauf si elle en dépend', async () => {
    const text = await runRoutineSteps(
      [
        { label: 'ouvrir Chrome', tool: 'open_application', args: { name: 'Chrome' }, dependsOnPrevious: false },
        { label: 'playlist Focus', tool: 'spotify_play', args: { query: 'Focus' }, dependsOnPrevious: false },
        { label: 'briefing', tool: 'briefing', args: {}, dependsOnPrevious: true },
      ],
      async (step) => (step.tool === 'spotify_play' ? { ok: false, content: 'Spotify muet' } : { ok: true, content: 'ok' }),
    );
    expect(text).toContain('ouvrir Chrome faite');
    expect(text).toContain('playlist Focus ratée');
    expect(text).toContain('briefing passée');
  });

  it('« mode travail » ne part que si la routine existe', () => {
    expect(routineAction('mode travail', [])).toBeNull();
    expect(routineAction('mode travail', ['Travail'])?.kind).toBe('launch');
  });
});

import { describe, expect, it } from 'vitest';
import { LIVE_EDITION, TEST_EDITION } from '../edition.js';
import { parseSettings } from '../settings.js';
import {
  WARM_KEEP_ALIVE,
  mostUsedTeam,
  orchestraWarmTargets,
  warmLoadRequest,
  warmTargetsToRefresh,
} from './chauds.js';

const ORCHESTRA = {
  enabled: true,
  brain: 'modele-cerveau',
  teams: {
    musique: { model: 'modele-petit', place: 'processeur' as const },
    web: { model: 'modele-web', place: 'carte' as const },
  },
};

describe('modèles gardés chauds', () => {
  it('réservé à Jarvis Test : la table de Live ne gagne aucun champ', () => {
    expect(TEST_EDITION.keepModelsWarm).toBe(true);
    expect('keepModelsWarm' in LIVE_EDITION).toBe(false);
  });

  it('orchestre coupé, absent, ou fournisseur autre qu’Ollama : rien à préchauffer', () => {
    expect(orchestraWarmTargets(parseSettings({}))).toEqual([]);
    expect(orchestraWarmTargets({ provider: 'ollama', orchestra: { ...ORCHESTRA, enabled: false } })).toEqual([]);
    expect(orchestraWarmTargets({ provider: 'openai', orchestra: ORCHESTRA })).toEqual([]);
  });

  it('le cerveau, puis l’équipe la plus utilisée ; un même modèle n’est chargé qu’une fois', () => {
    // Sans usage connu : Conversation, qui n'a pas de modèle à elle et prend donc le cerveau.
    expect(orchestraWarmTargets({ provider: 'ollama', orchestra: ORCHESTRA })).toEqual([
      { model: 'modele-cerveau', place: 'carte', role: 'cerveau' },
    ]);
    expect(orchestraWarmTargets({ provider: 'ollama', orchestra: ORCHESTRA }, 'musique')).toEqual([
      { model: 'modele-cerveau', place: 'carte', role: 'cerveau' },
      { model: 'modele-petit', place: 'processeur', role: 'equipe' },
    ]);
    expect(orchestraWarmTargets({ provider: 'ollama', orchestra: ORCHESTRA }, 'web')).toEqual([
      { model: 'modele-cerveau', place: 'carte', role: 'cerveau' },
      { model: 'modele-web', place: 'carte', role: 'equipe' },
    ]);
  });

  it('un trieur réglé est préchauffé en premier, avant le cerveau', () => {
    const targets = orchestraWarmTargets({
      provider: 'ollama',
      orchestra: { ...ORCHESTRA, router: { model: 'modele-trieur', place: 'processeur' } },
    });
    expect(targets.map((target) => [target.model, target.role])).toEqual([
      ['modele-trieur', 'trieur'],
      ['modele-cerveau', 'cerveau'],
    ]);
  });

  it('la requête de chargement ne génère rien et porte les options des vraies demandes', () => {
    expect(warmLoadRequest({ model: 'm', place: 'carte', role: 'cerveau' })).toEqual({
      model: 'm',
      prompt: '',
      stream: false,
      keep_alive: WARM_KEEP_ALIVE,
      options: { num_ctx: 8192 },
    });
    expect(warmLoadRequest({ model: 'm', place: 'processeur', role: 'equipe' }).options).toEqual({ num_ctx: 8192, num_gpu: 0 });
  });

  it('prolonger : seulement ce qui est encore chargé, jamais un modèle déchargé exprès', () => {
    const targets = orchestraWarmTargets({ provider: 'ollama', orchestra: ORCHESTRA }, 'musique');
    expect(warmTargetsToRefresh(targets, [])).toEqual([]);
    expect(warmTargetsToRefresh(targets, ['autre-modele:latest'])).toEqual([]);
    expect(warmTargetsToRefresh(targets, ['modele-petit:latest']).map((target) => target.model)).toEqual(['modele-petit']);
    expect(warmTargetsToRefresh(targets, ['MODELE-CERVEAU', 'modele-petit']).map((target) => target.model)).toEqual([
      'modele-cerveau',
      'modele-petit',
    ]);
    // Une autre étiquette du même nom n'est pas le même modèle.
    expect(warmTargetsToRefresh([{ model: 'qwen:7b', place: 'carte', role: 'cerveau' }], ['qwen:3b'])).toEqual([]);
  });

  it('équipe la plus utilisée : seuls les tours où un modèle a répondu comptent', () => {
    expect(mostUsedTeam([])).toBeNull();
    expect(
      mostUsedTeam([
        { team: 'horloge', model: null },
        { team: 'horloge', model: null },
        { team: 'web', model: 'm' },
        { team: 'pc', model: 'm' },
        { team: 'pc', model: 'm' },
        { team: 'equipe-inconnue', model: 'm' },
        { team: null, model: 'm' },
      ]),
    ).toBe('pc');
  });
});

import { describe, expect, it } from 'vitest';
import {
  assessMission,
  coderVerdict,
  estimateDifficulty,
  modelCapability,
  modelParamsB,
} from './difficulty.js';
import { scoreRoles, type RealBenchResult, type RealBenchTaskResult } from './realBench.js';

function bench(model: string, coder: Array<boolean | null>): RealBenchResult {
  const tasks: RealBenchTaskResult[] = coder.map((ok, i) => ({
    id: `t${i}`,
    label: `t${i}`,
    roles: ['CODER'],
    ok,
    detail: '',
    durationMs: 0,
    outputTokPerSec: null,
    calls: 0,
  }));
  return {
    model,
    startedAt: 0,
    finishedAt: 0,
    commit: null,
    tasks,
    roles: scoreRoles(tasks),
    metrics: {
      outputTokPerSec: null,
      promptTokPerSec: null,
      loadMs: null,
      sizeBytes: null,
      sizeVramBytes: null,
      gpuUsedMiB: null,
      ramUsedBytes: null,
    },
  };
}

describe('difficulté d’une mission (5.0.1)', () => {
  it('un Pong (gabarit prêt) avec une règle de plus : changement ciblé', () => {
    const pong = estimateDifficulty(
      'new-project',
      'Crée un Pong jouable dans le navigateur et change une seule règle : la balle accélère un peu à chaque renvoi de raquette.',
    );
    expect(pong).toMatchObject({ level: 1, template: 'web-game' });
    expect(pong.reasons[0]).toMatch(/déjà un Pong jouable/);
    expect(
      estimateDifficulty(
        'new-project',
        'Crée un Pong jouable dans le navigateur : deux raquettes, une balle, le score, au clavier (W/S pour la gauche, flèches pour la droite).',
      ).level,
    ).toBe(1);
  });

  it('un autre jeu entier, ou des fonctions lourdes : programme entier', () => {
    const tetris = estimateDifficulty(
      'new-project',
      'Crée un Tetris complet dans le navigateur avec niveaux, score, sauvegarde des meilleurs scores et musique.',
    );
    expect(tetris).toMatchObject({ level: 3, template: 'web-game' });
    expect(tetris.reasons.join(' ')).toMatch(/« Tetris » est un autre jeu entier/);
    expect(
      estimateDifficulty('modify', 'Réécris tout le projet en Rust avec une base de données').level,
    ).toBe(3);
  });

  it('modifications : une commande = ciblé, un écran = fonction nouvelle', () => {
    expect(estimateDifficulty('modify', 'Ajoute une option --version à la commande').level).toBe(1);
    expect(estimateDifficulty('fix', 'La balle traverse la raquette droite').level).toBe(1);
    expect(estimateDifficulty('modify', 'Ajoute un écran de réglages pour la vitesse').level).toBe(
      2,
    );
    const proposal =
      'Exporter une constante VERSION. Preuves : src/index.ts : « export » ; mesure x. Gain attendu : clarté, moins d’erreurs. Risque : faible. Tests de preuve : npm test ; typecheck.';
    expect(estimateDifficulty('modify', proposal).level).toBe(1);
    expect(
      estimateDifficulty('new-project', 'Crée une petite CLI qui renomme des photos').level,
    ).toBe(2);
  });
});

describe('capacité du modèle CODER (5.0.1)', () => {
  it('taille lue dans Ollama ou dans le nom', () => {
    expect(modelParamsB('qwen2.5:3b', '3.1B')).toBe(3.1);
    expect(modelParamsB('qwen3.5:4b')).toBe(4);
    expect(modelParamsB('tiny', '494.03M')).toBeCloseTo(0.494);
    expect(modelParamsB('mon-modele')).toBeNull();
  });

  it('banc réel CODER d’abord, plafonné par la taille ; sinon la taille seule', () => {
    expect(modelCapability('qwen3.5:4b', bench('qwen3.5:4b', [true, true, false]))).toMatchObject({
      level: 2,
      source: 'banc',
      coder: { passed: 2, measured: 3 },
    });
    expect(modelCapability('qwen3.5:4b', bench('qwen3.5:4b', [true, true, true])).level).toBe(2);
    expect(modelCapability('qwen2.5-coder:14b', bench('x', [true, true, true])).level).toBe(3);
    expect(modelCapability('qwen2.5:3b', bench('x', [true, false, false])).level).toBe(1);
    const none = modelCapability('qwen2.5:3b', bench('x', [false, false, null]));
    expect(none.level).toBe(0);
    expect(coderVerdict(none)).toMatch(/pas apte au rôle CODER/);
    expect(modelCapability('qwen2.5:3b', undefined, '3.1B')).toMatchObject({
      level: 2,
      source: 'taille',
    });
    expect(modelCapability('qwen2.5:0.5b', undefined, '494M').level).toBe(1);
    expect(modelCapability('sans-taille', undefined).level).toBe(2);
    expect(modelCapability('qwen2.5-coder:32b', undefined).level).toBe(3);
  });
});

describe('contrôle avant la mission (5.0.1)', () => {
  const small = modelCapability('qwen2.5:3b', bench('qwen2.5:3b', [true, false, false]));

  it('trop grand : refus clair et version ciblée proposée', () => {
    const gate = assessMission(
      'new-project',
      'Crée un Tetris complet dans le navigateur avec niveaux, score, sauvegarde des meilleurs scores et musique.',
      small,
    );
    expect(gate.ok).toBe(false);
    expect(gate.message).toMatch(/^Mission non lancée : trop grande pour qwen2\.5:3b/);
    expect(gate.message).toMatch(/banc réel CODER 1\/3/);
    expect(gate.suggestion).toMatch(/^Crée un Pong jouable/);
    expect(assessMission('new-project', gate.suggestion!, small).ok).toBe(true);
  });

  it('une demande à plusieurs morceaux : la première seule', () => {
    const gate = assessMission(
      'modify',
      'Ajoute une option --version, un écran de réglages, une sauvegarde des préférences et un menu',
      small,
    );
    expect(gate.ok).toBe(false);
    expect(gate.suggestion).toBe('Ajoute une option --version.');
  });

  it('modèle à 0 au banc CODER : aucune mission de code, sans proposition', () => {
    const none = modelCapability('nul:1b', bench('nul:1b', [false, false, false]));
    const gate = assessMission('fix', 'Corrige la vitesse', none);
    expect(gate.ok).toBe(false);
    expect(gate.suggestion).toBeNull();
    expect(gate.message).toMatch(/aucune tâche de code au banc réel/);
  });

  it('à sa mesure : lancée, avec la difficulté estimée', () => {
    const gate = assessMission('modify', 'Change la vitesse de la balle à 300', small);
    expect(gate.ok).toBe(true);
    expect(gate.message).toMatch(/^Difficulté estimée : changement ciblé/);
  });
});

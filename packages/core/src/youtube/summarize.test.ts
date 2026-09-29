import { describe, expect, it } from 'vitest';
import { OLLAMA_DEFAULT_MODEL } from '../providers/ollama.js';
import { FINANCE_DISCLAIMER } from './domain.js';
import { dropSentencesWithInventedNumbers } from './numbers.js';
import { resolveLocalSummaryModel } from './localModel.js';
import { condenseTranscript } from './summarize.js';

describe('fusion du condensé', () => {
  it('interroge chaque partie puis une fusion, et retire un chiffre inventé', async () => {
    const sentence = 'Le CAC est à 7200 points selon la séance. Un nom : Dupont. ';
    const transcript = sentence.repeat(12);
    const prompts: string[] = [];

    const condensed = await condenseTranscript({
      transcript,
      chunkChars: 120,
      complete: async (system, user) => {
        prompts.push(`${system}\n${user}`);
        if (user.includes('Rédige UN condensé')) {
          return 'Le CAC est à 7200 points. Dupont parle du marché. Objectif cité : 9000.';
        }
        return 'Le CAC est à 7200 points. Dupont est cité.';
      },
    });

    const chunkCalls = prompts.filter((prompt) => prompt.includes('Relève uniquement'));
    const mergeCalls = prompts.filter((prompt) => prompt.includes('Rédige UN condensé'));
    expect(chunkCalls.length).toBeGreaterThan(1);
    expect(mergeCalls).toHaveLength(1);
    expect(mergeCalls[0]).toContain('7200');
    expect(condensed).toContain('7200');
    expect(condensed).not.toContain('9000');
    expect(prompts[0]).toMatch(/N'invente aucun chiffre/);
  });

  it('retire la phrase dont le nombre n’a pas été dit', () => {
    const source = 'Le CAC est à 7 200 points, soit 1,5 %.';
    const summary = 'Le CAC est à 7200 points. La variation est de 1,5 %. Objectif 9000.';
    expect(dropSentencesWithInventedNumbers(summary, source)).toBe(
      'Le CAC est à 7200 points. La variation est de 1,5 %.',
    );
  });

  it('garde le paragraphe et la liste de points sur des lignes séparées', () => {
    const source = 'Le CAC est à 7 200 points. Dupont parle du marché.';
    const summary = [
      'Le marché est calme.',
      '',
      '- Le CAC est à 7200 points.',
      '- Objectif 9000.',
      '- Dupont parle du marché.',
    ].join('\n');
    expect(dropSentencesWithInventedNumbers(summary, source)).toBe(
      ['Le marché est calme.', '', '- Le CAC est à 7200 points.', '- Dupont parle du marché.'].join(
        '\n',
      ),
    );
  });

  it('ne colle pas deux nombres voisins en un seul', () => {
    const source = 'En 2024 12 entreprises ont fermé.';
    expect(dropSentencesWithInventedNumbers('En 2024, 12 entreprises ont fermé.', source)).toBe(
      'En 2024, 12 entreprises ont fermé.',
    );
  });

  it('ignore les horodatages et retire quand même un chiffre inventé', () => {
    const source = '[0:30 → 1:00] Le CAC est à 7200 points.';
    const summary = 'À 1:00, le CAC est à 7200 points. Objectif 9000.';
    expect(dropSentencesWithInventedNumbers(summary, source)).toBe('À 1:00, le CAC est à 7200 points.');
  });

  it('classe les notes par importance avant la fusion', async () => {
    const prompts: string[] = [];
    const low = 'Le passage faible reste calme et sans nombre. '.repeat(6);
    const high = 'Le passage fort reste calme et sans nombre. '.repeat(6);

    await condenseTranscript({
      transcript: `${low}${high}`,
      chunkChars: low.length,
      complete: async (_system, user) => {
        if (user.includes('Rédige UN condensé')) {
          prompts.push(user);
          return 'Rien de chiffré.';
        }
        if (user.includes('passage faible')) return 'Importance : 12\nPassage faible.';
        return 'Importance : 90\nPassage fort.';
      },
    });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.indexOf('Importance : 90')).toBeGreaterThan(-1);
    expect(prompts[0]?.indexOf('Importance : 90')).toBeLessThan(prompts[0]?.indexOf('Importance : 12') ?? -1);
  });

  it('reconnaît une vidéo finance et garde l’avertissement', async () => {
    const prompts: string[] = [];
    const condensed = await condenseTranscript({
      transcript:
        'La bourse, les actions, le dividende et un ETF du CAC 40. Le rendement suit l’inflation.',
      complete: async (system, user) => {
        prompts.push(`${system}\n${user}`);
        return 'Le dividende est discuté, sans nouvel objectif.';
      },
    });

    expect(prompts[0]).toMatch(/Cette vidéo parle de finance/);
    expect(prompts[0]).toMatch(/N'invente aucun chiffre/);
    expect(condensed).toContain(FINANCE_DISCLAIMER);
    expect(condensed).toContain('dividende');
  });

  it('lit un JSON de segment sans en faire un chiffre autorisé', async () => {
    const condensed = await condenseTranscript({
      transcript: 'Le CAC est à 7200 points.',
      complete: async (_system, user) => {
        if (user.includes('Rédige UN condensé')) {
          return '{"executiveSummary":"Le CAC est à 7200 points.","numbers":["9000"]}';
        }
        return '{"importance":95,"summary":"Le CAC est à 7200 points.","numbers":["7200"]}';
      },
    });

    expect(condensed).toContain('7200');
    expect(condensed).not.toContain('9000');
    expect(condensed).not.toContain('95');
  });
});

describe('modèle local du condensé', () => {
  it('reste sur qwen2.5:3b tant que le chat n’est pas réglé sur Ollama', () => {
    expect(OLLAMA_DEFAULT_MODEL).toBe('qwen2.5:3b');
    expect(
      resolveLocalSummaryModel({ provider: 'mock', model: 'jarvis-demo', baseUrl: '' }),
    ).toEqual({ model: 'qwen2.5:3b', baseUrl: 'http://127.0.0.1:11434' });
    expect(
      resolveLocalSummaryModel({
        provider: 'ollama',
        model: 'qwen2.5:7b',
        baseUrl: 'http://127.0.0.1:11434/',
      }).model,
    ).toBe('qwen2.5:7b');
  });
});

import { describe, expect, it } from 'vitest';
import { CodeModelFormatError } from '../codeSchemas.js';
import {
  ASK_MARKER,
  askPrompt,
  askSystemPrompt,
  checkAnswer,
  excerptFound,
  parseAskReply,
} from './ask.js';
import { JARVIS_PROJECT_PROFILE } from './profiles/jarvis.js';

const files: Record<string, string> = {
  'apps/desktop/src/main/tools/index.ts':
    'export function createToolManager(deps: ToolManagerDeps): ToolManager {\n  return x;\n}\n',
  'packages/core/src/agent/agent.ts': 'export const HARD_TOOL_ROUND_CAP = 6;\n',
};
const read = async (path: string) => files[path] ?? null;

describe('questions sur le code (0.5.1)', () => {
  it('consigne : lecture seule, contexte du projet, format JSON attendu', () => {
    const system = askSystemPrompt(JARVIS_PROJECT_PROFILE);
    expect(system).toContain(ASK_MARKER);
    expect(system).toContain(JARVIS_PROJECT_PROFILE.promptContext);
    expect(system).toContain('Tu ne modifies rien');
    expect(system).toContain('"citations"');
    expect(askPrompt('  Où ?  ')).toBe("Question de l'utilisateur :\nOù ?");
  });

  it('lit une réponse en français ou en anglais', () => {
    const fr = parseAskReply(
      'Voilà.\n```json\n{"reponse": "Dans tools/index.ts.", "fichiers": ["apps/desktop/src/main/tools/index.ts"], "citations": [{"chemin": "apps/desktop/src/main/tools/index.ts", "extrait": "export function createToolManager"}]}\n```',
    );
    expect(fr.answer).toBe('Dans tools/index.ts.');
    expect(fr.citations).toEqual([
      {
        path: 'apps/desktop/src/main/tools/index.ts',
        excerpt: 'export function createToolManager',
      },
    ]);
    const en = parseAskReply('{"answer": "Six.", "files": [], "citations": []}');
    expect(en.answer).toBe('Six.');
  });

  it('refuse une réponse vide ou sans JSON', () => {
    expect(() => parseAskReply('{"reponse": "  "}')).toThrow(CodeModelFormatError);
    expect(() => parseAskReply('Je ne sais pas.')).toThrow(CodeModelFormatError);
  });

  it('extrait cherché dans le fichier, espaces mis à part ; trop court = non prouvé', () => {
    expect(
      excerptFound(
        'export   const HARD_TOOL_ROUND_CAP =\n6',
        files['packages/core/src/agent/agent.ts']!,
      ),
    ).toBe(true);
    expect(excerptFound('= 7', files['packages/core/src/agent/agent.ts']!)).toBe(false);
    expect(excerptFound('6', files['packages/core/src/agent/agent.ts']!)).toBe(false);
  });

  it('chaque citation est relue : vérifiée, introuvable, fichier absent ou refusé', async () => {
    const checked = await checkAnswer(
      {
        answer: 'Six tours, dans agent.ts.',
        files: ['packages/core/src/agent/agent.ts', 'nexiste/pas.ts'],
        citations: [
          { path: 'packages/core/src/agent/agent.ts', excerpt: 'HARD_TOOL_ROUND_CAP = 6' },
          { path: 'packages/core/src/agent/agent.ts', excerpt: 'HARD_TOOL_ROUND_CAP = 9' },
          { path: 'nexiste/pas.ts', excerpt: 'quelque chose' },
          { path: '../secret.txt', excerpt: 'mot de passe' },
          { path: '.env', excerpt: 'API_KEY=1' },
        ],
      },
      read,
    );
    expect(checked.citations.map((c) => c.status)).toEqual([
      'verified',
      'not-found',
      'missing-file',
      'refused',
      'refused',
    ]);
    expect(checked.verified).toBe(1);
    expect(checked.files).toEqual([
      { path: 'packages/core/src/agent/agent.ts', exists: true },
      { path: 'nexiste/pas.ts', exists: false },
    ]);
  });
});

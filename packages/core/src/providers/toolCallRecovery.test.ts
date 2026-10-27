import { describe, expect, it } from 'vitest';
import {
  balancedJsonSpans,
  parseLooseJson,
  recoverToolCallsFromText,
  repairJsonText,
} from './toolCallRecovery.js';
import type { ToolSchema } from './types.js';

const TOOLS: ToolSchema[] = [
  {
    name: 'write_file',
    description: 'Écrit un fichier.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Lit un fichier.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'list_files',
    description: 'Liste les fichiers.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'set_volume',
    description: 'Volume.',
    parameters: {
      type: 'object',
      properties: { level: { type: 'integer' }, mute: { type: 'boolean' }, tags: { type: 'array' } },
      required: ['level'],
    },
  },
];

const CODE = 'export function keel(n) {\n  if (n > 0) return 1;\n  if (n < 0) return -1;\n  return 0;\n}\n';

describe('réparation du JSON', () => {
  it('échappe les retours à la ligne bruts dans une chaîne, pas ailleurs', () => {
    const raw = '{\n  "content": "ligne 1\nligne 2\tfin"\n}';
    expect(JSON.parse(repairJsonText(raw))).toEqual({ content: 'ligne 1\nligne 2\tfin' });
  });

  it('retire une virgule finale hors des chaînes et garde celle d’une chaîne', () => {
    expect(parseLooseJson('{"a": "x, }", "b": [1, 2,],}')).toEqual({ a: 'x, }', b: [1, 2] });
  });

  it('rend undefined pour un texte qui n’est pas du JSON', () => {
    expect(parseLooseJson('Bonjour')).toBeUndefined();
    expect(parseLooseJson('{"a": ')).toBeUndefined();
  });

  it('borne les objets en ignorant les accolades des chaînes, et saute un objet tronqué', () => {
    expect(balancedJsonSpans('avant {"c": "}{"} entre [1, {"x": 2}] après {"ouvert": ')).toEqual([
      '{"c": "}{"}',
      '[1, {"x": 2}]',
    ]);
  });
});

describe('appels d’outils relus dans le texte', () => {
  it('Qwen2.5 : balise <tool_call> avec du code sur plusieurs lignes non échappé', () => {
    const text = `<tool_call>\n{"name": "write_file", "arguments": {"path": "src/keel.mjs", "content": "${CODE}"}}\n</tool_call>`;
    expect(recoverToolCallsFromText(text, TOOLS)).toEqual([
      { name: 'write_file', arguments: { path: 'src/keel.mjs', content: CODE } },
    ]);
  });

  it('balise <tool_call> non refermée en fin de réponse', () => {
    const text = '<tool_call>\n{"name": "read_file", "arguments": {"path": "src/a.mjs"}}';
    expect(recoverToolCallsFromText(text, TOOLS)).toEqual([{ name: 'read_file', arguments: { path: 'src/a.mjs' } }]);
  });

  it('plusieurs balises : plusieurs appels, dans l’ordre', () => {
    const text =
      '<tool_call>{"name": "list_files", "arguments": {}}</tool_call>\n<tool_call>{"name": "read_file", "arguments": {"path": "b"}}</tool_call>';
    expect(recoverToolCallsFromText(text, TOOLS).map((call) => call.name)).toEqual(['list_files', 'read_file']);
  });

  it('Qwen2.5-Coder : bloc ```json après une phrase, `arguments` encodé en chaîne', () => {
    const text =
      'Je vais écrire le fichier.\n```json\n{"name": "write_file", "arguments": "{\\"path\\": \\"src/span.mjs\\", \\"content\\": \\"export const x = 1;\\"}"}\n```';
    expect(recoverToolCallsFromText(text, TOOLS)).toEqual([
      { name: 'write_file', arguments: { path: 'src/span.mjs', content: 'export const x = 1;' } },
    ]);
  });

  it('objet JSON nu, clé `parameters` au lieu d’`arguments`', () => {
    expect(recoverToolCallsFromText('{"name": "read_file", "parameters": {"path": "x"}}', TOOLS)).toEqual([
      { name: 'read_file', arguments: { path: 'x' } },
    ]);
  });

  it('forme OpenAI {"function": {...}} et liste d’appels', () => {
    const text = '[{"function": {"name": "read_file", "arguments": {"path": "a"}}}, {"name": "list_files", "arguments": {}}]';
    expect(recoverToolCallsFromText(text, TOOLS).map((call) => call.name)).toEqual(['read_file', 'list_files']);
  });

  it('Qwen3-Coder : format XML, valeurs converties d’après le schéma', () => {
    const text = [
      '<tool_call>',
      '<function=write_file>',
      '<parameter=path>',
      'src/keel.mjs',
      '</parameter>',
      '<parameter=content>',
      CODE,
      '</parameter>',
      '</function>',
      '</tool_call>',
    ].join('\n');
    expect(recoverToolCallsFromText(text, TOOLS)).toEqual([
      { name: 'write_file', arguments: { path: 'src/keel.mjs', content: CODE } },
    ]);
    const typed = '<function=set_volume><parameter=level>40</parameter><parameter=mute>false</parameter><parameter=tags>["a"]</parameter></function>';
    expect(recoverToolCallsFromText(typed, TOOLS)).toEqual([
      { name: 'set_volume', arguments: { level: 40, mute: false, tags: ['a'] } },
    ]);
  });

  it('refuse un outil non proposé, même bien formé', () => {
    expect(recoverToolCallsFromText('<tool_call>{"name": "run_command", "arguments": {"command": "rm -rf /"}}</tool_call>', TOOLS)).toEqual([]);
    expect(recoverToolCallsFromText('<function=delete_file><parameter=path>a</parameter></function>', TOOLS)).toEqual([]);
  });

  it('n’invente rien : texte normal, JSON de réponse, nom seul sans les paramètres obligatoires', () => {
    expect(recoverToolCallsFromText('Le fichier src/keel.mjs est prêt.', TOOLS)).toEqual([]);
    expect(recoverToolCallsFromText('{"name": "Pong", "description": "un jeu"}', TOOLS)).toEqual([]);
    expect(recoverToolCallsFromText('{"name": "read_file"}', TOOLS)).toEqual([]);
    expect(recoverToolCallsFromText('{"name": "list_files"}', TOOLS)).toEqual([{ name: 'list_files', arguments: {} }]);
  });

  it('ignore un bloc de code JavaScript (ce n’est pas un appel)', () => {
    const text = '```javascript\nconst call = {"name": "read_file", "arguments": {"path": "x"}};\n```';
    expect(recoverToolCallsFromText(text, TOOLS)).toEqual([]);
  });

  it('sans outil proposé, rien n’est relu', () => {
    expect(recoverToolCallsFromText('<tool_call>{"name": "read_file", "arguments": {"path": "x"}}</tool_call>', [])).toEqual([]);
  });

  it('arguments irréparables : pas d’appel plutôt qu’un appel faux', () => {
    const text = '<tool_call>{"name": "write_file", "arguments": {"path": "a", "content": "return "other";"}}</tool_call>';
    expect(recoverToolCallsFromText(text, TOOLS)).toEqual([]);
  });
});

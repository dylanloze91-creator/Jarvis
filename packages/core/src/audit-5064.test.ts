import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { wakeWordAddress, followUpAddressee } from './speech/addressee.js';
import { detectCurrentInfoIntent, extractCity } from './agent/currentInfo.js';
import { clockReply, expressTeam, firstOfMonth, ORCHESTRA_TEAMS, solveArithmetic, type OrchestraTeam } from './agent/orchestra.js';
import { recoverToolCallsFromText } from './providers/toolCallRecovery.js';
import { redactSecrets, redactValue } from './security/redact.js';
import { dedupeResults } from './search/chain.js';
import { ToolManager, defineTool } from './tools/manager.js';
import { createMessage } from './types.js';

/**
 * 5.0.64 — correctifs de l'audit du cœur. Chaque cas ci-dessous était faux
 * avant (vérifié en lançant le code), et reste juste après.
 */

const wake = { word: 'jarvis' };
const NOW = new Date('2026-10-01T21:30:00Z');

describe('5.0.64 — destinataire vocal', () => {
  it.each([
    'Attends Jarvis, ouvre Chrome',
    'Voilà Jarvis, ouvre Chrome',
    'Maintenant Jarvis ouvre Chrome',
    'Allô Jarvis, tu m’entends ?',
    'S’il te plaît Jarvis, ouvre Chrome',
    'Excuse-moi Jarvis, quelle heure est-il ?',
    'Et toi Jarvis, tu en penses quoi ?',
    'Au fait Jarvis, c’est quoi la météo ?',
    'D’accord. Jarvis, ouvre Chrome',
    'Quelle heure est-il Jarvis s’il te plaît',
    'is Jarvis, ouvre Chrome',
  ])('« %s » lui parle (avant : mention, commande perdue)', (text) => {
    expect(wakeWordAddress(text, wake)).toBe('address');
  });

  it.each(['Tu connais Jarvis, c’est mon assistant', 'le Jarvis de mon frère', 'J’ai installé Jarvis hier'])(
    '« %s » reste une mention',
    (text) => {
      expect(wakeWordAddress(text, wake)).toBe('mention');
    },
  );

  it('« Et à Lyon ? » est un suivi évident (le « à » accentué ne passait jamais)', () => {
    expect(followUpAddressee('Et à Lyon ?', wake)).toBe('yes');
    expect(followUpAddressee('Et pour demain ?', wake)).toBe('yes');
  });
});

describe('5.0.64 — questions d’actualité', () => {
  it('une salutation en tête ne masque plus la question', () => {
    expect(detectCurrentInfoIntent('Bonjour, quelle est la météo à Lyon aujourd’hui ?', NOW)?.kind).toBe('weather');
    expect(detectCurrentInfoIntent('Salut Jarvis, c’est quoi les actualités du jour ?', NOW)?.kind).toBe('news');
    expect(detectCurrentInfoIntent('Bonjour Jarvis, qui est le premier ministre actuel ?', NOW)?.kind).toBe('office');
    expect(detectCurrentInfoIntent('Bonjour', NOW)).toBeNull();
    expect(detectCurrentInfoIntent('Salut, ça va ?', NOW)).toBeNull();
  });

  it('ville dictée en minuscules, ville après plusieurs prépositions, mot collé après la ville', () => {
    expect(extractCity('quel temps fait-il demain à lyon')).toBe('Lyon');
    expect(extractCity('météo à paris')).toBe('Paris');
    expect(extractCity('Quelle est la météo pour Noël à Paris ?')).toBe('Paris');
    expect(extractCity('quel temps fait-il à Paris Jarvis')).toBe('Paris');
    expect(extractCity('Quel temps fait-il aujourd’hui ?')).toBeUndefined();
  });

  it('sans ville, la requête garde la question (« demain », « ce week-end »)', () => {
    const plan = detectCurrentInfoIntent('Quel temps fera-t-il demain ?', NOW);
    expect(plan?.kind).toBe('weather');
    expect(plan?.query).not.toBe('météo aujourd’hui France');
    expect(plan?.query.toLowerCase()).toContain('demain');
  });
});

describe('5.0.64 — chef d’orchestre', () => {
  it('une date, un numéro ou une plage tapés seuls ne sont pas un calcul', () => {
    for (const text of ['2024-11-01', '06-12-34-56-78', '14-18', '12/10/2024', '06 12 34 56 78']) {
      expect(solveArithmetic(text), text).toBeNull();
    }
    expect(solveArithmetic('combien font 14-18')?.reply).toMatch(/= -?−?4$/);
    expect(solveArithmetic('100/4')?.reply).toMatch(/= 25$/);
  });

  it('le premier du mois se dit « 1er »', () => {
    expect(firstOfMonth('dimanche 1 novembre 2026')).toBe('dimanche 1er novembre 2026');
    expect(firstOfMonth('mardi 11 novembre 2026')).toBe('mardi 11 novembre 2026');
    expect(clockReply('On est quel jour ?', new Date('2026-11-01T12:00:00Z'), 'Europe/Paris')).toBe(
      'Nous sommes le dimanche 1er novembre 2026.',
    );
  });

  it('après un tour Google, « ouvre Chrome » ne part plus en express vers l’équipe Google', () => {
    const history = [
      createMessage('user', 'Lis mes derniers mails'),
      createMessage('assistant', '', { toolCalls: [{ id: 't1', name: 'google_gmail_search', arguments: {} }] }),
      createMessage('tool', 'ok', { toolCallId: 't1', toolName: 'google_gmail_search' }),
      createMessage('assistant', 'Tu as deux mails.'),
    ];
    const available = new Set<OrchestraTeam>(ORCHESTRA_TEAMS);
    expect(expressTeam({ text: 'ouvre chrome', history, available })).toBeNull();
    expect(expressTeam({ text: 'Lis mon dernier mail', history, available })).toBe('google');
  });
});

describe('5.0.64 — appels relus', () => {
  const TOOLS = [
    { name: 'write_file', description: 'x', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  ];
  it('un JSON nu précédé d’une phrase est relu ; un bloc JavaScript ne l’est pas', () => {
    expect(recoverToolCallsFromText('D’accord, j’écris le fichier :\n{"name": "write_file", "arguments": {"path": "a"}}', TOOLS)).toEqual([
      { name: 'write_file', arguments: { path: 'a' } },
    ]);
    expect(recoverToolCallsFromText('Voici :\n```js\nconst x = {"name": "write_file", "arguments": {"path": "a"}};\n```', TOOLS)).toEqual([]);
  });
});

describe('5.0.64 — secrets', () => {
  it('clé OpenAI sk-proj-… et champs password / secret masqués', () => {
    expect(redactSecrets('clé sk-proj-abcdefghijklmnopqrstuvwxyz0123')).not.toContain('abcdefghijklmnop');
    const safe = redactValue({ password: 'hunter2', secret: 'top', apiSecret: 'x1', privateKey: 'k1', name: 'ok' }) as Record<string, string>;
    expect(safe.password).not.toBe('hunter2');
    expect(safe.secret).not.toBe('top');
    expect(safe.apiSecret).not.toBe('x1');
    expect(safe.privateKey).not.toBe('k1');
    expect(safe.name).toBe('ok');
  });
});

describe('5.0.64 — dédoublonnage', () => {
  it('deux résultats sans titre ne sont pas des doublons', () => {
    const out = dedupeResults([
      { title: '', url: 'https://a.example/1', snippet: 'a' },
      { title: '', url: 'https://b.example/2', snippet: 'b' },
    ] as never);
    expect(out).toHaveLength(2);
  });
});

describe('5.0.64 — Tool Manager', () => {
  const tool = defineTool({
    name: 'append_rows',
    description: 'x',
    risk: 'confirm',
    schema: z.object({ rows: z.array(z.string()) }),
    summarize: ({ rows }) => `Ajouter ${rows.length} lignes.`,
    execute: async () => ({ ok: true, content: 'fait' }),
  });
  const manager = new ToolManager().register(tool);

  it('des arguments invalides sont refusés avant la carte, sans faire planter le résumé', async () => {
    let asked = 0;
    const outcome = await manager.execute(
      { id: 'c1', name: 'append_rows', arguments: {} },
      { requestConfirmation: async () => (asked += 1, true) },
    );
    expect(asked).toBe(0);
    expect(outcome.status).toBe('error');
    expect(outcome.content).toMatch(/Arguments invalides/);
    expect(tool.summarize({})).toMatch(/append_rows/);
  });

  it('un tour interrompu pendant la carte n’est pas un refus de l’utilisateur', async () => {
    const controller = new AbortController();
    const outcome = await manager.execute(
      { id: 'c2', name: 'append_rows', arguments: { rows: ['a'] } },
      {
        signal: controller.signal,
        requestConfirmation: async () => {
          controller.abort();
          return false;
        },
      },
    );
    expect(outcome.decision).toBe('blocked');
    expect(outcome.outcome).toBe('cancelled');
    expect(outcome.content).toMatch(/interrompu/);
  });
});

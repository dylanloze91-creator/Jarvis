import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agreger } from './aggregate.js';
import { demandesJarvis, serialiserReferences, versReference, type ConversationLue, type MessageLu } from './demandes.js';
import { parseConversation } from './lire.js';
import { produireCarte } from './produire.js';

const PHRASE_JARVIS = 'zalph zbrav zchar zdelt bug dans widget.ts';
const PHRASE_CLAUDE = 'yalph ybrav ychar ydelt explique ce script python';
const PHRASE_CODE = 'xalph xbrav xchar xdelt ajoute un test bash';
const PHRASE_CARNET = 'walph wbrav wchar wdelt rappel du matin';
const PHRASE_REPONSE = 'valph vbrav vchar vdelt reponse interne';
const PHRASE_OUTIL = 'ualph ubrav uchar udelt resultat outil';
const PHRASE_ATTENDU = 'talph tbrav tchar tdelt attente utilisateur';
const PHRASE_RESUME = 'salph sbrav schar sdelt resume session';
const PHRASE_META = 'ralph rbrav rchar rdelt meta interne';
const PHRASE_IGNOREE = 'malph mbrav mchar mdelt version ignoree';
const PHRASE_TYPE = 'nalph nbrav nchar ndelt type ignore';
const PHRASES = [
  PHRASE_JARVIS,
  PHRASE_CLAUDE,
  PHRASE_CODE,
  PHRASE_CARNET,
  PHRASE_REPONSE,
  PHRASE_OUTIL,
  PHRASE_ATTENDU,
  PHRASE_RESUME,
  PHRASE_META,
  PHRASE_IGNOREE,
  PHRASE_TYPE,
];

function suites(phrase: string): string[] {
  const mots = phrase.trim().split(/\s+/).filter(Boolean);
  const trouvees: string[] = [];
  for (let i = 0; i + 3 < mots.length; i += 1) trouvees.push(mots.slice(i, i + 4).join(' '));
  return trouvees;
}

function fuite(blob: string): string | null {
  for (const phrase of PHRASES) {
    for (const suite of suites(phrase)) {
      const motif = suite
        .split(' ')
        .map((mot) => mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s+');
      if (new RegExp(motif, 'i').test(blob)) return suite;
    }
  }
  return null;
}

function message(partiel: Partial<MessageLu> & Pick<MessageLu, 'id' | 'role' | 'content'>): MessageLu {
  return {
    createdAt: null,
    toolName: null,
    toolStatus: null,
    missionId: null,
    chatMissionKind: null,
    ...partiel,
  };
}

describe('carte (synthetique-test)', () => {
  it('synthetique-test aucune suite de 4 mots des phrases ne sort', async () => {
    const racine = await mkdtemp(join(tmpdir(), 'jarvis-carte-'));
    const conversations = join(racine, 'conversations');
    const claude = join(racine, 'claude');
    const projects = join(racine, 'projects', 'session');
    const sortie = join(racine, 'sortie');
    const rapport = join(racine, 'rapport.md');
    await mkdir(conversations, { recursive: true });
    await mkdir(claude, { recursive: true });
    await mkdir(projects, { recursive: true });
    const quand = Date.parse('2026-11-12T08:30:00.000Z');
    const conversation = {
      id: 'id-synthetique-jarvis',
      title: 'synthetique-test',
      createdAt: quand,
      updatedAt: quand,
      messages: [
        { id: 'id-synthetique-message', role: 'user', content: PHRASE_JARVIS, createdAt: quand },
        {
          id: 'id-synthetique-outil',
          role: 'tool',
          content: PHRASE_OUTIL,
          toolName: 'ouvrir_fichier',
          toolStatus: 'error',
          createdAt: quand,
        },
      ],
      routeLog: [{ userMessageId: 'id-synthetique-message', team: 'code', how: 'express' }],
    };
    const carnet = [
      JSON.stringify({
        version: 1,
        id: 'id-synthetique-rate',
        date: '2026-11-12T08:30:00.000Z',
        edition: 'test',
        source: { kind: 'telephone', name: 'Zsalon' },
        type: 'outil_echec',
        rule: 'outil-erreur',
        userText: PHRASE_JARVIS,
        replyStart: PHRASE_REPONSE,
        team: 'code',
        model: null,
        how: 'express',
        tools: [{ name: 'ouvrir_fichier', result: PHRASE_OUTIL }],
        conversationId: 'id-synthetique-jarvis',
        reviewed: false,
        expected: PHRASE_ATTENDU,
      }),
      JSON.stringify({
        version: 1,
        id: 'id-synthetique-carnet',
        date: '2026-11-11T09:00:00.000Z',
        edition: 'test',
        source: { kind: 'fenetre' },
        type: 'signale',
        rule: 'signale-phrase',
        userText: PHRASE_CARNET,
        replyStart: PHRASE_REPONSE,
        team: null,
        model: null,
        how: null,
        tools: [],
        conversationId: 'id-synthetique-carnet',
        reviewed: false,
      }),
      `{"version":2,"type":"correction","userText":${JSON.stringify(PHRASE_IGNOREE)}}`,
      `{"version":1,"type":"inconnu","userText":${JSON.stringify(PHRASE_TYPE)}}`,
      '{',
      '',
    ].join('\n');
    const exportClaude = [
      {
        uuid: 'id-synthetique-claude',
        chat_messages: [
          {
            uuid: 'id-synthetique-humain',
            sender: 'human',
            text: PHRASE_CLAUDE,
            created_at: '2026-11-12T10:00:00.000Z',
          },
          {
            uuid: 'id-synthetique-assistant',
            sender: 'assistant',
            text: PHRASE_REPONSE,
            parent_message_uuid: 'id-synthetique-humain',
            created_at: '2026-11-12T10:01:00.000Z',
          },
        ],
      },
    ];
    const code = [
      JSON.stringify({ type: 'summary', summary: PHRASE_RESUME }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: PHRASE_REPONSE }] },
      }),
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', content: PHRASE_OUTIL }] },
      }),
      JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: PHRASE_META } }),
      JSON.stringify({
        type: 'user',
        uuid: 'id-synthetique-cc',
        sessionId: 'id-synthetique-session',
        timestamp: '2026-11-10T11:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: PHRASE_CODE }] },
      }),
      '{',
    ].join('\n');
    const fichiers = {
      [join(conversations, 'id-synthetique-jarvis.json')]: `${JSON.stringify(conversation)}\n`,
      [join(conversations, 'abime.json')]: '{',
      [join(racine, 'rates.jsonl')]: `${carnet}\n`,
      [join(claude, 'conversations.json')]: `${JSON.stringify(exportClaude)}\n`,
      [join(projects, 'id-synthetique-session.jsonl')]: `${code}\n`,
    };
    for (const [chemin, corps] of Object.entries(fichiers)) {
      await writeFile(chemin, corps, 'utf8');
    }
    const avant = new Map<string, string>();
    for (const chemin of Object.keys(fichiers)) {
      avant.set(chemin, createHash('sha256').update(await readFile(chemin)).digest('hex'));
    }
    const listingAvant = (await readdir(conversations)).sort();

    const resultat = await produireCarte({
      conversations: [conversations, join(racine, 'dossier-absent')],
      carnet: join(racine, 'rates.jsonl'),
      exportClaude: claude,
      claudeCode: join(racine, 'projects'),
      dir: sortie,
      rapport,
      maintenant: Date.parse('2026-11-12T12:00:00.000Z'),
    });

    for (const [chemin, empreinte] of avant) {
      expect(createHash('sha256').update(await readFile(chemin)).digest('hex')).toBe(empreinte);
    }
    expect((await readdir(conversations)).sort()).toEqual(listingAvant);

    const carteJson = await readFile(join(sortie, 'carte', 'carte.json'), 'utf8');
    const carteMd = await readFile(join(sortie, 'carte', 'carte.md'), 'utf8');
    const references = await readFile(join(sortie, 'carte', 'references.jsonl'), 'utf8');
    const rapportLu = await readFile(rapport, 'utf8');
    for (const blob of [carteJson, carteMd, rapportLu, references, resultat.journaux.join('\n'), resultat.markdown]) {
      expect(fuite(blob)).toBeNull();
    }
    for (const identifiant of [
      'id-synthetique-jarvis',
      'id-synthetique-message',
      'id-synthetique-claude',
      'id-synthetique-session',
      'Zsalon',
    ]) {
      expect(carteJson).not.toContain(identifiant);
      expect(carteMd).not.toContain(identifiant);
      expect(rapportLu).not.toContain(identifiant);
    }
    expect(references).toContain('id-synthetique-jarvis');
    expect(references).not.toContain(PHRASE_JARVIS);
    const stats = resultat.stats;
    expect(stats.lectures.conversationsSautees).toBe(1);
    expect(stats.lectures.conversationsAbsentes).toBe(1);
    expect(stats.lectures.carnetIgnorees).toBe(3);
    expect(stats.lectures.carnetLignes).toBe(2);
    expect(stats.lectures.claudeCodeLignesIgnorees).toBe(1);
    const jarvis = stats.sources.find((source) => source.source === 'Jarvis');
    const carnetBloc = stats.sources.find((source) => source.source === 'Carnet');
    const claudeBloc = stats.sources.find((source) => source.source === 'claude.ai');
    const codeBloc = stats.sources.find((source) => source.source === 'Claude Code');
    expect(jarvis?.demandes).toBe(1);
    expect(jarvis?.rates).toBe(1);
    expect(jarvis?.familles.find((ligne) => ligne.famille === 'code')?.nombre).toBe(1);
    expect(jarvis?.langages.find((ligne) => ligne.langage === 'TypeScript')?.nombre).toBe(1);
    expect(jarvis?.outils).toEqual([{ outil: 'ouvrir_fichier', reussi: 0, rate: 1, refuse: 0 }]);
    expect(jarvis?.equipes?.[0]).toEqual({ equipe: 'code', nombre: 1 });
    expect(jarvis?.facons?.[0]).toEqual({ facon: 'express', nombre: 1 });
    expect(jarvis?.lieux?.find((lieu) => lieu.lieu === 'téléphone')?.nombre).toBe(1);
    expect(carnetBloc?.demandes).toBe(1);
    expect(carnetBloc?.rates).toBe(1);
    expect(carnetBloc?.familles.find((ligne) => ligne.famille === 'quotidien')?.nombre).toBe(1);
    expect(claudeBloc?.demandes).toBe(1);
    expect(claudeBloc?.langages.find((ligne) => ligne.langage === 'Python')?.nombre).toBe(1);
    expect(codeBloc?.demandes).toBe(1);
    expect(codeBloc?.langages.find((ligne) => ligne.langage === 'Bash')?.nombre).toBe(1);
    expect(stats.ensemble.demandes).toBe(4);
    expect(stats.ensemble.rates).toBe(2);
    expect(stats.ensemble.famillesQuiRatent[0]).toMatchObject({ famille: 'quotidien', rates: 1, taux: 100 });
    expect(stats.ensemble.famillesQuiRatent[1]).toMatchObject({ famille: 'code', rates: 1 });
    expect(stats.ensemble.famillesQuiRatent[1]?.taux).toBeLessThan(100);
    expect(stats.ensemble.heures).toHaveLength(24);
    for (const row of references.trim().split('\n')) {
      const parsed = JSON.parse(row) as Record<string, unknown>;
      for (const cle of Object.keys(parsed)) {
        expect(['source', 'conversationId', 'messageId', 'famille', 'langage']).toContain(cle);
      }
    }
    expect(references).toContain('"langage":"TypeScript"');
    expect(carteMd).toBe(rapportLu);
  });

  it('synthetique-test une correction et un refus sont des ratés, une enceinte ne donne pas son nom', () => {
    const quand = Date.parse('2026-11-12T15:00:00.000Z');
    const conversation: ConversationLue = {
      id: 'c-rate',
      lieu: null,
      routeLog: [{ userMessageId: 'u1', team: 'musique', how: 'express' }],
      messages: [
        message({ id: 'u1', role: 'user', content: 'Mets la chanson sur Spotify', createdAt: quand }),
        message({ id: 't1', role: 'tool', content: 'echec', toolName: 'spotify_play', toolStatus: 'denied', createdAt: quand }),
        message({
          id: 'a1',
          role: 'assistant',
          content: 'carte',
          createdAt: quand,
          missionId: 'mission-1',
          chatMissionKind: 'proposal',
        }),
        message({ id: 'u2', role: 'user', content: "non, c'est faux", createdAt: quand + 1000 }),
      ],
    };
    const demandes = demandesJarvis(conversation);
    expect(demandes).toHaveLength(2);
    expect(demandes[0]?.rate).toBe(true);
    expect(demandes[0]?.famille).toBe('musique');
    expect(demandes[0]?.outils).toEqual([{ nom: 'spotify_play', statut: 'refuse' }]);
    expect(demandes[0]?.missions).toEqual(['mission', 'proposal']);
    expect(demandes[1]?.rate).toBe(false);
    expect(demandes[1]?.famille).toBe('conversation');
    const lue = parseConversation(
      {
        id: 'c-enceinte',
        title: 'Zsalon · quelle heure',
        messages: [{ id: 'u3', role: 'user', content: 'quelle heure', createdAt: quand }],
      },
      'c',
    );
    expect(lue?.lieu).toBe('enceinte');
    const stats = agreger(demandesJarvis(lue!), {
      conversationsLues: 1,
      conversationsSautees: 0,
      conversationsAbsentes: 0,
      conversationsDemandees: true,
      carnetLignes: 0,
      carnetIgnorees: 0,
      carnetAbsent: false,
      carnetDemande: false,
      exportClaudeConversations: 0,
      exportClaudeSaute: false,
      exportClaudeAbsent: false,
      exportClaudeDemande: false,
      claudeCodeFichiers: 0,
      claudeCodeLignesIgnorees: 0,
      claudeCodeAbsent: false,
      claudeCodeDemande: false,
    });
    expect(JSON.stringify(stats)).not.toContain('Zsalon');
    expect(stats.sources[0]?.lieux?.find((lieu) => lieu.lieu === 'enceinte')?.nombre).toBe(1);
    const reference = versReference(demandes[0]!);
    expect(reference).not.toHaveProperty('empreinte');
    expect(serialiserReferences(demandes)).not.toContain('chanson');
  });

  it('synthetique-test refuse d’écrire dans une source et dit une source absente', async () => {
    const racine = await mkdtemp(join(tmpdir(), 'jarvis-carte-'));
    const conversations = join(racine, 'conversations');
    await mkdir(conversations, { recursive: true });
    await expect(produireCarte({ conversations: [conversations], dir: conversations, ecrire: true })).rejects.toThrow(
      /source/,
    );
    expect(await readdir(conversations)).toEqual([]);
    const sortie = join(racine, 'sortie');
    const resultat = await produireCarte({
      conversations: [join(racine, 'absent')],
      carnet: join(racine, 'absent.jsonl'),
      exportClaude: join(racine, 'absent-claude'),
      claudeCode: join(racine, 'absent-code'),
      dir: sortie,
      ecrire: true,
    });
    expect(resultat.stats.lectures.conversationsAbsentes).toBe(1);
    expect(resultat.stats.lectures.carnetAbsent).toBe(true);
    expect(resultat.stats.lectures.exportClaudeAbsent).toBe(true);
    expect(resultat.stats.lectures.claudeCodeAbsent).toBe(true);
    expect(resultat.stats.ensemble.demandes).toBe(0);
    expect(resultat.journaux.join('\n')).toMatch(/absent/);
    expect(await readdir(join(sortie, 'carte'))).toEqual(['carte.json', 'carte.md', 'references.jsonl']);
  });

  it('le script PowerShell est en UTF-8 avec BOM et cherche les dossiers tout seul', async () => {
    const chemin = new URL('../../../../scripts/carte-utilisation.ps1', import.meta.url);
    const buf = await readFile(chemin);
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const texte = buf.toString('utf8');
    expect(texte).toContain('conversations Jarvis Live');
    expect(texte).toContain('conversations Jarvis Test');
    expect(texte).toContain('Jarvis Test');
    expect(texte).toContain('rates.jsonl');
    expect(texte).toContain('.claude');
    expect(texte).toContain('carte:utilisation');
    expect(texte).toContain('C:\\dev\\jarvis-data');
  });
});

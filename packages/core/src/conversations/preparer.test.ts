import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSettings } from '../settings.js';
import { parseTrainingLine } from '../trieur/trainPrep.js';
import { classerConversations, preparerConversations, type ResultatPreparation } from './preparer.js';

const PHRASE = 'synthetique-test ouvre le volet bleu du salon';
const REPONSE = 'synthetique-test-reponse-ouverte-du-salon';
const SECRET = 'sk-secretvaleur123456789';
const REPONSE_FERMEE = 'synthetique-test-reponse-anthropic-interdite';
const CORRECTION_CLAUDE = 'synthetique-test-correction-ecrite-par-claude';

function message(role: 'user' | 'assistant' | 'tool', content: string, extra: Record<string, unknown> = {}) {
  return { id: `${role}-${content.slice(0, 12)}`, role, content, createdAt: 1, ...extra };
}

function tourOuvert(texte = PHRASE, reponse = REPONSE, team = 'conversation', model = 'qwen2.5:7b') {
  const user = message('user', texte, { id: 'u1' });
  const assistant = message('assistant', reponse, { id: 'a1' });
  return {
    user,
    assistant,
    journal: {
      userMessageId: 'u1',
      assistantMessageIds: ['a1'],
      team,
      how: 'express',
      provider: 'ollama',
      model,
      place: 'carte',
      source: 'texte',
      tools: [],
      durationMs: 10,
      at: 1,
    },
  };
}

function conversation(id: string, tours: ReturnType<typeof tourOuvert>[], extra: Record<string, unknown> = {}) {
  const messages = tours.flatMap((tour) => [tour.user, tour.assistant, ...(tour.outils ?? [])]);
  return {
    id,
    title: 'synthetique-test',
    createdAt: 1,
    updatedAt: 1,
    'synthetique-test': true,
    messages,
    turnLog: tours.map((tour) => tour.journal).filter(Boolean),
    routeLog: tours
      .filter((tour) => tour.journal?.team)
      .map((tour) => ({ userMessageId: tour.journal!.userMessageId, team: tour.journal!.team, how: tour.journal!.how })),
    ...extra,
  };
}

function lignes(resultat: Pick<ResultatPreparation, 'trieur' | 'reponses' | 'aCorriger' | 'ecartes'>, cle: 'trieur' | 'reponses' | 'aCorriger' | 'ecartes') {
  return resultat[cle].map((line) => JSON.parse(line) as Record<string, unknown>);
}

function texte(resultat: Pick<ResultatPreparation, 'trieur' | 'reponses' | 'aCorriger' | 'ecartes'>): string {
  return [...resultat.trieur, ...resultat.reponses, ...resultat.aCorriger, ...resultat.ecartes].join('\n');
}

describe('conversations:preparer (synthetique-test)', () => {
  it('parseSettings({}) ne gagne aucun champ', () => {
    expect(parseSettings({})).not.toHaveProperty('turnLog');
    expect(parseSettings({})).not.toHaveProperty('conversations');
  });

  it("une réponse ollama d'un modèle ouvert entre dans reponses.jsonl, et le trieur reste lisible", () => {
    for (const model of ['qwen2.5:7b', 'ornith-1.0:9b', 'jarvis-trieur']) {
      const resultat = classerConversations({
        conversations: [conversation('c-ouvert', [tourOuvert(PHRASE, REPONSE, 'conversation', model)])],
      });
      const reponses = lignes(resultat, 'reponses');
      expect(reponses).toHaveLength(1);
      expect(reponses[0]).toMatchObject({ provider: 'ollama', model, 'synthetique-test': true });
      expect(JSON.stringify(reponses[0]?.messages)).toContain(REPONSE);
      expect(JSON.stringify(reponses[0]?.messages)).not.toContain(SECRET);
      const trieur = lignes(resultat, 'trieur');
      expect(trieur).toHaveLength(1);
      expect(parseTrainingLine(trieur[0])).not.toHaveProperty('error');
      expect((trieur[0]?.messages as { role: string; content: string }[])[2]?.content).toBe('conversation');
    }
  });

  it('une réponse anthropic, openai, ou sans journal, n’entre jamais dans reponses.jsonl', () => {
    const fermee = (provider: string | null, model: string | null) => {
      const base = tourOuvert(PHRASE, REPONSE_FERMEE);
      if (!provider) {
        const sans = conversation('c-sans', [{ ...base, journal: undefined as never }]);
        sans.turnLog = [];
        return sans;
      }
      return conversation('c-fermee', [
        { ...base, journal: { ...base.journal, provider, model, userMessageId: 'u1' } },
      ]);
    };
    for (const brut of [fermee('anthropic', 'claude-3'), fermee('openai', 'gpt-4o'), fermee(null, null), fermee('ollama', 'llama3.1')]) {
      const resultat = classerConversations({ conversations: [brut] });
      expect(resultat.reponses).toHaveLength(0);
      expect(resultat.reponses.join('\n')).not.toContain(REPONSE_FERMEE);
      expect(texte(resultat)).not.toContain(REPONSE_FERMEE);
      expect(lignes(resultat, 'ecartes').some((ligne) => ligne.raison === 'modèle inconnu')).toBe(true);
    }
  });

  it('un tour raté va dans a-corriger.jsonl et jamais dans reponses.jsonl', () => {
    const base = tourOuvert('synthetique-test le volet est resté fermé', 'synthetique-test-reponse-ratee');
    const brut = conversation('c-rate', [base]);
    const carnet = JSON.stringify({
      version: 1,
      type: 'outil_echec',
      conversationId: 'c-rate',
      userText: base.user.content,
      correction: '',
    });
    const resultat = classerConversations({ conversations: [brut], carnet: [carnet] });
    expect(resultat.reponses).toHaveLength(0);
    expect(resultat.reponses.join('\n')).not.toContain('synthetique-test-reponse-ratee');
    expect(lignes(resultat, 'aCorriger')[0]).toMatchObject({ cause: 'outil_echec', correction: '', correctedBy: null });
  });

  it('un raté de chemin n’entre pas dans trieur.jsonl', () => {
    const base = tourOuvert('synthetique-test mauvaise équipe du volet', 'peu importe', 'musique');
    const resultat = classerConversations({
      conversations: [conversation('c-chemin', [base])],
      carnet: [JSON.stringify({ version: 1, type: 'chemin', conversationId: 'c-chemin', userText: base.user.content })],
    });
    expect(resultat.trieur).toHaveLength(0);
    expect(resultat.reponses).toHaveLength(0);
    expect(lignes(resultat, 'aCorriger')[0]?.cause).toBe('chemin');
  });

  it('garde au plus quatre échanges avant la demande', () => {
    const tours = Array.from({ length: 6 }, (_, index) => {
      const item = tourOuvert(`synthetique-test echange ${index}`, `reponse ${index}`);
      item.user = { ...item.user, id: `u${index}` };
      item.assistant = { ...item.assistant, id: `a${index}` };
      item.journal = { ...item.journal, userMessageId: `u${index}`, assistantMessageIds: [`a${index}`] };
      return item;
    });
    const resultat = classerConversations({ conversations: [conversation('c-echanges', tours)] });
    const derniere = lignes(resultat, 'reponses').find((ligne) => ligne.id === 'reponse-c-echanges-u5');
    const contenus = JSON.stringify(derniere?.messages);
    expect(contenus).toContain('synthetique-test echange 5');
    expect(contenus).toContain('synthetique-test echange 1');
    expect(contenus).not.toContain('synthetique-test echange 0');
  });

  it('une correction qui suit le tour l’envoie à corriger', () => {
    const premier = tourOuvert('synthetique-test quelle est la capitale', 'Lyon');
    const suite = tourOuvert('non, c’est faux', 'D’accord, Paris.');
    suite.user = { ...suite.user, id: 'u2' };
    suite.assistant = { ...suite.assistant, id: 'a2' };
    suite.journal = { ...suite.journal, userMessageId: 'u2', assistantMessageIds: ['a2'] };
    const resultat = classerConversations({ conversations: [conversation('c-suivi', [premier, suite])] });
    const causes = lignes(resultat, 'aCorriger').map((ligne) => ligne.userMessageId);
    expect(causes).toContain('u1');
    expect(resultat.reponses.join('\n')).not.toContain('Lyon');
  });

  it('une correction écrite par claude est refusée', () => {
    const base = tourOuvert('synthetique-test corrige le volet', 'reponse a remplacer');
    const resultat = classerConversations({
      conversations: [conversation('c-claude', [base])],
      carnet: [
        JSON.stringify({
          version: 1,
          type: 'correction',
          conversationId: 'c-claude',
          userText: base.user.content,
          correction: CORRECTION_CLAUDE,
          correctedBy: 'claude',
        }),
      ],
    });
    expect(texte(resultat)).not.toContain(CORRECTION_CLAUDE);
    expect(lignes(resultat, 'aCorriger')[0]).toMatchObject({ correction: '', correctedBy: null });
    expect(resultat.resume.correctionsClaudeRefusees).toBe(1);
    expect(resultat.reponses).toHaveLength(0);
  });

  it('le contenu personnel est écarté et les secrets sont masqués partout', () => {
    const user = message('user', `synthetique-test lis ${SECRET}`, { id: 'u1' });
    const tool = message('tool', `contenu ${SECRET}`, { id: 't1', toolName: 'read_file', toolStatus: 'ok', toolCallId: 'c1' });
    const assistant = message('assistant', `voici ${SECRET}`, { id: 'a1' });
    const brut = conversation('c-perso', [
      {
        user,
        assistant,
        outils: [tool],
        journal: {
          ...tourOuvert().journal,
          tools: [{ name: 'read_file', status: 'ok' }],
          assistantMessageIds: ['a1', 't1'],
        },
      },
    ]);
    const resultat = classerConversations({ conversations: [brut] });
    expect(resultat.reponses).toHaveLength(0);
    expect(lignes(resultat, 'ecartes').some((ligne) => ligne.raison === 'contenu personnel')).toBe(true);
    expect(texte(resultat)).not.toContain(SECRET);
    expect(texte(resultat)).toContain('[REDACTED]');
  });

  it("aucune phrase d'examen n'entre dans un fichier d'entraînement", () => {
    const phrase = 'synthetique-test phrase presente dans un examen';
    const resultat = classerConversations({
      conversations: [conversation('c-examen', [tourOuvert(phrase, 'reponse examen')])],
      examens: [{ phrase }],
    });
    expect(resultat.trieur.join('\n')).not.toContain(phrase);
    expect(resultat.reponses.join('\n')).not.toContain(phrase);
    expect(lignes(resultat, 'ecartes').some((ligne) => ligne.raison === "phrase d'examen")).toBe(true);
    expect(JSON.stringify(lignes(resultat, 'ecartes'))).not.toContain(phrase);
  });

  it('découpe par conversation entière, de façon déterministe', () => {
    const conversations = Array.from({ length: 10 }, (_, index) =>
      conversation(`c-${index}`, [tourOuvert(`synthetique-test demande ${index}`, `reponse ${index}`)]),
    );
    const double = conversation('c-double', [
      tourOuvert('synthetique-test premier volet', 'un'),
      (() => {
        const second = tourOuvert('synthetique-test second volet', 'deux');
        second.user = { ...second.user, id: 'u2' };
        second.assistant = { ...second.assistant, id: 'a2' };
        second.journal = { ...second.journal, userMessageId: 'u2', assistantMessageIds: ['a2'] };
        return second;
      })(),
    ]);
    const premier = classerConversations({ conversations: [...conversations, double], validation: 0.1, seed: 5066 });
    const second = classerConversations({ conversations: [...conversations, double], validation: 0.1, seed: 5066 });
    expect(second.reponses).toEqual(premier.reponses);
    const lots = new Map<string, string>();
    for (const ligne of lignes(premier, 'reponses')) {
      const id = String(ligne.conversationId);
      const lot = String(ligne.lot);
      expect(lots.get(id) ?? lot).toBe(lot);
      lots.set(id, lot);
    }
    const validation = [...lots.values()].filter((lot) => lot === 'validation');
    expect(validation.length).toBeGreaterThan(0);
    expect(validation.length).toBeLessThan(lots.size);
    const toursDouble = lignes(premier, 'reponses').filter((ligne) => ligne.conversationId === 'c-double');
    expect(toursDouble).toHaveLength(2);
    expect(toursDouble[0]?.lot).toBe(toursDouble[1]?.lot);
  });

  it('retire les doublons exacts et saute un fichier abîmé sans bloquer', () => {
    const resultat = classerConversations({
      conversations: [
        conversation('c-a', [tourOuvert()]),
        conversation('c-b', [tourOuvert()]),
        { messages: 'abime' },
      ],
      carnet: ['pas du json'],
    });
    expect(lignes(resultat, 'trieur')).toHaveLength(1);
    expect(lignes(resultat, 'reponses')).toHaveLength(1);
    expect(resultat.resume.doublons).toBeGreaterThan(0);
    expect(resultat.resume.conversations.sautees).toBe(1);
    expect(resultat.resume.carnet.ignorees).toBe(1);
  });

  it("n'écrit aucune phrase dans une source ni dans le dépôt", async () => {
    const racine = await mkdtemp(join(tmpdir(), 'jarvis-jeu-'));
    const depot = join(racine, 'depot');
    const source = join(racine, 'source');
    const sortie = join(racine, 'sortie');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(source);
    await mkdir(depot);
    const phrase = 'synthetique-test phrase qui ne doit pas entrer dans le depot';
    const fichier = join(source, 'une.json');
    const corps = JSON.stringify(conversation('c-garde', [tourOuvert(phrase, 'reponse garde')]));
    await writeFile(fichier, corps, 'utf8');
    const avant = await stat(fichier);
    await expect(
      preparerConversations({ conversations: [source], dir: depot, depot, ecrire: true }),
    ).rejects.toThrow(/dépôt/);
    expect(await readFile(fichier, 'utf8')).toBe(corps);
    expect((await stat(fichier)).mtimeMs).toBe(avant.mtimeMs);

    await preparerConversations({ conversations: [source], dir: sortie, depot, ecrire: true });
    expect(await readFile(fichier, 'utf8')).toBe(corps);
    const reponses = await readFile(join(sortie, 'conversations', 'reponses.jsonl'), 'utf8');
    expect(reponses).toContain(phrase);
    expect(reponses).toContain('synthetique-test');
    const ecartes = await readFile(join(sortie, 'conversations', 'ecartes.jsonl'), 'utf8');
    expect(ecartes).not.toContain(phrase);
    const zeros = join(source, 'zeros.json');
    await writeFile(zeros, Buffer.alloc(8));
    const apresZeros = await preparerConversations({ conversations: [source], dir: join(racine, 'sortie-2'), depot, ecrire: true });
    expect(apresZeros.resume.conversations.sautees).toBe(1);
    expect(await readFile(zeros)).toEqual(Buffer.alloc(8));
  });
});

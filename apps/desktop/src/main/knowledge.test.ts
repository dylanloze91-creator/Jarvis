import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@jarvis/core';
import { KnowledgeStore, assertIndexableFolder, extractPdfText } from './knowledge.js';

describe('KnowledgeStore', () => {
  it('garde une correction après redémarrage et retrouve la fiche pertinente', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-learning-'));
    const first = new KnowledgeStore({
      getUserDataPath: () => dir,
      fetchImpl: async () => new Response('nope', { status: 404 }),
    });
    const { noteToRecord } = await import('@jarvis/core');
    await first.applyLearning(
      noteToRecord({ id: 'corr', text: 'Non, le respawn est la touche R', now: 10 }),
    );
    const restarted = new KnowledgeStore({
      getUserDataPath: () => dir,
      fetchImpl: async () => new Response('nope', { status: 404 }),
    });
    const hits = await restarted.relevantLearning('quelle touche pour respawn');
    expect(hits.map((item) => item.id)).toEqual(['corr']);
    const removed = await restarted.deleteLearning('corr');
    expect(removed).toEqual([]);
  });

  it('garde les fiches écrites en même temps par deux magasins', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-learning-race-'));
    const { noteToRecord } = await import('@jarvis/core');
    const options = {
      getUserDataPath: () => dir,
      fetchImpl: async () => new Response('nope', { status: 404 }),
    };
    const words = ['zero', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit'];
    const left = new KnowledgeStore(options);
    const right = new KnowledgeStore(options);
    await Promise.all(
      words.map((word, i) =>
        Promise.all([
          left.applyLearning(
            noteToRecord({ id: `alpha-${i}`, text: `Retiens fichealpha${word}`, now: i + 1 }),
          ),
          right.applyLearning(
            noteToRecord({ id: `bravo-${i}`, text: `Retiens fichebravo${word}`, now: i + 50 }),
          ),
        ]),
      ),
    );
    const third = new KnowledgeStore(options);
    const ids = (await third.listLearning()).map((item) => item.id).sort();
    expect(ids).toEqual(
      [
        ...Array.from({ length: 8 }, (_, i) => `alpha-${i}`),
        ...Array.from({ length: 8 }, (_, i) => `bravo-${i}`),
      ].sort(),
    );
  });

  it('retrouve une fiche pendant qu’une autre instance réécrit la conversation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-learning-live-'));
    const { noteToRecord } = await import('@jarvis/core');
    const options = {
      getUserDataPath: () => dir,
      fetchImpl: async () => new Response('nope', { status: 404 }),
    };
    const first = new KnowledgeStore(options);
    await first.applyLearning(
      noteToRecord({
        id: 'regle',
        text: 'Retiens que les tests de ce projet utilisent node:test, pas jest.',
        now: 1,
      }),
    );
    const second = new KnowledgeStore(options);
    const [hits] = await Promise.all([
      second.relevantLearning('Ajoute un test node:test pour une addition de deux nombres.', 4),
      first.indexConversation('conversation:campagne', 'user: autre\nassistant: ok', defaultSettings),
    ]);
    expect(hits.map((item) => item.id)).toEqual(['regle']);
    const third = new KnowledgeStore(options);
    expect((await third.listLearning()).map((item) => item.id)).toContain('regle');
  });

  it('marque périmée une page web trop ancienne au rechargement', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-learning-stale-'));
    const first = new KnowledgeStore({
      getUserDataPath: () => dir,
      fetchImpl: async () => new Response('nope', { status: 404 }),
    });
    const { webHitToRecord } = await import('@jarvis/core');
    await first.applyLearning(
      webHitToRecord(
        { title: 'doc', url: 'https://nodejs.org/api/test.html', snippet: 'node:test stable' },
        'old-web',
        1,
      ),
    );
    const raw = JSON.parse(await readFile(join(dir, 'knowledge-index.json'), 'utf8')) as {
      chunks: Array<{ learning?: { lastCheckedAt: number } }>;
    };
    const learning = raw.chunks.find((chunk) => chunk.learning)?.learning;
    if (!learning) throw new Error('fiche absente');
    learning.lastCheckedAt = 1;
    await writeFile(join(dir, 'knowledge-index.json'), JSON.stringify(raw), 'utf8');
    const restarted = new KnowledgeStore({
      getUserDataPath: () => dir,
      fetchImpl: async () => new Response('nope', { status: 404 }),
    });
    const items = await restarted.listLearning();
    expect(items.find((item) => item.id === 'old-web')?.status).toBe('stale');
  });

  it('mémorise et retrouve un fait en recherche lexicale sans embeddings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-knowledge-'));
    const store = new KnowledgeStore({
      getUserDataPath: () => dir,
      fetchImpl: async () => new Response('nope', { status: 404 }),
    });

    await store.remember('Le code Wi-Fi du bureau est Jarvis42', defaultSettings, 'Wi-Fi');
    const hits = await store.search('code wifi bureau', defaultSettings, 4);

    expect(hits[0]?.text).toMatch(/Jarvis42/);
    expect(hits[0]?.kind).toBe('memory');
    const section = JSON.parse(await readFile(join(dir, 'memory', 'projects.json'), 'utf8')) as Array<{
      text: string;
    }>;
    expect(section[0]?.text).toMatch(/Jarvis42/);
    const stats = await store.stats();
    expect(stats.chunks).toBe(1);
    expect(stats.embedded).toBe(0);
  });

  it('indexe un dossier texte et ignore un fichier trop gros conceptuellement via extension', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-knowledge-'));
    const docs = join(dir, 'docs');
    await mkdir(docs);
    await writeFile(join(docs, 'notes.md'), 'Le projet SiteBlock parle à une API locale.', 'utf8');
    await writeFile(join(docs, 'secret.bin'), 'not-text', 'utf8');

    const store = new KnowledgeStore({
      getUserDataPath: () => dir,
      fetchImpl: async () => new Response('nope', { status: 404 }),
    });
    const result = await store.indexFolder(docs, defaultSettings);
    expect(result.files).toBe(1);
    expect(result.chunks).toBeGreaterThan(0);

    const hits = await store.search('SiteBlock API locale', defaultSettings);
    expect(hits.some((hit) => hit.text.includes('SiteBlock'))).toBe(true);
  });

  it('refuse d’indexer la racine ou un dossier Windows', async () => {
    await expect(assertIndexableFolder('C:\\Windows')).rejects.toThrow(/système/i);
    await expect(assertIndexableFolder('/')).rejects.toThrow();
    await expect(assertIndexableFolder('docs')).rejects.toThrow(/absolu/i);
  });

  it('indexe le texte lisible d’un PDF simple et ignore le binaire', () => {
    const pdf = Buffer.from('BT (Marge nette 12 pour cent) Tj ET', 'latin1');
    expect(extractPdfText(pdf)).toMatch(/Marge nette/);
    expect(extractPdfText(Buffer.from([0, 1, 2, 3]))).toBe('');
  });
});

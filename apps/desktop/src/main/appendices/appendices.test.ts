import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolManager, type ConfirmationRequest } from '@jarvis/core';
import { createAppendiceTools } from '../tools/appendices.js';
import { startFakeAppendice, type FakeAppendice } from './fakeAppendice.testkit.js';
import { AppendiceService, type AppendiceServiceOptions, type TokenCipher } from './service.js';
import { AppendiceStore } from './store.js';

/** Faux chiffrement : assez pour vérifier que le jeton n'est jamais écrit en clair. */
const cipher: TokenCipher = {
  available: () => true,
  seal: (plain) => Buffer.from(`scelle:${plain.split('').reverse().join('')}`, 'utf8').toString('base64'),
  open: (sealed) => Buffer.from(sealed, 'base64').toString('utf8').slice('scelle:'.length).split('').reverse().join(''),
};
const noCipher: TokenCipher = {
  available: () => false,
  seal: () => {
    throw new Error('pas de chiffrement');
  },
  open: () => {
    throw new Error('pas de chiffrement');
  },
};

const dirs: string[] = [];
const fakes: FakeAppendice[] = [];

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-appendices-'));
  dirs.push(dir);
  return dir;
}

async function fake(options: Parameters<typeof startFakeAppendice>[0] = {}): Promise<FakeAppendice> {
  const started = await startFakeAppendice(options);
  fakes.push(started);
  return started;
}

function service(dir: string, options: Partial<AppendiceServiceOptions> = {}): AppendiceService {
  return new AppendiceService(AppendiceStore.inUserData(() => dir), {
    allowed: true,
    cipher,
    client: { requestTimeoutMs: 800, actionTimeoutMs: 800 },
    ...options,
  });
}

/** Service prêt : registre activé, un faux bras relié. */
async function ready(options: Partial<AppendiceServiceOptions> = {}) {
  const dir = folder();
  const arm = await fake();
  const svc = service(dir, options);
  await svc.load();
  await svc.setEnabled(true);
  const added = await svc.add({ baseUrl: arm.origin, token: arm.token });
  expect(added.ok).toBe(true);
  const record = svc.resolve('Faux bras');
  if ('error' in record) throw new Error(record.error);
  return { dir, arm, svc, record };
}

afterEach(async () => {
  await Promise.all(fakes.splice(0).map((item) => item.close().catch(() => undefined)));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('registre des appendices', () => {
  it('coupé par défaut : rien de disponible, aucune requête', async () => {
    const dir = folder();
    const arm = await fake();
    const svc = service(dir);
    await svc.load();
    expect(svc.status()).toMatchObject({ allowed: true, enabled: false, appendices: [] });
    expect(svc.available()).toBe(false);
    await svc.refresh();
    expect(arm.requests).toEqual([]);
  });

  it('hors de Jarvis Test : rien n’existe, rien ne s’ajoute, rien ne s’arrête', async () => {
    const dir = folder();
    const arm = await fake();
    const svc = service(dir, { allowed: false });
    await svc.load();
    await svc.setEnabled(true);
    expect(await svc.add({ baseUrl: arm.origin, token: arm.token })).toEqual({ ok: false, sentence: expect.stringContaining('Jarvis Test') });
    expect(svc.status()).toMatchObject({ allowed: false, enabled: false, appendices: [] });
    expect(svc.available()).toBe(false);
    expect(svc.canStop()).toBe(false);
    expect(await svc.stopAll()).toBeNull();
    expect(arm.requests).toEqual([]);
  });

  it('relie un appendice : présentation lue avec le jeton, jeton jamais écrit en clair', async () => {
    const { dir, arm, svc } = await ready();
    expect(arm.paths()).toEqual(['GET /api/hello']);
    expect(svc.available()).toBe(true);
    expect(svc.status().appendices).toEqual([
      expect.objectContaining({ id: 'faux-bras', genre: 'bras', nom: 'Faux bras', piece: 'établi', risque: 'bouger', hasToken: true }),
    ]);
    const onDisk = readFileSync(join(dir, 'appendices.json'), 'utf8');
    expect(onDisk).not.toContain(arm.token);
    expect(onDisk).toContain('"tokenSealed"');
    expect(JSON.stringify(svc.status())).not.toContain(arm.token);
  });

  it('refuse une adresse hors de la maison, un mauvais jeton, un autre contrat', async () => {
    const dir = folder();
    const arm = await fake();
    const svc = service(dir);
    await svc.load();
    await svc.setEnabled(true);
    expect(await svc.add({ baseUrl: 'http://example.com:8770', token: arm.token })).toMatchObject({ ok: false, sentence: expect.stringContaining('réseau local') });
    expect(arm.requests).toEqual([]);
    expect(await svc.add({ baseUrl: arm.origin, token: 'mauvais-jeton-123' })).toMatchObject({ ok: false, sentence: expect.stringContaining('refuse le jeton') });
    expect(await svc.add({ baseUrl: arm.origin, token: '' })).toMatchObject({ ok: false });
    const future = await fake({ hello: { contrat: 2 } });
    expect(await svc.add({ baseUrl: future.origin, token: future.token })).toMatchObject({ ok: false, sentence: expect.stringContaining('version 2') });
    expect(svc.status().appendices).toEqual([]);
  });

  it('retrouve ses appendices et leur jeton après un redémarrage', async () => {
    const { dir, arm } = await ready();
    const again = service(dir);
    await again.load();
    expect(again.status()).toMatchObject({ enabled: true, appendices: [expect.objectContaining({ id: 'faux-bras', hasToken: true })] });
    const record = again.resolve('faux-bras');
    if ('error' in record) throw new Error(record.error);
    expect((await again.action(record, 'saisir', {})).ok).toBe(true);
    expect(arm.paths()).toContain('POST /api/saisir');
  });

  it('sans chiffrement : le jeton reste en mémoire, et il faut le redonner après un redémarrage', async () => {
    const { dir, arm } = await ready({ cipher: noCipher });
    expect(readFileSync(join(dir, 'appendices.json'), 'utf8')).not.toContain('tokenSealed');
    const again = service(dir, { cipher: noCipher });
    await again.load();
    expect(again.status().appendices[0]).toMatchObject({ id: 'faux-bras', hasToken: false });
    const record = again.resolve('faux-bras');
    if ('error' in record) throw new Error(record.error);
    const result = await again.action(record, 'saisir', {});
    expect(result).toMatchObject({ ok: false, outcome: 'missing_dependency', content: expect.stringContaining('jeton') });
    expect(arm.paths()).not.toContain('POST /api/saisir');
  });

  it('retire un appendice ; relit l’état sur demande et dit celui qui ne répond pas', async () => {
    const { arm, svc } = await ready();
    expect((await svc.refresh()).appendices[0]).toMatchObject({ etat: 'pret', reachable: true });
    arm.mute = true;
    const silent = (await svc.refresh()).appendices[0];
    expect(silent).toMatchObject({ reachable: false });
    expect(silent?.error).toBeTruthy();
    expect((await svc.remove('faux-bras')).appendices).toEqual([]);
    expect(svc.available()).toBe(false);
  });
});

describe('actions d’un appendice : résultat clair', () => {
  it('« terminé » avec une mesure est une réussite', async () => {
    const { arm, svc, record } = await ready();
    arm.nextMeasure = { ouverture_mm: 12 };
    const result = await svc.action(record, 'saisir', { force: 2 });
    expect(result).toMatchObject({ ok: true, outcome: 'success', content: expect.stringContaining('terminé') });
    expect(arm.requests.at(-1)).toMatchObject({ path: '/api/saisir', authorization: `Bearer ${arm.token}`, body: { force: 2, attendre: true } });
  });

  it('« terminé » sans mesure n’est jamais dit comme fait', async () => {
    const { arm, svc, record } = await ready();
    arm.nextMeasure = undefined;
    const result = await svc.action(record, 'saisir', {});
    expect(result).toMatchObject({ ok: false, outcome: 'recoverable', content: expect.stringContaining('Je ne peux pas dire que c’est fait') });
  });

  it('bloqué est dit tel quel ; une capacité inconnue ne part pas', async () => {
    const { arm, svc, record } = await ready();
    arm.nextStatus = 'bloque';
    expect(await svc.action(record, 'saisir', {})).toMatchObject({ ok: false, outcome: 'definitive', content: expect.stringContaining('bloqué') });
    const before = arm.requests.length;
    expect(await svc.action(record, 'voler', {})).toMatchObject({ ok: false, outcome: 'definitive', content: expect.stringContaining('ne sait pas faire') });
    expect(arm.requests.length).toBe(before);
  });

  it('une action qui dure encore : arrêt envoyé par précaution', async () => {
    const { arm, svc, record } = await ready();
    arm.nextStatus = 'en_cours';
    const result = await svc.action(record, 'saisir', {});
    expect(result).toMatchObject({ ok: false, outcome: 'timeout' });
    expect(arm.stops).toBe(1);
  });

  it('tour annulé au milieu d’une action : stop envoyé avant de rendre la main', async () => {
    const { arm, svc, record } = await ready({ cipher, client: { requestTimeoutMs: 800, actionTimeoutMs: 5_000 } });
    arm.actionDelayMs = 3_000;
    const controller = new AbortController();
    const pending = svc.action(record, 'saisir', {}, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 80));
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ ok: false, outcome: 'cancelled' });
    expect(arm.stops).toBe(1);
    expect(arm.done.at(-1)).toMatchObject({ statut: 'interrompu' });
  });

  it('appendice trop lent : délai dépassé, stop envoyé', async () => {
    const { arm, svc, record } = await ready({ cipher, client: { requestTimeoutMs: 800, actionTimeoutMs: 120 } });
    arm.actionDelayMs = 3_000;
    const result = await svc.action(record, 'saisir', {});
    expect(result).toMatchObject({ ok: false, outcome: 'timeout', content: expect.stringContaining('arrêt a été envoyé') });
    expect(arm.stops).toBe(1);
  });

  it('lien coupé pendant un ordre : dit, sans prétendre que c’est fait', async () => {
    const { arm, svc, record } = await ready();
    arm.mute = true;
    const result = await svc.action(record, 'saisir', {});
    expect(result).toMatchObject({ ok: false, outcome: 'recoverable', content: expect.stringContaining('Impossible de joindre') });
  });
});

describe('stop et arrêt d’urgence', () => {
  it('le stop part sans accord et se dit', async () => {
    const { arm, svc, record } = await ready();
    expect(await svc.stopOne(record)).toEqual({ name: 'Faux bras (établi)', ok: true });
    expect(arm.stops).toBe(1);
  });

  it('arrêt d’urgence : relu sur l’appendice, tout ordre refusé, puis relâché avec le jeton', async () => {
    const { arm, svc, record } = await ready();
    expect(await svc.emergency(record, true)).toMatchObject({ ok: true, content: expect.stringContaining('relu') });
    expect(arm.emergency).toBe(true);
    expect(await svc.action(record, 'saisir', {})).toMatchObject({ ok: false, outcome: 'definitive', content: expect.stringContaining('refusé') });
    expect(arm.done).toEqual([]);
    expect(await svc.emergency(record, false)).toMatchObject({ ok: true });
    expect(arm.emergency).toBe(false);
    expect(arm.requests.at(-2)).toMatchObject({ path: '/api/arret_urgence', authorization: `Bearer ${arm.token}`, body: { actif: false } });
  });

  it('appendice muet : l’arrêt d’urgence renvoie au bouton physique', async () => {
    const { arm, svc, record } = await ready();
    arm.mute = true;
    expect(await svc.emergency(record, true)).toMatchObject({ ok: false, content: expect.stringContaining('bouton d’arrêt d’urgence') });
  });

  it('« arrête tout » : chaque appendice et le robot, en parallèle ; un muet est nommé', async () => {
    let robotStops = 0;
    const { arm, svc } = await ready({
      extraStops: [
        { name: 'Robot', configured: () => true, stop: async () => void (robotStops += 1) },
        { name: 'Imprimante', configured: () => false, stop: async () => void (robotStops += 100) },
      ],
    });
    const lamp = await fake({ genre: 'main', nom: 'Fausse lampe', id: 'fausse-lampe' });
    expect((await svc.add({ baseUrl: lamp.origin, token: lamp.token })).ok).toBe(true);
    lamp.mute = true;
    const results = await svc.stopAll();
    expect(results).toEqual([
      { name: 'Faux bras (établi)', ok: true },
      { name: 'Fausse lampe (établi)', ok: false, detail: expect.any(String) },
      { name: 'Robot', ok: true },
    ]);
    expect(arm.stops).toBe(1);
    expect(robotStops).toBe(1);
  });

  it('rien à arrêter : null, la phrase suivra le chemin d’avant', async () => {
    const svc = service(folder());
    await svc.load();
    expect(await svc.stopAll()).toBeNull();
    expect(svc.canStop()).toBe(false);
  });

  it('registre coupé avec un appendice inscrit : l’arrêt passe quand même', async () => {
    const { arm, svc } = await ready();
    await svc.setEnabled(false);
    expect(svc.available()).toBe(false);
    expect(svc.canStop()).toBe(true);
    expect(await svc.stopAll()).toEqual([{ name: 'Faux bras (établi)', ok: true }]);
    expect(arm.stops).toBe(1);
  });
});

describe('outils des appendices', () => {
  function manager(svc: AppendiceService) {
    return new ToolManager().registerAll(createAppendiceTools(svc));
  }

  it('absents du catalogue tant que rien n’est relié ou que le registre est coupé', async () => {
    const svc = service(folder());
    await svc.load();
    expect(manager(svc).schemas()).toEqual([]);
    const { svc: linked } = await ready();
    expect(manager(linked).schemas().map((schema) => schema.name)).toEqual([
      'appendices_etat',
      'appendice_action',
      'appendices_stop',
      'appendice_arret_urgence',
      'appendice_relacher_urgence',
    ]);
    await linked.setEnabled(false);
    // Registre coupé : seul l'arrêt reste, parce qu'un appendice est encore inscrit.
    expect(manager(linked).schemas().map((schema) => schema.name)).toEqual(['appendices_stop']);
  });

  it('chaque action demande une carte, même si toutes les politiques sont relâchées', async () => {
    const { arm, svc } = await ready();
    const asked: ConfirmationRequest[] = [];
    const tools = manager(svc);
    const refused = await tools.execute(
      { id: 'c1', name: 'appendice_action', arguments: { appendice: 'Faux bras', capacite: 'saisir', parametres: { force: 2 } } },
      {
        policies: { apps: 'never', files: 'never', capture: 'never', shell: 'never' },
        requestConfirmation: async (request) => {
          asked.push(request);
          return false;
        },
      },
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]?.command).toBe(`POST ${arm.origin}/api/saisir {"force":2}`);
    expect(refused.status).not.toBe('ok');
    expect(arm.paths()).not.toContain('POST /api/saisir');

    const accepted = await tools.execute(
      { id: 'c2', name: 'appendice_action', arguments: { appendice: 'faux-bras', capacite: 'saisir' } },
      { requestConfirmation: async () => true },
    );
    expect(accepted.status).toBe('ok');
    expect(arm.paths()).toContain('POST /api/saisir');
  });

  it('lire l’état, arrêter et l’arrêt d’urgence n’attendent aucune carte ; relâcher en demande une', async () => {
    const { arm, svc } = await ready();
    const tools = manager(svc);
    let cards = 0;
    const context = {
      requestConfirmation: async () => {
        cards += 1;
        return false;
      },
    };
    const state = await tools.execute({ id: 'e1', name: 'appendices_etat', arguments: {} }, context);
    expect(state).toMatchObject({ status: 'ok', content: expect.stringContaining('Faux bras (établi) : prêt') });
    expect(state.content).toContain('saisir');
    const stop = await tools.execute({ id: 'e2', name: 'appendices_stop', arguments: {} }, context);
    expect(stop).toMatchObject({ status: 'ok', content: 'Arrêt envoyé : Faux bras (établi).' });
    const emergency = await tools.execute({ id: 'e3', name: 'appendice_arret_urgence', arguments: { appendice: 'Faux bras' } }, context);
    expect(emergency.status).toBe('ok');
    expect(cards).toBe(0);
    expect(arm.emergency).toBe(true);
    const release = await tools.execute({ id: 'e4', name: 'appendice_relacher_urgence', arguments: { appendice: 'Faux bras' } }, context);
    expect(cards).toBe(1);
    expect(release.status).not.toBe('ok');
    expect(arm.emergency).toBe(true);
  });

  it('un nom inconnu ou ambigu est dit, rien ne part', async () => {
    const { arm, svc } = await ready();
    const second = await fake({ id: 'faux-bras-2', nom: 'Faux bras', piece: 'bureau' });
    await svc.add({ baseUrl: second.origin, token: second.token });
    const tools = manager(svc);
    const context = { requestConfirmation: async () => true };
    const unknown = await tools.execute({ id: 'n1', name: 'appendice_action', arguments: { appendice: 'Grue', capacite: 'saisir' } }, context);
    expect(unknown).toMatchObject({ content: expect.stringContaining('Aucun appendice ne s’appelle') });
    const twin = await tools.execute({ id: 'n2', name: 'appendice_action', arguments: { appendice: 'Faux bras', capacite: 'saisir' } }, context);
    expect(twin).toMatchObject({ content: expect.stringContaining('Plusieurs appendices') });
    expect(arm.paths()).not.toContain('POST /api/saisir');
    expect(second.paths()).not.toContain('POST /api/saisir');
  });
});

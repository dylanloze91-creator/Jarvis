import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolManager, parseSettings, type Settings, type ToolContext } from '@jarvis/core';
import { RoverClient } from '../rover/RoverClient.js';
import { FAKE_ROVER_TOKEN, FakeRover } from '../rover/fakeRover.testkit.js';
import { createRoverTools, ROVER_NOT_CONFIGURED_MESSAGE } from './rover.js';

const NEVER = { apps: 'never', files: 'never', capture: 'never', shell: 'never' } as const;

let fake: FakeRover;
let baseUrl: string;

beforeEach(async () => {
  fake = new FakeRover();
  baseUrl = await fake.start();
});

afterEach(async () => {
  await fake.stop();
});

function setup(values: Partial<Settings> = {}, options: ConstructorParameters<typeof RoverClient>[1] = {}) {
  let settings = parseSettings({ roverBaseUrl: baseUrl, roverToken: FAKE_ROVER_TOKEN, ...values });
  const client = new RoverClient(() => settings, options);
  const manager = new ToolManager().registerAll(createRoverTools(client));
  return {
    client,
    manager,
    set: (next: Partial<Settings>) => {
      settings = parseSettings({ ...settings, ...next });
    },
  };
}

function context(approve = true, extra: Partial<ToolContext> = {}) {
  const asked: string[] = [];
  const ctx: ToolContext = {
    policies: NEVER,
    requestConfirmation: async (request) => {
      asked.push(`${request.toolName}: ${request.details}`);
      return approve;
    },
    ...extra,
  };
  return { ctx, asked };
}

const call = (name: string, args: Record<string, unknown> = {}) => ({ id: `c-${name}`, name, arguments: args });

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('condition jamais remplie');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('outils du robot', () => {
  it('sans adresse : absents du catalogue, un appel reçoit le message de réglage', async () => {
    const { manager } = setup({ roverBaseUrl: '' });
    expect(manager.schemas()).toEqual([]);
    const { ctx, asked } = context();
    const outcome = await manager.execute(call('rover_move', { distanceM: 0.5 }), ctx);
    expect(outcome.content).toBe(ROVER_NOT_CONFIGURED_MESSAGE);
    expect(asked).toEqual([]);
    expect(fake.requests).toEqual([]);
  });

  it('une adresse Internet n’active rien et ne part jamais sur le réseau', async () => {
    const { manager } = setup({ roverBaseUrl: 'https://robot.example.com' });
    expect(manager.schemas()).toEqual([]);
  });

  it('réglé : six outils, mouvements confirmés même avec la politique « jamais »', async () => {
    const { manager } = setup();
    expect(manager.schemas().map((schema) => schema.name)).toEqual([
      'rover_status',
      'rover_move',
      'rover_turn',
      'rover_stop',
      'rover_emergency_stop',
      'rover_release_emergency',
    ]);
    const risks = Object.fromEntries(manager.list().map((tool) => [tool.name, [tool.risk, tool.category ?? null, tool.forceConfirm]]));
    expect(risks).toEqual({
      rover_status: ['safe', null, false],
      rover_move: ['confirm', null, false],
      rover_turn: ['confirm', null, false],
      rover_stop: ['safe', null, false],
      rover_emergency_stop: ['safe', null, false],
      rover_release_emergency: ['confirm', null, true],
    });
  });

  it('avance de 50 cm : carte de confirmation, ordre attendu, distance mesurée rendue', async () => {
    const { manager } = setup();
    const { ctx, asked } = context();
    const outcome = await manager.execute(call('rover_move', { distanceM: 0.5 }), ctx);
    expect(asked).toEqual(['rover_move: Avancer de 50 cm.']);
    expect(outcome.status).toBe('ok');
    expect(outcome.content).toBe('Mouvement terminé (distance mesurée 49,7 cm). Distance atteinte.');
    const order = fake.requests.find((request) => request.path === '/api/avancer')!;
    expect(order.body).toEqual({ distance_m: 0.5, attendre: true });
    expect(order.authorization).toBe(`Bearer ${FAKE_ROVER_TOKEN}`);
  });

  it('virage refusé par l’utilisateur : rien n’est envoyé au robot', async () => {
    const { manager } = setup();
    const { ctx, asked } = context(false);
    const outcome = await manager.execute(call('rover_turn', { angleDeg: -45, reverse: true }), ctx);
    expect(asked).toEqual(['rover_turn: Tourner à droite de 45° en marche arrière.']);
    expect(outcome.status).toBe('denied');
    expect(fake.requests).toEqual([]);
  });

  it('virage à gauche de 90° : paramètres du service', async () => {
    const { manager } = setup();
    const outcome = await manager.execute(call('rover_turn', { angleDeg: 90, speedMS: 0.15 }), context().ctx);
    expect(outcome.status).toBe('ok');
    expect(outcome.content).toContain('virage mesuré 89,6°');
    expect(fake.requests.at(-1)!.body).toEqual({ angle_deg: 90, marche_arriere: false, attendre: true, vitesse_m_s: 0.15 });
  });

  it('stop et arrêt d’urgence partent sans confirmation ; le mouvement suivant est refusé', async () => {
    const { manager } = setup();
    const { ctx, asked } = context();
    expect((await manager.execute(call('rover_stop'), ctx)).status).toBe('ok');
    expect((await manager.execute(call('rover_emergency_stop'), ctx)).status).toBe('ok');
    expect(asked).toEqual([]);
    expect(fake.emergency).toBe(true);
    const refused = await manager.execute(call('rover_move', { distanceM: 0.2 }), ctx);
    expect(refused.status).toBe('error');
    expect(refused.content).toBe("Le robot refuse : Arrêt d'urgence actif : il faut d'abord le relâcher.");
  });

  it('relâcher l’arrêt d’urgence demande toujours confirmation', async () => {
    const { manager } = setup();
    fake.emergency = true;
    const { ctx, asked } = context();
    const outcome = await manager.execute(call('rover_release_emergency'), ctx);
    expect(asked).toEqual(['rover_release_emergency: Relâcher l’arrêt d’urgence du robot.']);
    expect(outcome.status).toBe('ok');
    expect(fake.emergency).toBe(false);
  });

  it('jeton faux : message clair, aucun mouvement', async () => {
    const { manager } = setup({ roverToken: 'mauvais' });
    const outcome = await manager.execute(call('rover_move', { distanceM: 0.5 }), context().ctx);
    expect(outcome.status).toBe('error');
    expect(outcome.content).toContain('Jeton du robot refusé');
    expect(fake.x).toBe(0);
  });

  it('robot bloqué : jamais présenté comme fait', async () => {
    const { manager } = setup();
    fake.nextStatus = 'bloque';
    const outcome = await manager.execute(call('rover_move', { distanceM: 1 }), context().ctx);
    expect(outcome.status).toBe('error');
    expect(outcome.content).toContain('Mouvement bloqué');
    expect(outcome.content).toContain('Roues bloquées');
  });

  it('mouvement rendu « en cours » : arrêt envoyé par précaution', async () => {
    const { manager } = setup();
    fake.nextStatus = 'en_cours';
    const outcome = await manager.execute(call('rover_move', { distanceM: 1 }), context().ctx);
    expect(outcome.status).toBe('error');
    expect(fake.paths()).toContain('POST /api/stop');
  });

  it('tour de chat annulé pendant un mouvement : le robot reçoit un stop', async () => {
    const { manager } = setup();
    fake.movementDelayMs = 500;
    const abort = new AbortController();
    const running = manager.execute(call('rover_move', { distanceM: 1 }), context(true, { signal: abort.signal }).ctx);
    await waitFor(() => fake.paths().includes('POST /api/avancer'));
    abort.abort();
    const outcome = await running;
    expect(outcome.status).toBe('error');
    await waitFor(() => fake.paths().includes('POST /api/stop'));
  });

  it('robot muet : délai dépassé, stop envoyé', async () => {
    const { manager } = setup({}, { movementTimeoutMs: 100 });
    fake.movementDelayMs = 400;
    const outcome = await manager.execute(call('rover_move', { distanceM: 1 }), context().ctx);
    expect(outcome.status).toBe('error');
    expect(outcome.content).toContain('pas répondu à temps');
    await waitFor(() => fake.paths().includes('POST /api/stop'));
  });

  it('état : simulation, batterie et position', async () => {
    const { manager } = setup();
    const outcome = await manager.execute(call('rover_status'), context().ctx);
    expect(outcome.content).toContain('Robot en simulation');
    expect(outcome.content).toContain('Batterie 11,8 V');
  });
});

describe('test de connexion des réglages', () => {
  it('robot joint et jeton accepté', async () => {
    const { client } = setup();
    expect(await client.connectionStatus()).toEqual({
      configured: true,
      reachable: true,
      authorized: true,
      mode: 'simulation',
      version: '0.1.0',
    });
  });

  it('brouillon : jeton faux, jeton absent, robot éteint, adresse vide', async () => {
    const { client } = setup({ roverBaseUrl: '', roverToken: '' });
    expect((await client.connectionStatus({ baseUrl, token: 'faux' })).authorized).toBe(false);
    const missing = await client.connectionStatus({ baseUrl, token: '' });
    expect(missing).toMatchObject({ reachable: true, authorized: false });
    const port = new URL(baseUrl).port;
    await fake.stop();
    const off = await client.connectionStatus({ baseUrl: `http://127.0.0.1:${port}`, token: 'x' });
    expect(off).toMatchObject({ configured: true, reachable: false });
    expect(off.error).toContain('Impossible de joindre le robot');
    expect((await client.connectionStatus({ baseUrl: '' })).configured).toBe(false);
  });
});

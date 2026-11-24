import { ToolManager, MoonrakerClient, PHONE_CANNOT_START, type ToolContext } from '@jarvis/core';
import { describe, expect, it } from 'vitest';
import { FakeMoonraker } from '../../../../../packages/core/src/quotidien/fakeMoonraker.testkit.js';
import { createPrinterTools } from './printer.js';

const LOCAL = 'http://printer.local:7125';

function setup() {
  const fake = new FakeMoonraker();
  const manager = new ToolManager().registerAll(
    createPrinterTools({
      isAvailable: () => true,
      client: () => new MoonrakerClient(LOCAL, '', fake.fetch),
    }),
  );
  return { fake, manager };
}

const allow: ToolContext = { requestConfirmation: async () => true };
const refuse: ToolContext = { requestConfirmation: async () => false };

describe('outils imprimante', () => {
  it('le catalogue les cache si le réglage est absent', () => {
    const { manager } = setup();
    const hidden = new ToolManager().registerAll(
      createPrinterTools({ isAvailable: () => false, client: () => new MoonrakerClient(LOCAL, '', fetch) }),
    );
    expect(hidden.schemas()).toEqual([]);
    expect(manager.schemas().map((schema) => schema.name)).toContain('imprimante_annuler');
  });

  it('annuler ne demande pas de clic, lancer si, une enceinte ne lance pas', async () => {
    const { fake, manager } = setup();
    let asked = 0;
    const watch: ToolContext = {
      requestConfirmation: async () => {
        asked += 1;
        return true;
      },
    };
    const cancelled = await manager.execute({ id: 'c', name: 'imprimante_annuler', arguments: {} }, watch);
    expect(asked).toBe(0);
    expect(cancelled.content).toBe('Impression annulée.');
    const blocked = await manager.execute(
      { id: 's', name: 'imprimante_lancer', arguments: { filename: 'synthetique-test.gcode' } },
      { ...allow, fromSpeaker: true },
    );
    expect(blocked.content).toMatch(/PC ou le téléphone/);
    expect(fake.calls.filter((call) => call.startsWith('POST /printer/print/start'))).toEqual([]);
    const refused = await manager.execute(
      { id: 's2', name: 'imprimante_lancer', arguments: { filename: 'synthetique-test.gcode' } },
      refuse,
    );
    expect(refused.status).not.toBe('ok');
    expect(fake.calls.filter((call) => call.startsWith('POST /printer/print/start'))).toEqual([]);
    const started = await manager.execute(
      { id: 's3', name: 'imprimante_lancer', arguments: { filename: 'synthetique-test.gcode' } },
      allow,
    );
    expect(started.content).toMatch(/lancée/);
    expect(fake.status.state).toBe('printing');
  });

  it('téléphone : lancement et reprise refusés si printer.phoneStart est faux ; absent, comme avant', async () => {
    const fake = new FakeMoonraker();
    let telephone = false;
    const manager = new ToolManager().registerAll(
      createPrinterTools({ isAvailable: () => true, client: () => new MoonrakerClient(LOCAL, '', fake.fetch), phoneMayStart: () => telephone }),
    );
    for (const [name, args] of [
      ['imprimante_lancer', { filename: 'synthetique-test.gcode' }],
      ['imprimante_reprendre', {}],
    ] as const) {
      const blocked = await manager.execute({ id: name, name, arguments: args }, { ...allow, fromPhone: true });
      expect(blocked.content).toBe(PHONE_CANNOT_START);
    }
    expect(fake.calls.filter((call) => /print\/(start|resume)/.test(call))).toEqual([]);
    // La fenêtre du PC n'est pas touchée par ce réglage.
    expect((await manager.execute({ id: 'pc', name: 'imprimante_lancer', arguments: { filename: 'synthetique-test.gcode' } }, allow)).content).toMatch(/lancée/);
    fake.status = { ...fake.status, state: 'standby' };
    telephone = true;
    expect(
      (await manager.execute({ id: 'tel', name: 'imprimante_lancer', arguments: { filename: 'synthetique-test.gcode' } }, { ...allow, fromPhone: true })).content,
    ).toMatch(/lancée/);
  });
});

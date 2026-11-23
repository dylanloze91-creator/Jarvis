import { describe, expect, it } from 'vitest';
import { Rafraichisseur, type Minuterie } from './rafraichir';

function fausseMinuterie() {
  const file: { fn: () => void; ms: number; id: number }[] = [];
  let n = 0;
  const minuterie: Minuterie = {
    plus_tard: (fn, ms) => {
      n += 1;
      file.push({ fn, ms, id: n });
      return n;
    },
    annuler: (id) => {
      const i = file.findIndex((t) => t.id === id);
      if (i >= 0) file.splice(i, 1);
    },
  };
  const avancer = async () => {
    const t = file.shift();
    t?.fn();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { minuterie, file, avancer };
}

const attendre = () => new Promise((r) => setTimeout(r, 0));

describe('écran « Yeux » : rafraîchissement', () => {
  it('demande une image toutes les 2 s tant que l’écran est ouvert et visible', async () => {
    const { minuterie, file, avancer } = fausseMinuterie();
    let demandes = 0;
    const r = new Rafraichisseur(async () => void (demandes += 1), minuterie);
    r.ouvrir(true);
    expect(demandes).toBe(0);
    r.voir(true);
    await attendre();
    expect(demandes).toBe(1);
    expect(file.map((t) => t.ms)).toEqual([2000]);
    await avancer();
    await avancer();
    expect(demandes).toBe(3);
  });

  it('arrête quand la fenêtre est cachée, reprend quand elle revient', async () => {
    const { minuterie, file, avancer } = fausseMinuterie();
    let demandes = 0;
    const r = new Rafraichisseur(async () => void (demandes += 1), minuterie);
    r.ouvrir(true);
    r.voir(true);
    await attendre();
    r.voir(false);
    expect(file).toEqual([]);
    await avancer();
    expect(demandes).toBe(1);
    r.voir(true);
    await attendre();
    expect(demandes).toBe(2);
  });

  it('arrête quand on change d’écran, même pendant une demande en cours', async () => {
    const { minuterie, file } = fausseMinuterie();
    let finir: () => void = () => undefined;
    let demandes = 0;
    const r = new Rafraichisseur(
      () =>
        new Promise<void>((done) => {
          demandes += 1;
          finir = done;
        }),
      minuterie,
    );
    r.ouvrir(true);
    r.voir(true);
    r.voir(true);
    expect(demandes).toBe(1);
    r.ouvrir(false);
    finir();
    await attendre();
    expect(file).toEqual([]);
    expect(demandes).toBe(1);
  });

  it('jamais deux demandes à la fois, et une erreur ne casse pas la suite', async () => {
    const { minuterie, avancer } = fausseMinuterie();
    let demandes = 0;
    const r = new Rafraichisseur(async () => {
      demandes += 1;
      throw new Error('caméra');
    }, minuterie);
    r.voir(true);
    r.ouvrir(true);
    r.ouvrir(true);
    await attendre();
    expect(demandes).toBe(1);
    await avancer();
    expect(demandes).toBe(2);
  });
});

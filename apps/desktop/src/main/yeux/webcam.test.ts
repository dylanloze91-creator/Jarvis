import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowPermissionCheck, allowPermissionRequest } from '../mediaPermissions.js';
import { creerWebcam, scriptOuverture, SCRIPT_APPAREILS, SCRIPT_IMAGE, type FenetreCapture } from './webcam.js';

vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: () => ({}) } }));
const { webcamAutorise } = await import('./webcamFenetre.js');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(500).fill(3), 0xff, 0xd9]).toString('base64');

function fausseFenetre(reponses: Partial<Record<'ouverture' | 'image' | 'appareils', () => Promise<unknown>>> = {}) {
  const journal: string[] = [];
  let ouvertes = 0;
  let fermees = 0;
  const ouvrir = (): FenetreCapture => {
    ouvertes += 1;
    return {
      executer: (script) => {
        if (script === SCRIPT_IMAGE) {
          journal.push('image');
          return reponses.image ? reponses.image() : Promise.resolve(JPEG);
        }
        if (script === SCRIPT_APPAREILS) {
          journal.push('appareils');
          return reponses.appareils ? reponses.appareils() : Promise.resolve([{ id: 'abc', nom: 'C922' }]);
        }
        journal.push('ouverture');
        return reponses.ouverture ? reponses.ouverture() : Promise.resolve('ouvert');
      },
      fermer: () => {
        fermees += 1;
      },
    };
  };
  return { ouvrir, journal, compte: () => ({ ouvertes, fermees }) };
}

afterEach(() => vi.useRealTimers());

describe('webcam du PC (fenêtre cachée dédiée)', () => {
  it('une photo : ouvre, prend une image JPEG, puis ferme 5 s après (voyant éteint)', async () => {
    vi.useFakeTimers();
    const f = fausseFenetre();
    const webcam = creerWebcam(f.ouvrir, { maintenant: () => 42 });
    const r = await webcam.photo(undefined, 'Webcam du PC');
    expect(r.ok && r.photo).toMatchObject({ type: 'image/jpeg', prisA: 42, camera: 'Webcam du PC' });
    expect(webcam.regarde()).toBe(true);
    expect(f.compte()).toEqual({ ouvertes: 1, fermees: 0 });
    vi.advanceTimersByTime(5_000);
    expect(webcam.regarde()).toBe(false);
    expect(f.compte()).toEqual({ ouvertes: 1, fermees: 1 });
  });

  it("l'écran « Yeux » ouvert : la même fenêtre sert les photos suivantes", async () => {
    const f = fausseFenetre();
    const webcam = creerWebcam(f.ouvrir);
    await webcam.photo(undefined, 'W');
    await webcam.photo(undefined, 'W');
    expect(f.compte().ouvertes).toBe(1);
    webcam.fermer();
    expect(f.compte().fermees).toBe(1);
  });

  it('refus de Windows, webcam absente ou prise, délai : une raison, et la fenêtre est fermée', async () => {
    const cas: [() => Promise<unknown>, string][] = [
      [() => Promise.reject(new Error('NotAllowedError: Permission denied')), 'Windows refuse la webcam à Jarvis (Confidentialité → Caméra).'],
      [() => Promise.reject(new Error('NotFoundError: Requested device not found')), 'Webcam introuvable : elle est débranchée, ou une autre a été choisie.'],
      [() => Promise.reject(new Error('NotReadableError: Could not start video source')), 'La webcam est déjà prise par une autre application.'],
      [() => new Promise(() => undefined), 'La webcam ne répond pas (plus de 5 secondes).'],
    ];
    for (const [ouverture, raison] of cas) {
      const f = fausseFenetre({ ouverture });
      const r = await creerWebcam(f.ouvrir, { delaiMs: 50 }).photo(undefined, 'W');
      expect(r).toEqual({ ok: false, raison });
      expect(f.compte().fermees).toBe(1);
    }
  });

  it("refuse ce qui n'est pas une image JPEG", async () => {
    const f = fausseFenetre({ image: () => Promise.resolve(Buffer.from('<html>').toString('base64')) });
    expect(await creerWebcam(f.ouvrir).photo(undefined, 'W')).toEqual({ ok: false, raison: "La webcam n'a pas donné une image." });
    const g = fausseFenetre({ image: () => Promise.resolve(42) });
    expect((await creerWebcam(g.ouvrir).photo(undefined, 'W')).ok).toBe(false);
  });

  it("l'identifiant de l'appareil n'entre dans le script que par JSON.stringify ; jamais de micro", () => {
    const piege = "x'); fetch('http://ailleurs'); ('";
    const script = scriptOuverture(piege);
    expect(script).toContain(JSON.stringify(piege));
    expect(script).toContain('"audio":false');
    expect(script).not.toContain("fetch('http://ailleurs')\n");
  });

  it('liste des webcams : identifiant et nom seulement', async () => {
    const f = fausseFenetre({ appareils: () => Promise.resolve([{ id: 'a', nom: 'C922' }, { id: 3 }, null]) });
    expect(await creerWebcam(f.ouvrir).appareils()).toEqual([{ id: 'a', nom: 'C922' }]);
  });

  it('la fenêtre de la webcam n’accorde que la vidéo ; la fenêtre de Jarvis refuse toujours la caméra', () => {
    expect(webcamAutorise('media', ['video'])).toBe(true);
    expect(webcamAutorise('media', ['video', 'audio'])).toBe(false);
    expect(webcamAutorise('media', ['audio'])).toBe(false);
    expect(webcamAutorise('media', [])).toBe(false);
    expect(webcamAutorise('notifications', ['video'])).toBe(false);
    expect(allowPermissionRequest('media', { mediaTypes: ['video'], requestingUrl: 'file:///index.html' })).toBe(false);
    expect(allowPermissionCheck('media', 'video')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  OeilReseau,
  pieceInterdite,
  prendrePhotoOeil,
  trouverOeil,
  verifierOeil,
  YEUX_PREVUS,
  type Oeil,
} from './contrat.js';
import { FakeOeil, FAUX_JPEG } from './fakeOeil.testkit.js';
import { intentionYeux } from './phrases.js';
import { repondreYeux } from './reponse.js';

function faux(): FakeOeil {
  return new FakeOeil('http://faux-oeil.local:8770', 'secret', 'Rover avant');
}

const reseau = (adresse: string, extra: Partial<Oeil> = {}): Oeil => ({
  id: 'rover-avant',
  nom: 'Rover avant',
  piece: 'mobile',
  genre: 'reseau',
  allume: true,
  adresse,
  ...extra,
});

describe('contrat d’un œil', () => {
  it('jamais de caméra dans une chambre', () => {
    for (const piece of ['chambre', 'Chambre d’amis', 'ma chambre', 'CHAMBRES']) expect(pieceInterdite(piece), piece).toBe(true);
    for (const piece of ['bureau', 'salon', 'atelier', 'antichambre']) expect(pieceInterdite(piece), piece).toBe(false);
    expect(verifierOeil({ id: 'cam', nom: 'Cam', piece: 'Chambre', genre: 'pc', allume: false })).toEqual({
      ok: false,
      raison: 'Jamais de caméra dans une chambre : refusé.',
    });
    expect(verifierOeil({ id: 'cam', nom: 'Chambre', piece: 'bureau', genre: 'pc', allume: false }).ok).toBe(false);
  });

  it('un œil incomplet ou hors réseau local est refusé ; un œil correct est gardé', () => {
    expect(verifierOeil({ id: 'x', nom: '', piece: 'bureau', genre: 'pc', allume: true }).ok).toBe(false);
    expect(verifierOeil({ id: 'cam', nom: 'Cam', piece: 'bureau', genre: 'drone', allume: true }).ok).toBe(false);
    expect(verifierOeil(reseau('http://8.8.8.8:8770')).ok).toBe(false);
    const ok = verifierOeil(reseau('http://192.168.1.50:8770/'));
    expect(ok.ok && ok.oeil.adresse).toBe('http://192.168.1.50:8770');
  });

  it('les yeux prévus (rover, hub) existent sans adresse : « pas encore branché »', async () => {
    expect(YEUX_PREVUS.map((o) => o.id)).toEqual(['rover-avant', 'rover-pince', 'hub']);
    expect(await prendrePhotoOeil(YEUX_PREVUS[2]!, {})).toEqual({ ok: false, raison: '« Hub » n\'est pas encore branché.' });
  });

  it('œil coupé : aucune prise, la raison est dite', async () => {
    const f = faux();
    const r = await prendrePhotoOeil(reseau(f.url, { allume: false }), { reseau: (o) => new OeilReseau(o.adresse!, 'secret', f.fetch) });
    expect(r).toEqual({ ok: false, raison: 'La caméra « Rover avant » est coupée.' });
    expect(f.requetes).toEqual([]);
  });

  it('faux œil réseau : hello, photo avec le jeton, GET seulement, témoin allumé pendant la prise', async () => {
    const f = faux();
    const client = new OeilReseau(f.url, 'secret', f.fetch);
    expect(await client.hello()).toEqual({ nom: 'Rover avant', version: '1.0.0' });
    const r = await prendrePhotoOeil(reseau(f.url), { reseau: () => client });
    expect(r.ok && r.photo.octets).toEqual(FAUX_JPEG);
    expect(r.ok && r.photo.camera).toBe('Rover avant');
    expect(f.temoinAllume).toBe(1);
    expect(f.requetes.map((q) => `${q.methode} ${q.chemin}`)).toEqual(['GET /api/oeil/hello', 'GET /api/oeil/photo']);
    expect(f.requetes.every((q) => q.autorisation === 'Bearer secret')).toBe(true);
  });

  it('faux œil réseau : mauvais jeton, délai, erreur, pas une image', async () => {
    const f = faux();
    expect(await new OeilReseau(f.url, 'faux', f.fetch).photo('Rover')).toEqual({ ok: false, raison: 'La caméra a refusé la clé.' });
    await expect(new OeilReseau(f.url, 'faux', f.fetch).hello()).rejects.toThrow('La caméra a répondu 401.');
    f.mode = 'muet';
    expect(await new OeilReseau(f.url, 'secret', f.fetch, 200).photo('Rover')).toEqual({ ok: false, raison: 'La caméra ne répond pas (plus de 5 secondes).' });
    f.mode = 'erreur';
    expect(await new OeilReseau(f.url, 'secret', f.fetch).photo('Rover')).toEqual({ ok: false, raison: 'La caméra a répondu 503.' });
    f.mode = 'redirection';
    expect(await new OeilReseau(f.url, 'secret', f.fetch).photo('Rover')).toEqual({ ok: false, raison: 'La caméra a renvoyé ailleurs : refusé.' });
    f.mode = 'html';
    expect(await new OeilReseau(f.url, 'secret', f.fetch).photo('Rover')).toEqual({ ok: false, raison: "La caméra n'a pas envoyé une image (JPEG ou PNG)." });
    expect(() => new OeilReseau('http://8.8.8.8', 'secret')).toThrow(/réseau local/);
  });

  it('webcam du PC et iPhone : par leurs moyens à eux, ou une raison', async () => {
    const pc: Oeil = { id: 'bureau', nom: 'Bureau', piece: 'bureau', genre: 'pc', allume: true };
    const iphone: Oeil = { id: 'iphone', nom: 'iPhone', piece: 'mobile', genre: 'telephone', allume: true };
    expect((await prendrePhotoOeil(pc, {})).ok).toBe(false);
    expect(await prendrePhotoOeil(iphone, { telephone: () => null })).toMatchObject({ ok: false });
    const photo = { octets: FAUX_JPEG, type: 'image/jpeg' as const, prisA: 1, taille: FAUX_JPEG.length, camera: 'x' };
    const r = await prendrePhotoOeil(iphone, { telephone: () => photo });
    expect(r.ok && r.photo.camera).toBe('iPhone');
    const w = await prendrePhotoOeil(pc, { pc: async () => ({ ok: true, photo }) });
    expect(w.ok && w.photo.camera).toBe('Bureau');
  });

  it('les phrases désignent un œil par son nom, sa pièce ou son genre', () => {
    const yeux: Oeil[] = [
      { id: 'imprimante', nom: 'Imprimante', piece: 'atelier', genre: 'klipper', allume: true },
      { id: 'bureau', nom: 'Bureau', piece: 'bureau', genre: 'pc', allume: true },
      { id: 'iphone', nom: 'iPhone', piece: 'mobile', genre: 'telephone', allume: true },
      ...YEUX_PREVUS,
    ];
    const vise = (phrase: string) => {
      const i = intentionYeux(phrase);
      return i ? (trouverOeil(i.cible, yeux)?.id ?? null) : null;
    };
    expect(vise('Montre-moi le bureau')).toBe('bureau');
    expect(vise('Montre-moi la caméra du bureau')).toBe('bureau');
    expect(vise('Montre-moi la webcam')).toBe('bureau');
    expect(vise('Jarvis, montre-moi la caméra du rover avant')).toBe('rover-avant');
    expect(vise('Montre-moi le hub')).toBe('hub');
    expect(vise("Montre-moi l'iPhone")).toBe('iphone');
    expect(vise("Montre-moi la caméra de l'imprimante")).toBe('imprimante');
    expect(vise('Montre-moi la cuisine')).toBeNull();
  });

  it('« montre-moi le rover avant » : photo dans la discussion, phrase courte à l’enceinte', async () => {
    const f = faux();
    const oeil = reseau(f.url);
    const deps = { reseau: (o: Oeil) => new OeilReseau(o.adresse!, 'secret', f.fetch) };
    const fenetre = await repondreYeux({ texte: 'Montre-moi le rover avant', lieu: 'fenetre', yeux: [oeil] }, deps);
    expect(fenetre?.photo).not.toBeNull();
    expect(fenetre?.texte).toMatch(/^Rover avant : photo prise à \d+ h \d{2} min \d{2} s\.$/);
    const enceinte = await repondreYeux({ texte: 'Montre-moi le rover avant', lieu: 'enceinte', yeux: [oeil] }, deps);
    expect(enceinte?.texte).toBe('La photo est sur le PC.');
    const pasBranche = await repondreYeux({ texte: 'Montre-moi le hub', lieu: 'fenetre', yeux: [...YEUX_PREVUS] }, deps);
    expect(pasBranche).toMatchObject({ photo: null, texte: '« Hub » n\'est pas encore branché.' });
  });
});

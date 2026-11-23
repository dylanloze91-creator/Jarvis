import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { lectureSeule, typeDesOctets, YeuxImprimante, type EtatYeux } from './imprimante.js';
import { trouverOeil } from './contrat.js';
import { etatCarte, heurePhoto, imageFigee, intentionYeux, phraseEnceinte, phraseEtat } from './phrases.js';
import { repondreYeux } from './reponse.js';
import type { Oeil } from './contrat.js';

const IMPRIMANTE: Oeil = { id: 'imprimante', nom: 'Imprimante', piece: 'atelier', genre: 'klipper', allume: true };
const YEUX = [IMPRIMANTE];

/** Une petite « image » JPEG : seuls les premiers octets comptent pour le contrôle du type. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(4000).fill(7), 0xff, 0xd9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(1)]);

type Camera = (req: IncomingMessage, res: ServerResponse) => void;

interface Faux {
  url: string;
  methodes: string[];
  chemins: string[];
  server: Server;
}

const serveurs: Server[] = [];
afterEach(async () => {
  for (const s of serveurs.splice(0)) await new Promise<void>((done) => s.close(() => done()));
});

/** Faux Moonraker + fausse caméra sur le même port local. */
async function fauxMoonraker(options: {
  camera?: Camera;
  webcams?: (base: string) => unknown[];
  etat?: Record<string, unknown>;
  file?: { filename: string }[];
} = {}): Promise<Faux> {
  const methodes: string[] = [];
  const chemins: string[] = [];
  let base = '';
  const server = createServer((req, res) => {
    methodes.push(req.method ?? '');
    chemins.push(req.url ?? '');
    const url = req.url ?? '';
    if (url.startsWith('/server/webcams/list')) {
      const webcams = options.webcams ? options.webcams(base) : [{ name: 'cam', enabled: true, snapshot_url: `${base}/snap` }];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ result: { webcams } }));
      return;
    }
    if (url.startsWith('/printer/objects/query')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ result: { status: options.etat ?? ETAT_IMPRESSION } }));
      return;
    }
    if (url.startsWith('/server/job_queue/status')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ result: { queued_jobs: options.file ?? [], queue_state: 'paused' } }));
      return;
    }
    if (url.startsWith('/snap')) {
      (options.camera ?? envoyer(JPEG, 'image/jpeg'))(req, res);
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  serveurs.push(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url: base, methodes, chemins, server };
}

function envoyer(octets: Uint8Array, type: string, avecTaille = true): Camera {
  return (_req, res) => {
    res.setHeader('content-type', type);
    if (avecTaille) res.setHeader('content-length', String(octets.byteLength));
    res.end(Buffer.from(octets));
  };
}

const ETAT_IMPRESSION = {
  print_stats: { state: 'printing', filename: 'bac.gcode', print_duration: 3000, total_duration: 3100, info: { current_layer: 12, total_layer: 80 } },
  virtual_sdcard: { progress: 0.5 },
  extruder: { temperature: 215.2, target: 215 },
  heater_bed: { temperature: 60.1, target: 60 },
  webhooks: { state: 'ready' },
};

describe('yeux : prendre une photo (lecture seule)', () => {
  it('prend une photo JPEG en mémoire, avec son heure', async () => {
    const faux = await fauxMoonraker();
    const yeux = new YeuxImprimante(faux.url, '', fetch, 5_000, () => 1_700_000_000_000);
    const r = await yeux.prendrePhoto();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.photo.type).toBe('image/jpeg');
    expect(r.photo.taille).toBe(JPEG.byteLength);
    expect(r.photo.prisA).toBe(1_700_000_000_000);
    expect(r.photo.camera).toBe('cam');
  });

  it('accepte un PNG, et lit une image sans taille annoncée', async () => {
    const faux = await fauxMoonraker({ camera: envoyer(PNG, 'image/png', false) });
    const r = await new YeuxImprimante(faux.url).prendrePhoto();
    expect(r.ok && r.photo.type).toBe('image/png');
  });

  it('refuse une image trop grande, annoncée ou non', async () => {
    const gros = new Uint8Array(5 * 1024 * 1024 + 10);
    gros.set([0xff, 0xd8, 0xff]);
    for (const avecTaille of [true, false]) {
      const faux = await fauxMoonraker({ camera: envoyer(gros, 'image/jpeg', avecTaille) });
      const r = await new YeuxImprimante(faux.url).prendrePhoto();
      expect(r).toEqual({ ok: false, raison: "L'image de la caméra est trop grande (plus de 5 Mo)." });
    }
  });

  it("refuse ce qui n'est pas une image, ou un type annoncé faux", async () => {
    const html = new TextEncoder().encode('<html>Mainsail</html>');
    for (const camera of [envoyer(html, 'text/html'), envoyer(html, 'image/jpeg'), envoyer(JPEG, 'image/png')]) {
      const faux = await fauxMoonraker({ camera });
      const r = await new YeuxImprimante(faux.url).prendrePhoto();
      expect(r).toEqual({ ok: false, raison: "La caméra n'a pas envoyé une image (JPEG ou PNG)." });
    }
  });

  it('dit que la caméra ne répond pas après le délai', async () => {
    const faux = await fauxMoonraker({ camera: () => undefined });
    const r = await new YeuxImprimante(faux.url, '', fetch, 200).prendrePhoto();
    expect(r).toEqual({ ok: false, raison: 'La caméra ne répond pas (plus de 5 secondes).' });
  });

  it('ne suit jamais une redirection', async () => {
    let suivie = false;
    const faux = await fauxMoonraker({
      camera: (req, res) => {
        if (req.url === '/snap2') suivie = true;
        res.statusCode = 302;
        res.setHeader('location', '/snap2');
        res.end();
      },
    });
    const r = await new YeuxImprimante(faux.url).prendrePhoto();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raison).toBe('La caméra a renvoyé ailleurs : refusé.');
    expect(suivie).toBe(false);
  });

  it("refuse une caméra hors du réseau local, et une imprimante hors du réseau local", async () => {
    const faux = await fauxMoonraker({ webcams: () => [{ name: 'cam', enabled: true, snapshot_url: 'http://8.8.8.8/snap' }] });
    const r = await new YeuxImprimante(faux.url).prendrePhoto();
    expect(r).toEqual({ ok: false, raison: "L'adresse de la caméra n'est pas sur le réseau local : refusée." });
    expect(() => new YeuxImprimante('http://8.8.8.8')).toThrow(/refusée/);
  });

  it('caméra coupée dans Mainsail, et choix de la caméra par son nom', async () => {
    const coupee = await fauxMoonraker({ webcams: (b) => [{ name: 'cam', enabled: false, snapshot_url: `${b}/snap` }] });
    expect(await new YeuxImprimante(coupee.url).prendrePhoto()).toEqual({ ok: false, raison: 'Aucune caméra activée dans Mainsail.' });
    const deux = await fauxMoonraker({
      webcams: (b) => [
        { name: 'dessus', enabled: true, snapshot_url: `${b}/autre` },
        { name: 'face', enabled: true, snapshot_url: `${b}/snap` },
      ],
    });
    const r = await new YeuxImprimante(deux.url).prendrePhoto('face');
    expect(r.ok && r.photo.camera).toBe('face');
  });

  it('imprimante injoignable : une raison, pas une exception', async () => {
    const faux = await fauxMoonraker();
    const url = faux.url;
    await new Promise<void>((done) => faux.server.close(() => done()));
    serveurs.splice(serveurs.indexOf(faux.server), 1);
    expect(await new YeuxImprimante(url).prendrePhoto()).toEqual({ ok: false, raison: "L'imprimante ne répond pas." });
  });

  it("lit l'état (couches comprises) et la file d'attente", async () => {
    const faux = await fauxMoonraker({ file: [{ filename: 'suivante.gcode' }] });
    const yeux = new YeuxImprimante(faux.url);
    const etat = await yeux.etat();
    expect(etat.status.state).toBe('printing');
    expect([etat.couche, etat.couches]).toEqual([12, 80]);
    expect(await yeux.file()).toEqual([{ fichier: 'suivante.gcode' }]);
  });

  it("aucune requête autre que GET ne part vers l'imprimante, sur tout le chemin", async () => {
    const faux = await fauxMoonraker();
    const yeux = new YeuxImprimante(faux.url);
    await yeux.prendrePhoto();
    await yeux.etat();
    await yeux.file();
    await repondreYeux({ texte: "Montre-moi l'impression", lieu: 'fenetre', yeux: YEUX }, { klipper: () => yeux });
    await repondreYeux({ texte: "Montre-moi l'impression", lieu: 'enceinte', yeux: YEUX }, { klipper: () => yeux });
    expect(faux.methodes.length).toBeGreaterThan(8);
    expect(new Set(faux.methodes)).toEqual(new Set(['GET']));
    expect(faux.chemins.some((c) => /pause|cancel|start|emergency|gcode\/script|job_queue\/(start|pause|job)/.test(c))).toBe(false);
  });

  it('lectureSeule refuse POST, PUT, DELETE sans rien envoyer', async () => {
    const faux = await fauxMoonraker();
    const lecture = lectureSeule(fetch);
    for (const method of ['POST', 'PUT', 'DELETE', 'post']) {
      await expect(lecture(`${faux.url}/printer/print/pause`, { method })).rejects.toThrow(/refusée/);
    }
    await expect(lecture(new Request(`${faux.url}/printer/print/cancel`, { method: 'POST' }))).rejects.toThrow(/refusée/);
    expect(faux.methodes).toEqual([]);
  });

  it('reconnaît le type par les octets', () => {
    expect(typeDesOctets(JPEG)).toBe('image/jpeg');
    expect(typeDesOctets(PNG)).toBe('image/png');
    expect(typeDesOctets(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('yeux : « montre-moi l’impression »', () => {
  it('reconnaît les phrases du cahier', () => {
    for (const phrase of [
      "Montre-moi l'impression",
      "Jarvis, montre-moi l'impression.",
      "montre l'imprimante",
      "Fais voir l'impression",
      "Montre-moi la caméra de l'imprimante",
      "Où en est l'impression ?",
      "Jarvis, où en est l'impression en cours ?",
      "Peux-tu me montrer l'impression s'il te plaît ?",
      "Montre-moi l’impression stp",
    ]) {
      const intention = intentionYeux(phrase);
      expect(intention?.kind, phrase).toBe('montrer');
      expect(intention && trouverOeil(intention.cible, YEUX), phrase).toBe(IMPRIMANTE);
    }
  });

  it('laisse passer le reste (lancer, annuler, autres demandes)', () => {
    for (const phrase of ['Montre-moi une photo de chat', "Montre-moi l'impression de ce document dans Word", 'Montre-moi le salon']) {
      const intention = intentionYeux(phrase);
      expect(intention && trouverOeil(intention.cible, YEUX), phrase).toBeNull();
    }
    for (const phrase of [
      "Annule l'impression",
      "Mets l'impression en pause",
      "Lance l'impression",
      "Est-ce que l'impression se passe bien ?",
      "imprime-la",
      '',
    ]) {
      expect(intentionYeux(phrase), phrase).toBeNull();
    }
  });

  const etat = (s: Partial<EtatYeux['status']>, klippy: EtatYeux['klippy'] = 'ready', couche: number | null = null, couches: number | null = null): EtatYeux => ({
    status: { state: 'printing', filename: 'bac.gcode', progress: 0.42, printDuration: 3000, totalDuration: 3100, bed: 60.2, bedTarget: 60, extruder: 214.6, extruderTarget: 215, ...s },
    klippy,
    couche,
    couches,
  });

  it("phrase d'état : pourcentage, reste, températures", () => {
    // 3000 s pour 42 % : reste 3000 × 58 / 42 ≈ 4143 s = 1 h 9.
    expect(phraseEtat(etat({}))).toBe('42 %, il reste 1 h 9, buse 215 °C, plateau 60 °C.');
    expect(phraseEtat(etat({}, 'ready', 12, 80))).toBe('42 %, il reste 1 h 9, couche 12 sur 80, buse 215 °C, plateau 60 °C.');
    expect(phraseEtat(etat({ state: 'paused' }))).toBe('En pause à 42 %, il reste 1 h 9, buse 215 °C, plateau 60 °C.');
    expect(phraseEtat(etat({ state: 'standby', progress: 0 }))).toBe('Aucune impression en cours, buse 215 °C, plateau 60 °C.');
    expect(phraseEtat(etat({ state: 'complete', progress: 1 }))).toBe('Impression terminée, buse 215 °C, plateau 60 °C.');
    expect(phraseEtat(etat({}, 'shutdown'))).toBe("L'imprimante est en erreur (Klipper arrêté).");
  });

  it("phrase de l'enceinte : courte, la photo est sur le PC", () => {
    expect(phraseEnceinte(etat({}), true)).toBe('42 %, il reste 1 h 9. La photo est sur le PC.');
    expect(phraseEnceinte(null, false)).toBe("L'imprimante ne répond pas.");
  });

  it('fenêtre : photo + état + heure de la photo', async () => {
    const faux = await fauxMoonraker();
    const prisA = new Date(2026, 10, 23, 21, 14, 5).getTime();
    const r = await repondreYeux(
      { texte: "Montre-moi l'impression", lieu: 'fenetre', yeux: YEUX },
      { klipper: () => new YeuxImprimante(faux.url, '', fetch, 5_000, () => prisA) },
    );
    expect(r?.photo?.type).toBe('image/jpeg');
    expect(r?.texte).toBe('50 %, il reste 50 min, couche 12 sur 80, buse 215 °C, plateau 60 °C. Photo prise à 21 h 14 min 05 s.');
    expect(heurePhoto(prisA)).toBe('21 h 14 min 05 s');
  });

  it('enceinte : phrase courte ; la photo part dans la discussion, pas vers l’enceinte', async () => {
    const faux = await fauxMoonraker();
    const r = await repondreYeux({ texte: "Jarvis, montre-moi l'impression", lieu: 'enceinte', yeux: YEUX }, { klipper: () => new YeuxImprimante(faux.url) });
    expect(r?.texte).toBe('50 %, il reste 50 min. La photo est sur le PC.');
    expect(r?.photo).not.toBeNull();
  });

  it("caméra en panne : l'état seul, et la raison ; jamais une autre image", async () => {
    const faux = await fauxMoonraker({ camera: () => undefined });
    const r = await repondreYeux({ texte: "Montre-moi l'impression", lieu: 'fenetre', yeux: YEUX }, { klipper: () => new YeuxImprimante(faux.url, '', fetch, 200) });
    expect(r?.photo).toBeNull();
    expect(r?.texte).toBe('50 %, il reste 50 min, couche 12 sur 80, buse 215 °C, plateau 60 °C. Pas de photo : la caméra ne répond pas (plus de 5 secondes).');
  });

  it('carte de l’écran « Yeux » : en cours, en attente, terminé, erreur', () => {
    expect(etatCarte(etat({}, 'ready', 40, 120))).toEqual({
      etat: 'en cours',
      pourcent: 42,
      reste: '1 h 9',
      couche: '40 sur 120',
      buse: '215 °C (consigne 215 °C)',
      plateau: '60 °C (consigne 60 °C)',
      fichier: 'bac.gcode',
    });
    expect(etatCarte(etat({ state: 'standby', filename: '', bedTarget: 0, extruderTarget: 0 }))).toMatchObject({
      etat: 'en attente',
      pourcent: null,
      reste: null,
      couche: null,
      buse: '215 °C',
      fichier: null,
    });
    expect(etatCarte(etat({ state: 'complete' })).etat).toBe('terminé');
    expect(etatCarte(etat({}, 'shutdown')).etat).toBe('en erreur');
  });

  it('image figée après 10 s sans nouvelle image', () => {
    expect(imageFigee(1000, 11_000)).toBe(false);
    expect(imageFigee(1000, 11_001)).toBe(true);
    expect(imageFigee(null, 0)).toBe(true);
  });

  it("phrase qui n'est pas pour les yeux : null, l'imprimante n'est pas appelée", async () => {
    let ouverte = false;
    const r = await repondreYeux({ texte: 'Quelle heure est-il ?', lieu: 'fenetre', yeux: YEUX }, { klipper: () => { ouverte = true; throw new Error('jamais'); } });
    expect(r).toBeNull();
    expect(ouverte).toBe(false);
  });
});

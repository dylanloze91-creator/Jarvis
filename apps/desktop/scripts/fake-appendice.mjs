// Faux appendice de Jarvis : un petit serveur qui suit le contrat commun, version 1
// (docs/specs/jarvis-development.md, section 3). Aucun matériel, rien ne bouge.
//
// À la main, pour l'essayer dans Jarvis Test :
//   node apps/desktop/scripts/fake-appendice.mjs            (port 8770, genre « bras »)
//   node apps/desktop/scripts/fake-appendice.mjs --port 8771 --genre main --nom "Fausse lampe"
// Il affiche son adresse et son jeton : à coller dans Réglages → Appendices.
// Les tests l'importent aussi (`startFakeAppendice`).
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const CAPACITIES = {
  bras: [
    { nom: 'saisir', description: 'Ferme la pince sur l’objet devant elle.' },
    { nom: 'lacher', description: 'Ouvre la pince.' },
    { nom: 'repos', description: 'Replie le bras en position de repos.' },
  ],
  main: [
    { nom: 'allumer', description: 'Allume la lampe.', risque: 'agir' },
    { nom: 'eteindre', description: 'Éteint la lampe.', risque: 'agir' },
  ],
  sens: [{ nom: 'mesurer', description: 'Lit la température.', risque: 'lire' }],
};
const RISKS = { bras: 'bouger', jambes: 'bouger', main: 'agir', sens: 'lire', oeil: 'lire', ecran: 'agir', oreille: 'lire', energie: 'agir' };

/**
 * Démarre un faux appendice. `port: 0` laisse le système choisir (tests).
 * L'objet rendu se règle pendant un test : `nextStatus`, `nextMeasure`, `actionDelayMs`, `mute`.
 */
export async function startFakeAppendice(options = {}) {
  const genre = options.genre ?? 'bras';
  const fake = {
    token: options.token ?? randomBytes(24).toString('hex'),
    hello: {
      contrat: 1,
      id: options.id ?? `faux-${genre}`,
      genre,
      nom: options.nom ?? `Faux ${genre}`,
      piece: options.piece ?? 'établi',
      version: '0.1.0',
      risque: options.risque ?? RISKS[genre] ?? 'bouger',
      capacites: options.capacites ?? CAPACITIES[genre] ?? CAPACITIES.bras,
      ...(options.hello ?? {}),
    },
    /** Statut rendu par la prochaine action. */
    nextStatus: 'termine',
    /** Mesure jointe à un « terminé ». `undefined` : aucune mesure (résultat non vérifié). */
    nextMeasure: { verifie: true },
    actionDelayMs: 0,
    /** Vrai : le faux appendice ne répond plus (prise débranchée). */
    mute: false,
    emergency: false,
    busy: null,
    stops: 0,
    done: [],
    requests: [],
    origin: '',
    paths() {
      return fake.requests.map((request) => `${request.method} ${request.path}`);
    },
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };

  let interrupt = null;
  let counter = 0;

  function state() {
    return {
      etat: fake.emergency ? 'arret_urgence' : fake.busy ? 'occupe' : 'pret',
      action: fake.busy,
      derniere_action: fake.done[fake.done.length - 1] ?? null,
      alertes: [],
      mesures: { simulation: true },
    };
  }

  function send(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
    res.end(text);
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16 * 1024) return null;
      chunks.push(chunk);
    }
    if (!chunks.length) return {};
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  const server = createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const method = req.method ?? 'GET';
    const authorization = req.headers.authorization;
    const body = method === 'POST' ? await readBody(req) : {};
    fake.requests.push({ method, path, authorization, body: body ?? {} });
    if (fake.mute) {
      req.socket.destroy();
      return;
    }
    const authorized = authorization === `Bearer ${fake.token}`;
    if (body === null) return send(res, 400, { erreur: 'corps illisible' });

    if (method === 'GET' && path === '/api/sante') return send(res, 200, { ok: true, version: fake.hello.version, mode: 'simulation' });
    if (method === 'GET' && path === '/api/etat') return send(res, 200, state());
    if (method === 'GET' && path === '/api/hello') {
      return authorized ? send(res, 200, fake.hello) : send(res, 401, { erreur: 'jeton refusé' });
    }
    if (method === 'POST' && path === '/api/stop') {
      // Sans jeton : mieux vaut un arrêt de trop.
      fake.stops += 1;
      interrupt?.();
      return send(res, 200, { etat: state() });
    }
    if (method === 'POST' && path === '/api/arret_urgence') {
      const active = body.actif !== false;
      if (!active && !authorized) return send(res, 401, { erreur: 'jeton exigé pour relâcher' });
      fake.emergency = active;
      if (active) interrupt?.();
      return send(res, 200, { etat: state() });
    }
    const match = method === 'POST' ? /^\/api\/([a-z][a-z0-9_]{0,31})$/.exec(path) : null;
    if (!match) return send(res, 404, { erreur: 'route inconnue' });
    if (!authorized) return send(res, 401, { erreur: 'jeton refusé' });
    const type = match[1];
    if (!fake.hello.capacites.some((capacity) => capacity.nom === type)) return send(res, 404, { erreur: `capacité inconnue : ${type}` });
    counter += 1;
    const action = { id: String(counter), type, statut: 'en_cours' };
    if (fake.emergency) {
      return send(res, 409, { erreur: 'arrêt d’urgence actif', action: { ...action, statut: 'refuse', message: 'arrêt d’urgence actif' } });
    }
    if (fake.busy) {
      return send(res, 409, { erreur: 'déjà occupé', action: { ...action, statut: 'refuse', message: 'une action est déjà en cours' } });
    }
    fake.busy = action;
    const started = Date.now();
    const interrupted = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), fake.actionDelayMs);
      interrupt = () => {
        clearTimeout(timer);
        resolve(true);
      };
    });
    interrupt = null;
    fake.busy = null;
    const finished = {
      ...action,
      statut: interrupted ? 'interrompu' : fake.nextStatus,
      duree_s: (Date.now() - started) / 1000,
      ...(!interrupted && fake.nextStatus === 'termine' && fake.nextMeasure !== undefined ? { mesure: fake.nextMeasure } : {}),
      ...(interrupted ? { message: 'arrêté avant la fin' } : {}),
    };
    fake.done.push({ ...finished, parametres: body });
    if (res.writableEnded || res.destroyed) return;
    return send(res, 200, { action: finished });
  });

  await new Promise((resolve) => server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve));
  fake.origin = `http://127.0.0.1:${server.address().port}`;
  return fake;
}

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const genre = argument('genre', 'bras');
  const fake = await startFakeAppendice({ port: Number(argument('port', '8770')), genre, nom: argument('nom', undefined) });
  console.log(`Faux appendice « ${fake.hello.nom} » (${genre}), en simulation : rien ne bouge.`);
  console.log(`Adresse : ${fake.origin}`);
  console.log(`Jeton   : ${fake.token}`);
  console.log('À coller dans Jarvis Test, Réglages → Appendices. Ctrl+C pour l’arrêter.');
}

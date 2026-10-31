import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Faux service du robot (même API que `jarvis_rover/api.py`), en mémoire.
 * Sert aux tests du client et des outils : aucun Raspberry Pi, aucun Python.
 */
export const FAKE_ROVER_TOKEN = 'fake-rover-token-0123456789';

export interface FakeRoverRequest {
  method: string;
  path: string;
  authorization?: string;
  body: Record<string, unknown>;
}

export class FakeRover {
  readonly requests: FakeRoverRequest[] = [];
  emergency = false;
  /** Statut rendu par le prochain mouvement. */
  nextStatus = 'termine';
  /** Délai avant la réponse d'un mouvement (ms). */
  movementDelayMs = 0;
  mode = 'simulation';
  private server: Server | null = null;
  /** Position cumulée (m) : un ordre refusé ne doit rien faire bouger. */
  x = 0;

  async start(): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  paths(): string[] {
    return this.requests.map((request) => `${request.method} ${request.path}`);
  }

  private state() {
    return {
      mode: this.mode,
      pose: { x_m: this.x, y_m: 0, cap_deg: 0 },
      distance_totale_m: Math.abs(this.x),
      vitesse_m_s: 0,
      vitesse_mesuree_m_s: 0,
      braquage_deg: 0,
      roues_arriere_m_s: [0, 0],
      batterie: { tension_v: 11.8, courant_a: 0.4 },
      arret_urgence: this.emergency,
      mouvement: null,
      dernier_mouvement: null,
      alertes: this.emergency ? ['Arrêt d’urgence actif.'] : [],
      limites: { vitesse_max_m_s: 0.3, braquage_max_deg: 30, distance_max_m: 3, rayon_braquage_min_m: 0.52 },
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: Record<string, unknown> = {};
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      return send(res, 400, { erreur: 'Corps JSON invalide.' });
    }
    const path = (req.url ?? '/').split('?')[0]!;
    const authorization = req.headers.authorization;
    this.requests.push({ method: req.method ?? 'GET', path, authorization, body });
    const authorized = authorization === `Bearer ${FAKE_ROVER_TOKEN}`;
    const needToken = () => (authorized ? null : send(res, 401, { erreur: 'Jeton manquant ou invalide.' }));

    if (req.method === 'GET' && path === '/api/sante') return send(res, 200, { ok: true, version: '0.1.0', mode: this.mode });
    if (req.method === 'GET' && path === '/api/etat') return send(res, 200, this.state());
    if (req.method === 'GET' && path === '/api/verifier') return needToken() ?? send(res, 200, { ok: true });
    if (req.method === 'POST' && path === '/api/stop') return send(res, 200, { ok: true, etat: this.state() });
    if (req.method === 'POST' && path === '/api/arret_urgence') {
      const active = body.actif ?? true;
      if (active === false && !authorized) return needToken();
      this.emergency = active !== false;
      return send(res, 200, { ok: true, arret_urgence: this.emergency });
    }
    if (req.method === 'POST' && (path === '/api/avancer' || path === '/api/tourner')) {
      if (needToken()) return;
      if (this.emergency) return send(res, 409, { erreur: "Arrêt d'urgence actif : il faut d'abord le relâcher." });
      const forward = path === '/api/avancer';
      if (forward && typeof body.distance_m !== 'number') return send(res, 400, { erreur: 'Champ « distance_m » : nombre attendu.' });
      if (this.movementDelayMs) await new Promise((resolve) => setTimeout(resolve, this.movementDelayMs));
      if (res.destroyed) return;
      const distance = forward ? (body.distance_m as number) : 0;
      this.x += distance;
      const mesure = forward
        ? { distance_m: distance - 0.003 * Math.sign(distance), ecart_m: 0.003 }
        : { angle_deg: (body.angle_deg as number) - 0.4, ecart_deg: 0.4, rayon_m: 0.52 };
      const messages: Record<string, string> = {
        termine: forward ? 'Distance atteinte.' : 'Virage effectué.',
        bloque: 'Roues bloquées : moteurs coupés.',
        interrompu: 'Arrêté à la demande.',
        en_cours: '',
      };
      return send(res, 200, {
        mouvement: {
          id: this.requests.length,
          type: forward ? 'avancer' : 'tourner',
          parametres: body,
          statut: this.nextStatus,
          message: messages[this.nextStatus] ?? '',
          mesure,
          duree_s: 2.1,
        },
      });
    }
    send(res, 404, { erreur: 'Adresse inconnue.' });
  }
}

function send(res: ServerResponse, status: number, payload: unknown): true {
  if (res.destroyed) return true;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
  return true;
}

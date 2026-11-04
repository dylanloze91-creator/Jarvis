import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { allowedPhoneHost } from '../phone/phone.js';
import {
  EXAM_TARGET,
  examBalanceMessage,
  examTeamCounts,
  parseExamLine,
  parseToSortLine,
  type ExamLine,
  type ToSortLine,
  trieurTeamLabels,
} from './extract.js';
import { ORCHESTRA_TEAMS, type OrchestraTeam } from '../agent/orchestraTeams.js';
import { dropLastExamLine } from './sortExam.js';
import { sortPostBodySizeOk, sortPostContentTypeOk } from './sortPost.js';

export interface SortProgress {
  nextIndex: number;
}

export interface SortServerOptions {
  toSortPath: string;
  examPath: string;
  progressPath: string;
  host?: string;
  /** Port local (0 = port libre). */
  port?: number;
  /** Accepte aussi les hôtes `*.ts.net` et exige un jeton Bearer sur `/api/*`. */
  tailscale?: boolean;
  /** Jeton d'accès (32 octets, base64url) ; obligatoire si `tailscale`. */
  accessToken?: string;
  log?: (line: string) => void;
}

const PAGE_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function allowedSortHost(host: string | undefined, tailscale = false): boolean {
  if (tailscale) return allowedPhoneHost(host);
  if (!host) return false;
  const name = host.trim().toLowerCase().replace(/:\d+$/, '');
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
}

/** Jeton aléatoire pour le tri sur téléphone via Tailscale. */
export function createSortAccessToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sortBearerOk(expected: string | undefined, authorization: string | undefined): boolean {
  if (!expected) return true;
  const match = typeof authorization === 'string' ? /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(authorization.trim()) : null;
  if (!match) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(match[1]!);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readLines(path: string): Promise<unknown[]> {
  try {
    const raw = await readFile(path, 'utf8');
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as unknown);
  } catch {
    return [];
  }
}

async function loadToSort(path: string): Promise<ToSortLine[]> {
  const rows = await readLines(path);
  return rows.map(parseToSortLine).filter((line): line is ToSortLine => line !== null);
}

async function loadExam(path: string): Promise<ExamLine[]> {
  const rows = await readLines(path);
  return rows.map(parseExamLine).filter((line): line is ExamLine => line !== null);
}

async function loadProgress(path: string, total: number): Promise<number> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as SortProgress;
    const index = Number(raw.nextIndex);
    if (!Number.isFinite(index) || index < 0) return 0;
    return Math.min(index, total);
  } catch {
    return 0;
  }
}

async function saveProgress(path: string, nextIndex: number): Promise<void> {
  await writeFile(path, JSON.stringify({ nextIndex } satisfies SortProgress, null, 2), 'utf8');
}

async function appendExam(path: string, line: ExamLine): Promise<void> {
  await writeFile(path, `${JSON.stringify(line)}\n`, { encoding: 'utf8', flag: 'a' });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function text(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const SORT_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Tri du trieur Jarvis</title>
<link rel="stylesheet" href="/app.css"/>
</head>
<body>
<h1>Classer vos phrases pour le trieur</h1>
<p id="status"></p>
<div id="context"></div>
<div id="phrase"></div>
<div class="grid" id="teams"></div>
<div class="grid">
<button type="button" class="secondary" data-team="unknown">Je ne sais pas</button>
<button type="button" class="secondary" data-team="not_a_request">Pas une demande</button>
</div>
<p><button type="button" id="undo" class="secondary">Annuler la dernière</button></p>
<script src="/app.js"></script>
</body>
</html>`;

export const SORT_APP_CSS = String.raw`body{font-family:system-ui,sans-serif;max-width:720px;margin:1.5rem auto;padding:0 1rem;background:#0f172a;color:#e2e8f0}
h1{font-size:1.25rem}
#context,#phrase{white-space:pre-wrap;background:#1e293b;padding:1rem;border-radius:8px;margin:0.75rem 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:0.5rem;margin:1rem 0}
button{font-size:1rem;padding:0.75rem;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#f8fafc;cursor:pointer}
button:focus{outline:2px solid #38bdf8}
.secondary{opacity:0.85}
#status{font-size:0.9rem;color:#94a3b8;margin-top:1rem}`;

export const SORT_PHONE_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<title>Tri du trieur</title>
<link rel="stylesheet" href="/app.css"/>
</head>
<body>
<h1>Classer vos phrases</h1>
<p id="status"></p>
<div id="context"></div>
<div id="phrase"></div>
<div class="grid-teams" id="teams"></div>
<div class="grid-actions">
<button type="button" class="secondary" data-team="unknown">Je ne sais pas</button>
<button type="button" class="secondary" data-team="not_a_request">Pas une demande</button>
</div>
<p><button type="button" id="undo" class="secondary wide">Annuler la dernière</button></p>
<script src="/app.js"></script>
</body>
</html>`;

export const SORT_PHONE_CSS = String.raw`body{font-family:system-ui,sans-serif;max-width:720px;margin:0 auto;padding:calc(env(safe-area-inset-top) + 12px) 12px calc(env(safe-area-inset-bottom) + 12px);background:#0f172a;color:#e2e8f0;-webkit-tap-highlight-color:transparent}
h1{font-size:1.15rem;margin:0 0 0.5rem}
#context,#phrase{white-space:pre-wrap;background:#1e293b;padding:1rem;border-radius:12px;margin:0.75rem 0;font-size:1.05rem}
.grid-teams{display:grid;grid-template-columns:repeat(3,1fr);gap:0.65rem;margin:1rem 0}
.grid-actions{display:grid;grid-template-columns:1fr 1fr;gap:0.65rem;margin:0.75rem 0}
button{font-size:1rem;padding:1rem 0.5rem;border-radius:12px;border:1px solid #334155;background:#1e293b;color:#f8fafc;cursor:pointer;touch-action:manipulation;min-height:3.25rem}
button:focus{outline:2px solid #38bdf8}
button:disabled{opacity:0.45}
.secondary{opacity:0.92}
.wide{width:100%;margin-top:0.25rem}
#status{font-size:0.95rem;color:#94a3b8;margin:0.25rem 0 0.75rem}`;

/** Page téléphone : gros boutons, jeton dans l’en-tête, pas de clavier requis. */
export const SORT_PHONE_JS = String.raw`const teams=[
['conversation','Conversation'],['pc','PC'],['fichiers','Fichiers'],
['web','Internet'],['musique','Musique'],['concentration','Concentration'],
['memoire','Mémoire'],['google','Google'],['code','Code']];
const TOKEN_KEY='jarvis.trieur.token';
const hashMatch=/[#&]t=([A-Za-z0-9_-]+)/.exec(window.location.hash||'');
if(hashMatch){try{localStorage.setItem(TOKEN_KEY,hashMatch[1]);}catch(e){}}
if(window.location.hash&&window.history&&window.history.replaceState){
  window.history.replaceState(null,'',window.location.pathname);
}
let token=null;
try{token=localStorage.getItem(TOKEN_KEY);}catch(e){}
const grid=document.getElementById('teams');
const statusEl=document.getElementById('status');
const ctxEl=document.getElementById('context');
const phraseEl=document.getElementById('phrase');
for(const [id,label] of teams){
  const b=document.createElement('button');
  b.type='button';
  b.dataset.team=id;
  b.textContent=label;
  grid.appendChild(b);
}
function authHeaders(extra){
  const h={...(extra||{})};
  if(token)h.Authorization='Bearer '+token;
  return h;
}
async function load(){
  if(!token){statusEl.textContent='Ouvre le lien avec le QR code affiché sur le PC.';return;}
  const r=await fetch('/api/current',{headers:authHeaders()});
  if(r.status===401){statusEl.textContent='Accès refusé : rouvre le lien du PC.';return;}
  if(!r.ok){statusEl.textContent='Erreur de chargement.';return;}
  const d=await r.json();
  const count=d.done?'':(d.index!==undefined&&d.total!==undefined?('Phrase '+(d.index+1)+' / '+d.total+' · '):'');
  statusEl.textContent=count+(d.message||'');
  ctxEl.textContent=d.context||'(pas de contexte)';
  phraseEl.textContent=d.phrase||'';
  const disabled=!!d.done;
  document.querySelectorAll('button[data-team],#undo').forEach(x=>{x.disabled=disabled;});
}
async function choose(team){
  const r=await fetch('/api/choose',{method:'POST',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify({team})});
  if(r.status===401){statusEl.textContent='Accès refusé.';return;}
  if(!r.ok){statusEl.textContent='Enregistrement impossible.';return;}
  await load();
}
async function undoLast(){
  const r=await fetch('/api/undo',{method:'POST',headers:authHeaders({'Content-Type':'application/json'}),body:'{}'});
  if(r.status===401){statusEl.textContent='Accès refusé.';return;}
  if(!r.ok){statusEl.textContent='Annulation impossible.';return;}
  await load();
}
document.getElementById('undo')?.addEventListener('click',()=>{void undoLast();});
document.body.addEventListener('click',e=>{
  const t=e.target;
  if(!(t instanceof HTMLButtonElement)||!t.dataset.team)return;
  void choose(t.dataset.team);
});
void load();`;

/** JavaScript servi séparément ; le texte utilisateur passe uniquement par textContent. */
export const SORT_APP_JS = String.raw`const teams=[
['conversation','1 Conversation'],['pc','2 PC'],['fichiers','3 Fichiers'],['web','4 Internet'],
['musique','5 Musique'],['concentration','6 Concentration'],['memoire','7 Mémoire'],
['google','8 Google'],['code','9 Code']];
const grid=document.getElementById('teams');
const statusEl=document.getElementById('status');
const ctxEl=document.getElementById('context');
const phraseEl=document.getElementById('phrase');
for(const [id,label] of teams){
  const b=document.createElement('button');
  b.type='button';
  b.dataset.team=id;
  b.textContent=label;
  grid.appendChild(b);
}
async function load(){
  const r=await fetch('/api/current');
  if(!r.ok){statusEl.textContent='Erreur de chargement.';return;}
  const d=await r.json();
  statusEl.textContent=d.message||'';
  ctxEl.textContent=d.context||'(pas de contexte)';
  phraseEl.textContent=d.phrase||'';
  if(d.done){grid.querySelectorAll('button').forEach(x=>x.disabled=true);}
}
async function choose(team){
  const r=await fetch('/api/choose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({team})});
  if(!r.ok){statusEl.textContent='Enregistrement impossible.';return;}
  await load();
}
async function undoLast(){
  const r=await fetch('/api/undo',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  if(!r.ok){statusEl.textContent='Annulation impossible.';return;}
  await load();
}
document.getElementById('undo')?.addEventListener('click',()=>{void undoLast();});
document.body.addEventListener('click',e=>{
  const t=e.target;
  if(!(t instanceof HTMLButtonElement)||!t.dataset.team)return;
  void choose(t.dataset.team);
});
document.addEventListener('keydown',e=>{
  const n=Number(e.key);
  if(n>=1&&n<=9){
    const id=teams[n-1][0];
    void choose(id);
  }
});
void load();`;

export class TrieurSortServer {
  private server: Server | null = null;
  private toSort: ToSortLine[] = [];
  private index = 0;

  constructor(private readonly options: SortServerOptions) {}

  async start(): Promise<{ port: number; url: string }> {
    if (this.options.tailscale && !this.options.accessToken) {
      throw new Error('Mode Tailscale : jeton d’accès manquant.');
    }
    this.toSort = await loadToSort(this.options.toSortPath);
    this.index = await loadProgress(this.options.progressPath, this.toSort.length);
    const host = this.options.host ?? '127.0.0.1';
    const listenPort = this.options.port ?? 0;
    await new Promise<void>((resolve, reject) => {
      this.server = createServer((req, res) => {
        void this.handle(req, res).catch((error) => {
          this.options.log?.(String(error));
          if (!res.headersSent) text(res, 500, 'Erreur');
        });
      });
      this.server.on('error', reject);
      this.server.listen(listenPort, host, () => resolve());
    });
    const addr = this.server!.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const url = `http://${host}:${port}/`;
    this.options.log?.(`Page de tri : ${url}`);
    return { port, url };
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const hostHeader = typeof req.headers.host === 'string' ? req.headers.host : undefined;
    if (!allowedSortHost(hostHeader, this.options.tailscale)) {
      text(res, 403, 'Hôte refusé');
      return;
    }
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined;
    const apiPath = path.startsWith('/api/');
    if (this.options.tailscale && apiPath && !sortBearerOk(this.options.accessToken, authHeader)) {
      json(res, 401, { error: 'jeton requis' });
      return;
    }
    const phoneUi = this.options.tailscale === true;
    if (req.method === 'GET' && path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_POLICY });
      res.end(phoneUi ? SORT_PHONE_HTML : SORT_HTML);
      return;
    }
    if (req.method === 'GET' && path === '/app.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Content-Security-Policy': PAGE_POLICY });
      res.end(phoneUi ? SORT_PHONE_JS : SORT_APP_JS);
      return;
    }
    if (req.method === 'GET' && path === '/app.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Content-Security-Policy': PAGE_POLICY });
      res.end(phoneUi ? SORT_PHONE_CSS : SORT_APP_CSS);
      return;
    }
    if (req.method === 'GET' && path === '/api/current') {
      const exam = await loadExam(this.options.examPath);
      const counts = examTeamCounts(exam);
      const message = examBalanceMessage(counts, exam.length);
      if (this.index >= this.toSort.length) {
        json(res, 200, { done: true, message: `${message} Tout est trié.` });
        return;
      }
      const current = this.toSort[this.index]!;
      json(res, 200, {
        done: false,
        index: this.index,
        total: this.toSort.length,
        phrase: current.phrase,
        context: current.context,
        suggestion: current.suggestion,
        message,
      });
      return;
    }
    if (req.method === 'POST' && path === '/api/choose') {
      const contentType = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : undefined;
      if (!sortPostContentTypeOk(contentType)) {
        json(res, 415, { error: 'Content-Type application/json requis' });
        return;
      }
      const rawBody = await readRawBody(req);
      if (rawBody === null) {
        json(res, 413, { error: 'corps trop grand' });
        return;
      }
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(new TextDecoder().decode(rawBody)) as Record<string, unknown>;
      } catch {
        json(res, 400, { error: 'JSON invalide' });
        return;
      }
      const team = String(body.team ?? '');
      if (this.index >= this.toSort.length) {
        json(res, 400, { error: 'terminé' });
        return;
      }
      const current = this.toSort[this.index]!;
      const examTeam = parseTeamChoice(team);
      if (!examTeam) {
        json(res, 400, { error: 'équipe invalide' });
        return;
      }
      await appendExam(this.options.examPath, {
        phrase: current.phrase,
        context: current.context,
        team: examTeam,
      });
      this.index += 1;
      await saveProgress(this.options.progressPath, this.index);
      json(res, 200, { ok: true, nextIndex: this.index });
      return;
    }
    if (req.method === 'POST' && path === '/api/undo') {
      const contentType = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : undefined;
      if (!sortPostContentTypeOk(contentType)) {
        json(res, 415, { error: 'Content-Type application/json requis' });
        return;
      }
      const rawBody = await readRawBody(req);
      if (rawBody === null) {
        json(res, 413, { error: 'corps trop grand' });
        return;
      }
      if (this.index <= 0) {
        json(res, 400, { error: 'rien à annuler' });
        return;
      }
      let examRaw = '';
      try {
        examRaw = await readFile(this.options.examPath, 'utf8');
      } catch {
        examRaw = '';
      }
      const dropped = dropLastExamLine(examRaw);
      if (!dropped.removed) {
        json(res, 400, { error: 'rien à annuler' });
        return;
      }
      await writeFile(this.options.examPath, dropped.content, 'utf8');
      this.index -= 1;
      await saveProgress(this.options.progressPath, this.index);
      json(res, 200, { ok: true, nextIndex: this.index });
      return;
    }
    text(res, 404, 'Introuvable');
  }
}

function parseTeamChoice(raw: string): ExamLine['team'] | null {
  if (raw === 'unknown' || raw === 'not_a_request') return raw;
  if (ORCHESTRA_TEAMS.includes(raw as OrchestraTeam)) return raw as OrchestraTeam;
  return null;
}

async function readRawBody(req: IncomingMessage): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (!sortPostBodySizeOk(size)) return null;
    chunks.push(chunk);
  }
  if (size === 0) return new Uint8Array(0);
  return chunks.length === 1 ? chunks[0]! : concatBytes(chunks);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function teamButtonLabels(): readonly { id: OrchestraTeam; label: string; key: number }[] {
  return ORCHESTRA_TEAMS.map((id, index) => ({ id, label: trieurTeamLabels[id], key: index + 1 }));
}

export { EXAM_TARGET };

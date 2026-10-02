import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ChatBody {
  model: string;
  messages: Array<{ role: string; content: string; tool_calls?: unknown[] }>;
  tools?: unknown[];
  options?: { num_gpu?: number; num_ctx?: number };
  think?: boolean;
}

type Behaviour = 'good' | 'bad';

/**
 * Faux serveur Ollama sur la boucle locale, au format documenté de l'API
 * (/api/version, /api/tags, /api/ps, /api/chat en NDJSON, /api/pull). Le
 * modèle « good » fait les tâches du banc avec de vrais appels d'outils ;
 * « bad » écrit ses appels en texte.
 */
export class FakeOllama {
  readonly installed = new Map<string, number>([
    ['qwen2.5:3b', 1.93e9],
    ['nomic-embed-text:latest', 0.27e9],
  ]);
  readonly behaviour = new Map<string, Behaviour>();
  /** Modèle scripté (tests de bout en bout des tâches) : une réponse par tour, selon la conversation. */
  readonly scripts = new Map<string, (body: ChatBody) => Reply>();
  readonly unloaded: string[] = [];
  readonly requests: Array<{ method: string; path: string; body: unknown }> = [];
  readonly pulls: string[] = [];
  private running = new Map<string, { size: number; vram: number }>();
  private loaded = new Set<string>();
  private server: Server | null = null;
  url = '';

  async start(port = 0): Promise<this> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    const path = new URL(req.url ?? '/', this.url).pathname;
    this.requests.push({ method: req.method ?? 'GET', path, body });
    const json = (value: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (path === '/api/version') return json({ version: '0.35.1' });
    if (path === '/api/tags') {
      return json({
        models: [...this.installed].map(([name, size]) => ({
          name,
          size,
          details: { parameter_size: '3B', quantization_level: 'Q4_K_M' },
          capabilities: name.includes('embed') ? ['embedding'] : ['completion', 'tools'],
        })),
      });
    }
    if (path === '/api/ps')
      return json({
        models: [...this.running].map(([name, m]) => ({
          name,
          model: name,
          size: m.size,
          size_vram: m.vram,
        })),
      });
    if (path === '/api/pull' && body) return this.pull(String(body.model), res);
    if (path === '/api/generate' && body && body.keep_alive === 0) {
      this.unloaded.push(String(body.model));
      this.running.delete(String(body.model));
      return json({ model: body.model, done: true, done_reason: 'unload' });
    }
    if (path === '/api/chat' && body) return this.chat(body as unknown as ChatBody, res);
    res.writeHead(404);
    res.end('{"error":"not found"}');
  }

  private stream(res: ServerResponse, chunks: unknown[]): void {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.end(chunks.map((chunk) => `${JSON.stringify(chunk)}\n`).join(''));
  }

  private pull(model: string, res: ServerResponse): void {
    this.pulls.push(model);
    this.installed.set(model, 23e9);
    this.stream(res, [
      { status: 'pulling manifest' },
      { status: 'pulling 1a2b3c', digest: 'sha256:1a2b3c', total: 1_000, completed: 500 },
      { status: 'pulling 1a2b3c', digest: 'sha256:1a2b3c', total: 1_000, completed: 1_000 },
      { status: 'verifying sha256 digest' },
      { status: 'success' },
    ]);
  }

  private chat(body: ChatBody, res: ServerResponse): void {
    if (!this.installed.has(body.model)) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `model "${body.model}" not found, try pulling it first` }));
      return;
    }
    const cold = !this.loaded.has(body.model);
    this.loaded.add(body.model);
    const cpu = body.options?.num_gpu === 0;
    const isBench = Boolean(body.tools?.length);
    this.running.set(
      body.model,
      isBench ? { size: 24e9, vram: 4e9 } : { size: 2.6e9, vram: cpu ? 0 : 2.6e9 },
    );
    const final = {
      done: true,
      done_reason: 'stop',
      total_duration: 5e9,
      load_duration: cold ? 3e9 : 1e7,
      prompt_eval_count: 400,
      prompt_eval_duration: 1e9,
      eval_count: isBench ? 50 : 160,
      eval_duration: isBench ? 2.5e9 : cpu ? 16e9 : 4.444e9,
    };
    const script = this.scripts.get(body.model);
    if (script) {
      const reply = script(body);
      const message =
        'call' in reply
          ? {
              role: 'assistant',
              content: '',
              tool_calls: [
                { function: { name: reply.call.name, arguments: reply.call.arguments } },
              ],
            }
          : { role: 'assistant', content: reply.content };
      return this.stream(res, [{ message }, final]);
    }
    if (!isBench)
      return this.stream(res, [
        { message: { role: 'assistant', content: '1. Il fait beau.' } },
        final,
      ]);
    const reply =
      this.behaviour.get(body.model) === 'good'
        ? goodModel(body)
        : { content: 'Je vais lire le fichier pour toi.' };
    const message =
      'call' in reply
        ? {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: reply.call.name, arguments: reply.call.arguments } }],
          }
        : { role: 'assistant', content: reply.content };
    this.stream(res, [{ message }, final]);
  }
}

export type Reply =
  { call: { name: string; arguments: Record<string, unknown> } } | { content: string };

/** Un modèle scripté qui fait chaque tâche du banc correctement, un appel d'outil par tour. */
function goodModel(body: ChatBody): Reply {
  const prompt = body.messages.find((m) => m.role === 'user')?.content ?? '';
  const done = body.messages.filter((m) => m.role === 'tool').length;
  const steps: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  let answer = 'Fait.';
  if (prompt.startsWith('Lis le fichier src/tools/version.ts'))
    steps.push({ name: 'read_file', arguments: { path: 'src/tools/version.ts' } });
  else if (prompt.startsWith('Liste les fichiers'))
    steps.push({ name: 'list_files', arguments: {} });
  else if (prompt.includes('Quelle est la valeur de DEFAULT_MAX_CHARS')) {
    steps.push({ name: 'read_file', arguments: { path: 'src/tools/readFile.ts' } });
    answer = 'DEFAULT_MAX_CHARS vaut 8000.';
  } else if (prompt.startsWith('Enregistre l’outil getJarvisVersionTool')) {
    steps.push(
      { name: 'read_file', arguments: { path: 'src/tools/index.ts' } },
      {
        name: 'edit_file',
        arguments: {
          path: 'src/tools/index.ts',
          search: "import { readFileTool } from './readFile';",
          replace:
            "import { readFileTool } from './readFile';\nimport { getJarvisVersionTool } from './version';",
        },
      },
      {
        name: 'edit_file',
        arguments: {
          path: 'src/tools/index.ts',
          search: 'return [readFileTool];',
          replace: 'return [readFileTool, getJarvisVersionTool];',
        },
      },
    );
  } else if (prompt.startsWith('La compilation échoue')) {
    steps.push(
      { name: 'read_file', arguments: { path: 'src/tools/readFile.ts' } },
      {
        name: 'edit_file',
        arguments: {
          path: 'src/tools/readFile.ts',
          search: 'export const MAX_CHARS_DEFAULT',
          replace: 'export const DEFAULT_MAX_CHARS',
        },
      },
    );
  }
  const next = steps[done];
  return next ? { call: next } : { content: answer };
}

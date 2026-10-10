import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, rename, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEVELOPER_MANUAL_SEED,
  DEVELOPER_MANUAL_SEED_VERSION,
  developerManualSeedContent,
  buildValidatedFix,
  canSaveValidatedFix,
  chunkMarkdownFile,
  formatManualBlock,
  missionLearningOutcome,
  retrieveManualPassages,
  retrieveManualPassagesAsync,
  toManualPassageViews,
  resolveLocalOllamaBase,
  type ManualIndex,
  type ManualPassageView,
  type ManualQuery,
  type MissionKind,
  type MissionLearning,
  type ProjectTemplateId,
  type Settings,
  MANUAL_INDEX_VERSION,
  validatedFixSchema,
  validatedFixToChunk,
  type ValidatedFix,
} from '@jarvis/core';

const EMBED_MODEL = 'nomic-embed-text';
const INDEX_FILE = 'index.json';
const SEED_VERSION_FILE = '.seed-version';
/** Ancien dossier unique (avant séparation shipped / user / learned). */
const LEGACY_MANUAL_DIR = 'manual';
const LEGACY_VALIDATED_DIR = 'validated';

export interface ManualPrepareInput {
  request: string;
  templateId?: ProjectTemplateId;
  failures?: readonly string[];
  settings: Settings;
  installedModels: readonly string[];
}

export interface ManualPrepareResult {
  block: string;
  passages: ManualPassageView[];
}

export interface DeveloperManualStoreOptions {
  userDataPath: () => string;
  fetchImpl?: typeof fetch;
}

export class DeveloperManualStore {
  private index: ManualIndex | null = null;
  private migrated = false;

  constructor(private readonly options: DeveloperManualStoreOptions) {}

  private root(): string {
    return join(this.options.userDataPath(), 'developer', 'knowledge');
  }

  /** Fiches livrées avec Jarvis : mises à jour quand la version seed augmente. */
  private shippedDir(): string {
    return join(this.root(), 'shipped');
  }

  /** Fiches modifiées ou créées par l'utilisateur : jamais touchées par une mise à jour seed. */
  private userDir(): string {
    return join(this.root(), 'user');
  }

  /** Fiches mémorisées après mission réussie (JSON validés). */
  private learnedDir(): string {
    return join(this.root(), 'learned');
  }

  private indexPath(): string {
    return join(this.root(), INDEX_FILE);
  }

  private get fetch(): typeof fetch {
    return this.options.fetchImpl ?? globalThis.fetch;
  }

  private async exists(path: string): Promise<boolean> {
    return access(path).then(
      () => true,
      () => false,
    );
  }

  /** Reprend les anciennes données `manual/` et `validated/` une seule fois. */
  private async migrateLegacyLayout(): Promise<void> {
    if (this.migrated) return;
    this.migrated = true;
    const legacyManual = join(this.root(), LEGACY_MANUAL_DIR);
    if (!(await this.exists(legacyManual))) return;

    await mkdir(this.userDir(), { recursive: true });
    await mkdir(this.shippedDir(), { recursive: true });

    const names = (await readdir(legacyManual).catch(() => [] as string[])).filter((f) =>
      f.endsWith('.md'),
    );
    for (const name of names) {
      const legacyPath = join(legacyManual, name);
      const text = await readFile(legacyPath, 'utf8');
      const seedBody = DEVELOPER_MANUAL_SEED[name];
      const userPath = join(this.userDir(), name);
      if (!seedBody) {
        if (!(await this.exists(userPath))) {
          await writeFile(userPath, text, { encoding: 'utf8', mode: 0o600 });
        }
        continue;
      }
      if (text.trim() !== seedBody.trim() && !(await this.exists(userPath))) {
        await writeFile(userPath, text, { encoding: 'utf8', mode: 0o600 });
      }
    }

    const legacyVersion = join(legacyManual, SEED_VERSION_FILE);
    const shippedVersion = join(this.shippedDir(), SEED_VERSION_FILE);
    if ((await this.exists(legacyVersion)) && !(await this.exists(shippedVersion))) {
      const raw = await readFile(legacyVersion, 'utf8');
      await writeFile(shippedVersion, raw, { encoding: 'utf8', mode: 0o600 });
    }

    const legacyValidated = join(this.root(), LEGACY_VALIDATED_DIR);
    if (await this.exists(legacyValidated)) {
      await mkdir(this.learnedDir(), { recursive: true });
      for (const name of (await readdir(legacyValidated).catch(() => [] as string[])).filter((f) =>
        f.endsWith('.json'),
      )) {
        const dest = join(this.learnedDir(), name);
        if (!(await this.exists(dest))) {
          await rename(join(legacyValidated, name), dest).catch(async () => {
            const text = await readFile(join(legacyValidated, name), 'utf8');
            await writeFile(dest, text, { encoding: 'utf8', mode: 0o600 });
          });
        }
      }
    }

    await rm(legacyManual, { recursive: true, force: true }).catch(() => undefined);
    await rm(legacyValidated, { recursive: true, force: true }).catch(() => undefined);
    this.index = null;
  }

  async ensureSeed(): Promise<void> {
    await this.migrateLegacyLayout();
    const shipped = this.shippedDir();
    await mkdir(shipped, { recursive: true });
    await mkdir(this.userDir(), { recursive: true });
    await mkdir(this.learnedDir(), { recursive: true });

    let installedVersion = 0;
    try {
      const raw = await readFile(join(shipped, SEED_VERSION_FILE), 'utf8');
      installedVersion = Number.parseInt(raw.trim(), 10) || 0;
    } catch {
      /* première copie */
    }

    const refreshShipped = installedVersion < DEVELOPER_MANUAL_SEED_VERSION;
    for (const name of Object.keys(DEVELOPER_MANUAL_SEED)) {
      const path = join(shipped, name);
      const missing = !(await this.exists(path));
      if (!refreshShipped && !missing) continue;
      await writeFile(path, developerManualSeedContent(name), {
        encoding: 'utf8',
        mode: 0o600,
      });
      this.index = null;
    }

    if (!refreshShipped) return;
    await writeFile(join(shipped, SEED_VERSION_FILE), String(DEVELOPER_MANUAL_SEED_VERSION), {
      encoding: 'utf8',
      mode: 0o600,
    });
    this.index = null;
  }

  private chunkDigest(chunk: { source: string; section: string; text: string }): string {
    return createHash('sha256')
      .update(chunk.source)
      .update('\0')
      .update(chunk.section)
      .update('\0')
      .update(chunk.text)
      .digest('hex');
  }

  async loadValidatedFixes(): Promise<ValidatedFix[]> {
    const dir = this.learnedDir();
    await mkdir(dir, { recursive: true });
    const names = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json'));
    const out: ValidatedFix[] = [];
    for (const name of names) {
      try {
        const parsed = validatedFixSchema.safeParse(
          JSON.parse(await readFile(join(dir, name), 'utf8')),
        );
        if (parsed.success) out.push(parsed.data);
      } catch {
        /* ignore corrupt */
      }
    }
    return out;
  }

  async saveValidatedFix(
    fix: ValidatedFix,
    settings: Settings,
    installedModels: readonly string[],
  ): Promise<void> {
    await mkdir(this.learnedDir(), { recursive: true });
    const path = join(this.learnedDir(), `${fix.id}.json`);
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(fix, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, path);
    this.index = null;
    await this.rebuildIndex(settings, installedModels);
  }

  /** Indexe shipped + user ; une fiche user du même nom masque la fiche shipped. */
  private async listManualMarkdown(): Promise<Array<{ file: string; text: string; origin: 'user' | 'shipped' }>> {
    await this.ensureSeed();
    const userNames = new Set(
      (await readdir(this.userDir()).catch(() => [] as string[])).filter((f) => f.endsWith('.md')),
    );
    const out: Array<{ file: string; text: string; origin: 'user' | 'shipped' }> = [];
    for (const name of userNames) {
      const text = await readFile(join(this.userDir(), name), 'utf8');
      out.push({ file: name, text, origin: 'user' });
    }
    for (const name of (await readdir(this.shippedDir()).catch(() => [] as string[])).filter((f) =>
      f.endsWith('.md'),
    )) {
      if (userNames.has(name)) continue;
      const text = await readFile(join(this.shippedDir(), name), 'utf8');
      out.push({ file: name, text, origin: 'shipped' });
    }
    return out;
  }

  async rebuildIndex(settings: Settings, installedModels: readonly string[]): Promise<void> {
    const flat = [];
    for (const { file, text } of await this.listManualMarkdown()) {
      flat.push(...chunkMarkdownFile(file, text));
    }
    for (const fix of await this.loadValidatedFixes()) {
      flat.push(validatedFixToChunk(fix));
    }
    const previous = await this.loadIndex();
    const prevById = new Map(previous.chunks.map((c) => [c.id, c]));
    const embed = this.embedFn(settings, installedModels);
    for (const chunk of flat) {
      const digest = this.chunkDigest(chunk);
      chunk.contentDigest = digest;
      const prev = prevById.get(chunk.id);
      if (prev?.embedding?.length && prev.contentDigest === digest) {
        chunk.embedding = prev.embedding;
        continue;
      }
      if (!embed) continue;
      chunk.embedding =
        (await embed(`${chunk.section}\n${chunk.text}`).catch(() => null)) ?? undefined;
    }
    this.index = { version: MANUAL_INDEX_VERSION, chunks: flat };
    await this.saveIndex();
  }

  private async loadIndex(): Promise<ManualIndex> {
    if (this.index) return this.index;
    try {
      const raw = JSON.parse(await readFile(this.indexPath(), 'utf8')) as ManualIndex;
      if (raw?.version === MANUAL_INDEX_VERSION && Array.isArray(raw.chunks)) {
        this.index = raw;
        return raw;
      }
    } catch {
      /* premier lancement */
    }
    return { version: MANUAL_INDEX_VERSION, chunks: [] };
  }

  private async saveIndex(): Promise<void> {
    const snapshot = JSON.stringify(this.index ?? { version: MANUAL_INDEX_VERSION, chunks: [] });
    await mkdir(this.root(), { recursive: true });
    const tmp = `${this.indexPath()}.tmp`;
    await writeFile(tmp, snapshot, { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, this.indexPath());
  }

  private embedFn(settings: Settings, installedModels: readonly string[]) {
    if (!installedModels.some((m) => m === EMBED_MODEL || m.startsWith(`${EMBED_MODEL}:`))) {
      return null;
    }
    const base = resolveLocalOllamaBase(settings);
    return async (text: string): Promise<number[] | null> => {
      const body = { model: EMBED_MODEL, input: text.slice(0, 8000) };
      const modern = await this.fetch(`${base}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      }).catch(() => null);
      if (modern?.ok) {
        const data = (await modern.json()) as { embeddings?: number[][] };
        const vector = data.embeddings?.[0];
        if (Array.isArray(vector) && vector.length >= 16) return vector;
      }
      const legacy = await this.fetch(`${base}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 8000) }),
        signal: AbortSignal.timeout(12_000),
      }).catch(() => null);
      if (!legacy?.ok) return null;
      const data = (await legacy.json()) as { embedding?: number[] };
      return Array.isArray(data.embedding) && data.embedding.length >= 16 ? data.embedding : null;
    };
  }

  async prepare(input: ManualPrepareInput): Promise<ManualPrepareResult> {
    if (input.settings.developer.knowledgeManual === false) {
      return { block: '', passages: [] };
    }
    let index = await this.loadIndex();
    if (!index.chunks.length) {
      await this.rebuildIndex(input.settings, input.installedModels);
      index = await this.loadIndex();
    }
    const query: ManualQuery = {
      text: input.request,
      templateId: input.templateId,
      failures: input.failures,
    };
    const embed = this.embedFn(input.settings, input.installedModels);
    const passages = embed
      ? await retrieveManualPassagesAsync(index, query, embed)
      : retrieveManualPassages(index, query);
    const block = formatManualBlock(passages);
    return { block, passages: toManualPassageViews(passages) };
  }

  /** Enregistre une fiche si la mission a réussi après correction (sinon explique pourquoi non). */
  async tryLearningFromTask(input: {
    settings: Settings;
    installedModels: readonly string[];
    missionKind: MissionKind;
    request: string;
    model: string;
    templateId?: ProjectTemplateId;
    reportVerdict: 'success' | 'failed' | 'stopped' | null;
    repeatedFailure: boolean;
    reviewBlocking: readonly string[];
    planSummary: string;
    filesTouched: readonly string[];
    testSuites: readonly string[];
    runs: ReadonlyArray<{ newFailures: readonly string[] }>;
    checkpoint?: string;
    now: number;
  }): Promise<MissionLearning> {
    const hadNewFailures = input.runs.some((r) => r.newFailures.length > 0);
    const gate = canSaveValidatedFix({
      learningEnabled: input.settings.developer.knowledgeLearning !== false,
      reportVerdict: input.reportVerdict,
      repeatedFailure: input.repeatedFailure,
      reviewBlockingCount: input.reviewBlocking.length,
      hadNewFailures,
    });
    if (!gate.ok) return missionLearningOutcome(gate);
    const fix = buildValidatedFix({
      missionKind: input.missionKind,
      request: input.request,
      model: input.model,
      templateId: input.templateId,
      planSummary: input.planSummary,
      filesTouched: input.filesTouched,
      testSuites: input.testSuites,
      runs: input.runs,
      checkpoint: input.checkpoint,
      now: input.now,
    });
    await this.saveValidatedFix(fix, input.settings, input.installedModels);
    return missionLearningOutcome(gate, fix.id);
  }
}

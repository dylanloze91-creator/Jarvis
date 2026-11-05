import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  applyQuestionnaireAnswers,
  emptyQuestionnaireState,
  questionnaireSettingsBackup,
  type QuestionnaireState,
  type Settings,
} from '@jarvis/core';

function readFileState(raw: string): QuestionnaireState {
  try {
    const data = JSON.parse(raw) as Partial<QuestionnaireState>;
    const base = emptyQuestionnaireState();
    return {
      answers: typeof data.answers === 'object' && data.answers !== null ? { ...data.answers } : base.answers,
      dismissed: data.dismissed === true,
      completedAt: typeof data.completedAt === 'number' ? data.completedAt : null,
      settingsBackup:
        typeof data.settingsBackup === 'object' && data.settingsBackup !== null
          ? (data.settingsBackup as Partial<Settings>)
          : null,
      preferredServices: Array.isArray(data.preferredServices)
        ? data.preferredServices.filter((item): item is string => typeof item === 'string')
        : base.preferredServices,
      windowPreference: data.windowPreference === 'dashboard' ? 'dashboard' : 'compact',
    };
  } catch {
    return emptyQuestionnaireState();
  }
}

/**
 * 5.0.70 — questionnaire d’accueil dans `userData/questionnaire.json`
 * (hors de `settings.json`, comme le téléphone).
 */
export class QuestionnaireStore {
  private state: QuestionnaireState = emptyQuestionnaireState();
  private loaded = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: () => string) {}

  static inUserData(userData: () => string): QuestionnaireStore {
    return new QuestionnaireStore(() => join(userData(), 'questionnaire.json'));
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      this.state = readFileState(await readFile(this.filePath(), 'utf8'));
    } catch {
      this.state = emptyQuestionnaireState();
    }
    this.loaded = true;
  }

  snapshot(): QuestionnaireState {
    return structuredClone(this.state);
  }

  async set(patch: Partial<QuestionnaireState>): Promise<QuestionnaireState> {
    await this.load();
    this.state = {
      ...this.state,
      ...patch,
      answers: patch.answers ? { ...this.state.answers, ...patch.answers } : this.state.answers,
    };
    await this.save();
    return this.snapshot();
  }

  /** Applique les réponses au fichier de réglages ; garde une sauvegarde partielle pour restaurer. */
  async apply(
    readSettings: () => Promise<Settings>,
    writeSettings: (settings: Settings) => Promise<void>,
  ): Promise<{ state: QuestionnaireState; settings: Settings }> {
    await this.load();
    const current = await readSettings();
    const backup = questionnaireSettingsBackup(current);
    const { patch, preferredServices, windowPreference } = applyQuestionnaireAnswers(
      current,
      this.state.answers,
    );
    const next: Settings = { ...current, ...patch };
    await writeSettings(next);
    this.state = {
      ...this.state,
      settingsBackup: backup,
      preferredServices,
      windowPreference,
      completedAt: Date.now(),
      dismissed: false,
    };
    await this.save();
    return { state: this.snapshot(), settings: next };
  }

  /** Restaure les réglages sauvegardés avant la dernière application du questionnaire. */
  async restore(
    readSettings: () => Promise<Settings>,
    writeSettings: (settings: Settings) => Promise<void>,
  ): Promise<{ state: QuestionnaireState; settings: Settings | null }> {
    await this.load();
    const backup = this.state.settingsBackup;
    if (!backup) return { state: this.snapshot(), settings: null };
    const current = await readSettings();
    const next: Settings = { ...current, ...backup };
    await writeSettings(next);
    this.state = { ...this.state, settingsBackup: null };
    await this.save();
    return { state: this.snapshot(), settings: next };
  }

  private save(): Promise<void> {
    const snapshot = JSON.stringify(this.state, null, 2);
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        const target = this.filePath();
        await mkdir(dirname(target), { recursive: true });
        const temp = `${target}.tmp`;
        await writeFile(temp, snapshot, { encoding: 'utf8', mode: 0o600 });
        await rename(temp, target);
      });
    return this.writing;
  }
}

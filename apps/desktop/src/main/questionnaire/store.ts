import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  emptyPersonalization,
  emptyQuestionnaireState,
  normalizeQuestionnaireSettingsBackup,
  onboardingPlanFromAnswers,
  questionnaireSettingsBackup,
  questionnaireSettingsRestore,
  type OnboardingEnvironment,
  type PersonalizationProfile,
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
      settingsBackup: normalizeQuestionnaireSettingsBackup(data.settingsBackup, emptyPersonalization()),
      preferredServices: Array.isArray(data.preferredServices)
        ? data.preferredServices.filter((item): item is string => typeof item === 'string')
        : base.preferredServices,
      windowPreference: data.windowPreference === 'dashboard' ? 'dashboard' : 'compact',
    };
  } catch {
    return emptyQuestionnaireState();
  }
}

export interface QuestionnaireApplyDeps {
  readSettings: () => Promise<Settings>;
  writeSettingsPatch: (patch: Partial<Settings>) => Promise<Settings>;
  mergePersonalization: (patch: Partial<PersonalizationProfile>) => Promise<void>;
  replacePersonalization: (profile: PersonalizationProfile) => Promise<void>;
  environment: OnboardingEnvironment;
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

  async wipe(): Promise<QuestionnaireState> {
    await this.load();
    this.state = emptyQuestionnaireState();
    await this.save();
    return this.snapshot();
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

  /** Applique les réponses après « C'est bon » ; garde une sauvegarde pour restaurer. */
  async apply(deps: QuestionnaireApplyDeps): Promise<{ state: QuestionnaireState; settings: Settings; openDashboard: boolean }> {
    await this.load();
    const current = await deps.readSettings();
    const plan = onboardingPlanFromAnswers(this.state.answers, current, deps.environment);
    if (plan.changes.length === 0) {
      return { state: this.snapshot(), settings: current, openDashboard: false };
    }
    const backup = questionnaireSettingsBackup(current, deps.environment.personalization);
    const settings = await deps.writeSettingsPatch(plan.patch);
    if (Object.keys(plan.personalization).length > 0) {
      await deps.mergePersonalization(plan.personalization);
    }
    this.state = {
      ...this.state,
      settingsBackup: backup,
      preferredServices: plan.preferredServices,
      windowPreference: plan.windowPreference,
      completedAt: Date.now(),
      dismissed: false,
    };
    await this.save();
    return { state: this.snapshot(), settings, openDashboard: plan.openDashboard };
  }

  async restore(deps: {
    readSettings: () => Promise<Settings>;
    writeSettings: (next: Settings) => Promise<Settings>;
    replacePersonalization: (profile: PersonalizationProfile) => Promise<void>;
  }): Promise<{ state: QuestionnaireState; settings: Settings | null }> {
    await this.load();
    const backup = this.state.settingsBackup;
    if (!backup) return { state: this.snapshot(), settings: null };
    const current = await deps.readSettings();
    const restored = questionnaireSettingsRestore(current, backup);
    const settings = await deps.writeSettings(restored);
    await deps.replacePersonalization(backup.personalization);
    this.state = { ...this.state, settingsBackup: null };
    await this.save();
    return { state: this.snapshot(), settings };
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

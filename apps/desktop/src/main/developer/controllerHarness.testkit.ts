import { join } from 'node:path';
import {
  InMemoryAuditLogStore,
  classifyCommand,
  createDefaultRegistry,
  parseSettings,
  type CommandSafetyLevel,
  type Settings,
} from '@jarvis/core';
import type { DevConfirmation, DeveloperState } from '../../shared/developerIpc.js';
import { DeveloperController } from './controller.js';
import type { FakeOllama } from './models/fakeOllama.testkit.js';
import {
  CommandRefusedError,
  displayCommand,
  refusalOf,
  runProcess,
  type RunOutcome,
  type RunSpec,
  type Runner,
} from './runner.js';
import { ChatActivity } from './task/chatActivity.js';

export interface Harness {
  instance: DeveloperController;
  states: DeveloperState[];
  cards: DevConfirmation[];
  ran: Array<{ display: string; level: CommandSafetyLevel }>;
  audit: InMemoryAuditLogStore;
  chat: ChatActivity;
  settings: Settings;
}

export interface HarnessOptions {
  base: string;
  repo: string;
  fake: FakeOllama;
  developer: Record<string, unknown>;
  /** Réponse à chaque carte de confirmation (défaut : tout accepter). */
  answer?: (card: DevConfirmation) => boolean;
  approvePlan?: boolean;
  appVersion?: string;
  /** Remplace une commande (npm hors ligne) ; null = la vraie. Le tri de sécurité s'applique quand même. */
  intercept?: (spec: RunSpec, display: string) => RunOutcome | null;
}

/** Résultat de commande simulé, pour `intercept`. */
export function fakeOutcome(display: string, stdout = '', code = 0): RunOutcome {
  return {
    display,
    code,
    stdout,
    stderr: '',
    timedOut: false,
    cancelled: false,
    truncated: false,
    error: null,
  };
}

/** Contrôleur Développeur réel, faux Ollama scripté, vraies commandes git et npm. */
export function createHarness(options: HarnessOptions): Harness {
  const settings = parseSettings({
    provider: 'ollama',
    model: 'qwen2.5:3b',
    baseUrl: options.fake.url,
    developer: { enabled: true, repoPath: options.repo, ...options.developer },
  });
  const states: DeveloperState[] = [];
  const cards: DevConfirmation[] = [];
  const ran: Harness['ran'] = [];
  const audit = new InMemoryAuditLogStore();
  const chat = new ChatActivity();
  const run: Runner = (spec) => {
    const display = spec.display ?? displayCommand(spec.program, spec.args);
    ran.push({ display, level: classifyCommand(display, spec.context ?? {}).level });
    const faked = options.intercept?.(spec, display);
    if (faked) {
      const refusal = refusalOf(spec, display);
      return refusal
        ? Promise.reject(new CommandRefusedError(display, refusal))
        : Promise.resolve(faked);
    }
    return runProcess(spec);
  };
  const seen = new Set<string>();
  let answeredPlan = false;
  const harness = { states, cards, ran, audit, chat, settings } as Harness;
  harness.instance = new DeveloperController({
    getSettings: () => settings,
    appVersion: () => options.appVersion ?? '0.0.1',
    platform: process.platform,
    home: join(options.base, 'home'),
    logsDir: () => join(options.base, 'logs'),
    oneDriveRoots: () => [],
    auditLog: audit,
    freeBytes: async () => 400e9,
    registry: createDefaultRegistry(),
    userDataPath: () => join(options.base, 'userData'),
    env: {},
    run,
    chat,
    chatGraceMs: 0,
    emit: (state) => {
      states.push(structuredClone(state));
      const card = state.confirmation;
      if (card && !seen.has(card.requestId)) {
        seen.add(card.requestId);
        cards.push(structuredClone(card));
        const ok = options.answer ? options.answer(card) : true;
        setTimeout(() => harness.instance.respondConfirmation(card.requestId, ok), 0);
      }
      if (state.codeTask?.status === 'awaiting-approval' && !answeredPlan) {
        answeredPlan = true;
        setTimeout(() => harness.instance.approvePlan(options.approvePlan ?? true), 0);
      }
    },
  });
  return harness;
}

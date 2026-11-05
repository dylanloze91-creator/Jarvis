import { SUGGESTED_ORCHESTRA } from '../agent/orchestraTeams.js';
import { PERSONA_STYLE_LABELS, type PersonaStyle } from '../agent/persona.js';
import type { PersonalizationProfile } from '../personalization/types.js';
import { parseSettings, type Settings } from '../settings.js';
import type {
  OnboardingEnvironment,
  OnboardingPlanResult,
  OnboardingServiceId,
  QuestionnaireAnswers,
} from './types.js';
import { ONBOARDING_SERVICE_IDS } from './types.js';

const SHORT_RULE = 'Réponds court, en une ou deux phrases quand c’est possible.';
const DETAIL_RULE = 'Détaille tes réponses quand c’est utile, avec des exemples concrets.';


function voiceEnabled(settings: Settings): string {
  return settings.voice.enabled ? 'Écoute activée' : 'Écoute coupée';
}

function followUpLabel(settings: Settings): string {
  const seconds = settings.voice.followUpSeconds ?? 8;
  if (!settings.voice.enabled) return 'Sans écoute';
  if (seconds === 0) return 'Mot de réveil à chaque fois';
  return `Enchaînement ${seconds} s sans redire « Jarvis »`;
}

function orchestraEnabled(settings: Settings): boolean {
  return settings.provider === 'ollama' && settings.orchestra?.enabled === true;
}

function personaLabel(settings: Settings): string {
  const persona = settings.persona;
  if (!persona || persona.enabled !== true) return 'Sans personnage';
  const style = persona.style as PersonaStyle;
  return PERSONA_STYLE_LABELS[style]?.label ?? 'Caractère activé';
}

function policySummary(settings: Settings): string {
  const { apps, files, capture } = settings.toolPolicies;
  const line = (label: string, value: string) => `${label} : ${value === 'always' ? 'toujours' : value === 'destructive-only' ? 'si risqué' : value}`;
  return [line('Applis', apps), line('Fichiers', files), line('Captures', capture)].join(' · ');
}

function orchestraModelsReady(models: string[]): boolean {
  return models.length > 0 && models.includes(SUGGESTED_ORCHESTRA.brain);
}

function orderedServices(selected: OnboardingServiceId[] | undefined): OnboardingServiceId[] {
  const picked = selected?.filter((id): id is OnboardingServiceId =>
    (ONBOARDING_SERVICE_IDS as readonly string[]).includes(id),
  );
  if (!picked?.length) return [...ONBOARDING_SERVICE_IDS];
  const rest = ONBOARDING_SERVICE_IDS.filter((id) => !picked.includes(id));
  return [...picked, ...rest];
}

function mergeRules(existing: string[], remove: string[], add: string | null): string[] {
  let rules = existing.filter((rule) => !remove.includes(rule));
  if (add && !rules.includes(add)) rules = [...rules, add];
  return rules;
}

function pushChange(
  changes: OnboardingPlanResult['changes'],
  label: string,
  before: string,
  after: string,
): void {
  if (before === after) return;
  changes.push({ label, before, after });
}

/** Plan pur : aucune écriture disque, aucun réseau. */
export function onboardingPlan(
  answers: QuestionnaireAnswers,
  current: Settings,
  environment: OnboardingEnvironment,
): OnboardingPlanResult {
  const changes: OnboardingPlanResult['changes'] = [];
  const patch: Partial<Settings> = {};
  let personalization: Partial<PersonalizationProfile> = {};
  let setupGuideHint: string | null = null;
  let windowPreference: 'compact' | 'dashboard' = 'compact';
  let openDashboard = false;

  const settings = parseSettings(current);

  const firstName = typeof answers.firstName === 'string' ? answers.firstName.trim() : '';
  if (firstName) {
    const beforeName =
      environment.personalization.user.prenom ??
      environment.personalization.user.prénom ??
      environment.personalization.user.name ??
      'Non renseigné';
    pushChange(changes, 'Comment je t’appelle', beforeName, firstName);
    personalization = {
      user: { ...environment.personalization.user, prenom: firstName },
    };
  }

  const talkMode = answers.talkMode;
  if (talkMode === 'voice' || talkMode === 'both' || talkMode === 'keyboard') {
    const nextVoice = { ...settings.voice };
    if (talkMode === 'voice' || talkMode === 'both') {
      nextVoice.enabled = true;
      nextVoice.followUpSeconds = 8;
    } else {
      nextVoice.enabled = false;
      nextVoice.followUpSeconds = 0;
    }
    pushChange(changes, 'Écoute du micro', voiceEnabled(settings), voiceEnabled({ ...settings, voice: nextVoice }));
    pushChange(
      changes,
      'Discussion sans « Jarvis »',
      followUpLabel(settings),
      followUpLabel({ ...settings, voice: nextVoice }),
    );
    patch.voice = nextVoice;
  }

  const selectedServices = Array.isArray(answers.services)
    ? (answers.services as OnboardingServiceId[])
    : undefined;
  const preferredServices = orderedServices(selectedServices);

  const character = answers.character;
  if (character === 'neutral') {
    pushChange(changes, 'Caractère de Jarvis', personaLabel(settings), 'Sans personnage');
    patch.persona = { ...(settings.persona ?? { enabled: false, style: 'complice', humour: true }), enabled: false };
  } else if (character === 'complice' || character === 'majordome' || character === 'direct') {
    pushChange(
      changes,
      'Caractère de Jarvis',
      personaLabel(settings),
      PERSONA_STYLE_LABELS[character].label,
    );
    patch.persona = {
      enabled: true,
      style: character,
      humour: settings.persona?.humour !== false,
    };
  }

  const answerStyle = answers.answerStyle;
  if (answerStyle === 'short' || answerStyle === 'detailed') {
    const beforeRules = environment.personalization.rules.join(' ') || 'Consignes habituelles';
    const nextRules = mergeRules(
      environment.personalization.rules,
      [SHORT_RULE, DETAIL_RULE],
      answerStyle === 'short' ? SHORT_RULE : DETAIL_RULE,
    );
    pushChange(
      changes,
      'Longueur des réponses',
      beforeRules.includes(SHORT_RULE) ? 'Courtes' : beforeRules.includes(DETAIL_RULE) ? 'Détaillées' : 'Comme aujourd’hui',
      answerStyle === 'short' ? 'Courtes' : 'Détaillées',
    );
    personalization = { ...personalization, rules: nextRules };
  }

  const confirmBefore = answers.confirmBefore;
  if (confirmBefore === 'always' || confirmBefore === 'risky') {
    const policy = confirmBefore === 'always' ? ('always' as const) : ('destructive-only' as const);
    const nextPolicies = {
      ...settings.toolPolicies,
      apps: policy,
      files: policy,
      capture: policy,
    };
    pushChange(changes, 'Avant d’agir sur ton PC', policySummary(settings), policySummary({ ...settings, toolPolicies: nextPolicies }));
    patch.toolPolicies = nextPolicies;
  }

  const wantsOrchestra = answers.orchestra === 'yes';
  const canOrchestra = settings.provider === 'ollama' && orchestraModelsReady(environment.ollamaModels);
  if (wantsOrchestra && canOrchestra) {
    const brain = settings.orchestra?.brain?.trim() || settings.model || SUGGESTED_ORCHESTRA.brain;
    const teams = settings.orchestra?.teams ?? SUGGESTED_ORCHESTRA.teams;
    pushChange(
      changes,
      'Chef d’orchestre',
      orchestraEnabled(settings) ? 'Activé' : 'Coupé',
      'Activé',
    );
    patch.orchestra = { enabled: true, brain, teams };
  } else if (wantsOrchestra && !canOrchestra) {
    pushChange(
      changes,
      'Chef d’orchestre',
      orchestraEnabled(settings) ? 'Activé' : 'Coupé',
      'Coupé (modèles manquants sur ce PC)',
    );
  } else if (answers.orchestra === 'no' && settings.orchestra) {
    pushChange(changes, 'Chef d’orchestre', orchestraEnabled(settings) ? 'Activé' : 'Coupé', 'Coupé');
    patch.orchestra = { ...settings.orchestra, enabled: false };
  }

  if (patch.persona?.enabled === true && !orchestraEnabled({ ...settings, ...patch }) && wantsOrchestra === false) {
    pushChange(
      changes,
      'Caractère et chef d’orchestre',
      'Le caractère marche mieux avec le chef d’orchestre',
      'Pense à activer le chef d’orchestre dans les réglages',
    );
  }

  const wantsCode = selectedServices?.includes('code');
  if (wantsCode && environment.developerRepoValid) {
    const dev = { ...settings.developer, enabled: true, chatMissions: true };
    pushChange(
      changes,
      'Code et missions depuis la discussion',
      settings.developer.enabled ? 'Développeur activé' : 'Développeur coupé',
      'Développeur et missions depuis la discussion activés',
    );
    patch.developer = dev;
    if (!orchestraEnabled({ ...settings, ...patch })) {
      pushChange(
        changes,
        'Missions depuis la discussion',
        'Chef d’orchestre requis',
        'Active aussi le chef d’orchestre pour lancer des missions depuis la discussion',
      );
    }
  } else if (wantsCode && !environment.developerRepoValid) {
    setupGuideHint = 'Pour le code et les projets, ouvre « Comment tout brancher » et choisis une copie de travail valide.';
  }

  const layout = answers.windowLayout;
  if (layout === 'compact' || layout === 'dashboard') {
    windowPreference = layout;
    openDashboard = layout === 'dashboard';
    pushChange(
      changes,
      'Ouverture de Jarvis',
      'Comme aujourd’hui',
      layout === 'dashboard' ? 'Grand tableau de bord' : 'Petite fenêtre',
    );
  }

  const onTop = answers.alwaysOnTop;
  if (onTop === 'yes' || onTop === 'no') {
    const stay = onTop === 'yes';
    pushChange(
      changes,
      'Reste visible',
      settings.stayVisibleOnBlur ? 'Oui' : 'Non',
      stay ? 'Oui' : 'Non',
    );
    patch.stayVisibleOnBlur = stay;
  }

  return {
    changes,
    patch,
    personalization,
    preferredServices,
    windowPreference,
    openDashboard,
    setupGuideHint,
  };
}

/** Champs à sauvegarder avant d’appliquer le questionnaire (retour arrière). */
export function questionnaireSettingsBackup(settings: Settings): Partial<Settings> {
  const keys: (keyof Settings)[] = [
    'voice',
    'persona',
    'orchestra',
    'developer',
    'toolPolicies',
    'stayVisibleOnBlur',
  ];
  const backup: Partial<Settings> = {};
  for (const key of keys) {
    const value = settings[key];
    if (value !== undefined) (backup as Record<string, unknown>)[key] = structuredClone(value);
  }
  return backup;
}

/** Réponses vides → aucun changement. */
export function onboardingPlanFromAnswers(
  answers: QuestionnaireAnswers,
  current: Settings,
  environment: OnboardingEnvironment,
): OnboardingPlanResult {
  const hasAnswer = Object.values(answers).some(
    (value) => (typeof value === 'string' && value.trim()) || (Array.isArray(value) && value.length > 0),
  );
  if (!hasAnswer) {
    return {
      changes: [],
      patch: {},
      personalization: {},
      preferredServices: [...ONBOARDING_SERVICE_IDS],
      windowPreference: 'compact',
      openDashboard: false,
      setupGuideHint: null,
    };
  }
  return onboardingPlan(answers, current, environment);
}

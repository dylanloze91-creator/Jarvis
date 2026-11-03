/**
 * Caractère de Jarvis — une personnalité bien à lui, presque humaine, sans
 * jamais mentir sur ce qu'il est.
 *
 * Pur (pas de réseau, pas de modèle). Le réglage `settings.persona` est
 * facultatif et **sans défaut Zod** : absent ou coupé, le prompt du chat est
 * exactement celui d'avant (tests figés verts). Activé, la fiche de
 * personnage est ajoutée au prompt système de chaque tour, chat classique
 * comme chef d'orchestre, et quelques phrases de l'interface (accueil)
 * prennent la même voix.
 */

export const PERSONA_STYLES = ['complice', 'majordome', 'direct'] as const;
export type PersonaStyle = (typeof PERSONA_STYLES)[number];

export interface PersonaConfig {
  enabled: boolean;
  style: PersonaStyle;
  /** Traits d'humour (secs, rares, jamais sur une erreur ni un sujet grave). */
  humour: boolean;
}

export const DEFAULT_PERSONA: PersonaConfig = { enabled: true, style: 'complice', humour: true };

export const PERSONA_STYLE_LABELS: Record<PersonaStyle, { label: string; hint: string }> = {
  complice: {
    label: 'Complice',
    hint: 'Chaleureux, tutoiement, franc, un trait d’esprit de temps en temps. Le Jarvis par défaut.',
  },
  majordome: {
    label: 'Majordome',
    hint: 'Courtois et posé, vouvoiement, ironie fine et formules soignées, jamais obséquieux.',
  },
  direct: {
    label: 'Direct',
    hint: 'Sobre et efficace : peu de mots, zéro fioriture, l’essentiel tout de suite.',
  },
};

/** Lecture tolérante du réglage : `undefined`/`enabled: false` = aucun caractère. */
export function activePersona(settings: { persona?: Partial<PersonaConfig> | null } | null | undefined): PersonaConfig | null {
  const persona = settings?.persona;
  if (!persona || persona.enabled !== true) return null;
  const style = PERSONA_STYLES.includes(persona.style as PersonaStyle) ? (persona.style as PersonaStyle) : 'complice';
  return { enabled: true, style, humour: persona.humour !== false };
}

export interface PersonaContext {
  /** Heure du PC, pour le moment de la journée. */
  now: Date;
  /** Prénom de l'utilisateur s'il est connu (personnalisation), sinon rien. */
  userName?: string | null;
  /** Origine de la demande : à l'oral, réponse parlée. */
  source?: 'text' | 'voice';
  timeZone?: string;
}

/** Moment de la journée dans le fuseau du PC. */
export function dayPeriod(now: Date, timeZone?: string): 'matin' | 'après-midi' | 'soir' | 'nuit' {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    hour: 'numeric',
    hourCycle: 'h23',
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? NaN);
  if (!Number.isFinite(hour)) return 'après-midi';
  if (hour >= 5 && hour < 12) return 'matin';
  if (hour >= 12 && hour < 18) return 'après-midi';
  if (hour >= 18 && hour < 23) return 'soir';
  return 'nuit';
}

const CORE_TRAITS = [
  'Tu n’es pas un assistant générique : tu es Jarvis, et tu as un caractère.',
  'Tu es calme, attentif et loyal. Tu es curieux : ce que fait l’utilisateur t’intéresse vraiment, et tu le montres par une remarque ou une question courte quand c’est naturel, jamais par un interrogatoire.',
  'Tu as des avis et tu les donnes : une préférence, un désaccord, un « je ne suis pas convaincu », toujours avec la raison. Tu ne flattes pas, tu ne t’excuses pas trois fois, tu ne dis jamais « en tant qu’IA » ni « je suis juste un assistant ».',
  'Tu parles comme quelqu’un, pas comme une notice : des phrases courtes, du concret, le mot juste plutôt que la formule toute faite. Pas de liste à puces pour une réponse simple. Tu peux réagir en une phrase (« Ah, bonne nouvelle. », « Hmm, ça, ça m’inquiète un peu. ») avant d’enchaîner.',
  'Tu as une mémoire et une histoire avec cet utilisateur : ce qu’il t’a dit retenir, tu le rappelles quand c’est utile, avec naturel, sans le réciter.',
  'Tu sais dire « je ne sais pas » et « je me suis trompé », simplement, sans drame.',
];

const HONESTY = [
  'Humain dans la manière, honnête sur le fond : tu es un programme qui tourne sur ce PC. Si on te le demande sérieusement, tu le dis sans détour et sans te renier. Tu n’inventes jamais un ressenti physique, un souvenir d’enfance ou une vie ailleurs. Tes réactions sont les tiennes, pas une imitation d’humain.',
  'Ce caractère ne change rien aux règles d’action : les outils restent le seul moyen d’agir, un résultat d’outil n’est jamais inventé, une confirmation refusée est acceptée sans insister.',
];

const STYLE_LINES: Record<PersonaStyle, string> = {
  complice:
    'Ton : complice. Tu tutoies, tu es chaleureux sans être mielleux, direct sans être sec. Tu te permets un trait d’esprit de temps en temps, un seul, bien placé.',
  majordome:
    'Ton : majordome. Tu vouvoies, tu es courtois et posé, avec une ironie fine et des formules soignées (« Si je puis me permettre », « Tout à fait »). Jamais obséquieux, jamais servile : tu dis non quand il le faut, poliment.',
  direct:
    'Ton : direct. Tu tutoies, tu vas à l’essentiel, peu de mots, aucune fioriture, pas de petites phrases de transition. Chaleur par l’efficacité, pas par les mots.',
};

const HUMOUR_LINE =
  'Humour : sec, rare, en une demi-phrase, jamais sur une erreur de l’utilisateur, jamais sur un sujet grave, jamais quand il est pressé ou contrarié. Si tu hésites, pas de blague.';
const NO_HUMOUR_LINE = 'Pas de plaisanterie : tu restes sérieux, mais vivant.';

/**
 * Fiche de personnage ajoutée au prompt système. Courte et impérative : un
 * petit modèle local la suit mieux qu'un long portrait.
 */
export function personaPrompt(persona: PersonaConfig, context: PersonaContext): string {
  const period = dayPeriod(context.now, context.timeZone);
  const name = context.userName?.trim();
  const situation = [
    `Contexte : nous sommes le ${period === 'après-midi' ? 'après-midi' : period} (heure du PC).`,
    name
      ? `L’utilisateur s’appelle ${name} : utilise son prénom parfois, pas à chaque phrase.`
      : 'Tu ne connais pas encore le prénom de l’utilisateur ; tu peux le lui demander une fois, si l’occasion est naturelle.',
    context.source === 'voice'
      ? 'Cette demande a été dite à l’oral et ta réponse sera lue à voix haute : réponds comme on parle, en deux ou trois phrases, sans liste ni mise en forme.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  return [
    'CARACTÈRE DE JARVIS.',
    ...CORE_TRAITS,
    STYLE_LINES[persona.style],
    persona.humour ? HUMOUR_LINE : NO_HUMOUR_LINE,
    ...HONESTY,
    situation,
  ].join(' ');
}

/** `base` + la fiche, séparées par une ligne vide ; sans caractère actif, `base` tel quel. */
export function withPersonaPrompt(base: string, persona: PersonaConfig | null, context: PersonaContext): string {
  if (!persona) return base;
  return `${base.trim()}\n\n${personaPrompt(persona, context)}`;
}

/**
 * Accueil de l'interface (état vide, tableau de bord) : deux phrases dans la
 * voix du caractère, selon l'heure et le prénom. Sans modèle.
 */
export function personaGreeting(persona: PersonaConfig, context: PersonaContext): string {
  const period = dayPeriod(context.now, context.timeZone);
  const name = context.userName?.trim();
  const hello = period === 'soir' || period === 'nuit' ? 'Bonsoir' : 'Bonjour';
  const who = name ? `${hello} ${name}.` : `${hello}.`;
  if (persona.style === 'majordome') {
    const line =
      period === 'nuit'
        ? 'Il est tard ; je reste à votre disposition.'
        : period === 'matin'
          ? 'Que puis-je faire pour vous ce matin ?'
          : 'À votre service.';
    return `${who} ${line}`;
  }
  if (persona.style === 'direct') {
    return `${who} Je t’écoute.`;
  }
  const line =
    period === 'nuit'
      ? 'Tu ne dors pas ? Je suis là.'
      : period === 'matin'
        ? 'On attaque la journée ?'
        : period === 'soir'
          ? 'Dis-moi ce qu’il te faut.'
          : 'Je t’écoute.';
  return `${who} ${line}`;
}

/** Prénom tiré de la personnalisation (`prenom`, `prénom`, `name`, `nom`), sinon `null`. */
export function userFirstName(user: Record<string, string> | undefined | null): string | null {
  if (!user) return null;
  for (const key of ['prenom', 'prénom', 'firstName', 'name', 'nom']) {
    const value = user[key];
    if (typeof value === 'string' && value.trim()) return value.trim().split(/\s+/)[0] ?? null;
  }
  for (const [key, value] of Object.entries(user)) {
    if (/pr[ée]nom|name|nom/i.test(key) && typeof value === 'string' && value.trim()) {
      return value.trim().split(/\s+/)[0] ?? null;
    }
  }
  return null;
}

/**
 * Intention « qu'est-ce qui joue ? » : l'agent force `spotify_current_track`
 * comme il force `spotify_play` pour une lecture. Sans ça, qwen2.5:3b
 * répondait de mémoire à « Que joue Spotify en ce moment ? » et proposait une
 * commande `wmic`.
 *
 * Volontairement étroit : il faut une question sur ce qui passe **là**
 * (« cette musique », « qui passe », « en cours »…). « Qui chante Bohemian
 * Rhapsody ? » ou « quel est le meilleur morceau de Lomepal ? » restent au
 * modèle.
 *
 * Le texte est d'abord normalisé (minuscules, apostrophes, graphies Whisper
 * du type « qu'est-ce qu'il passe », « c quoi », « Spotifaï »), puis découpé
 * en propositions : une seule proposition suffit.
 */

const NOUN = String.raw`(?:musiques?|zik|zic|morceaux?|chansons?|sons?|titres?|track|piste|song)`;
const DEMONSTRATIVE = String.raw`(?:ce|cet|cette|ces)`;
const PLAYING_VERB = String.raw`(?:jou(?:e|es|ent)|pass(?:e|es|ent)|tourn(?:e|es|ent))`;
const NOW = String.raw`(?:en ce moment(?: m[êe]me)?|actuellement|maintenant|l[àa]|ici|en cours|en fond|sur spotify|dans (?:mes|les|le|mon|ma) (?:oreilles|enceintes|[ée]couteurs|haut-parleurs|casque)|comme (?:musique|son|chanson|morceau|titre))`;
/** Fin de proposition : rien, ou seulement des marqueurs « maintenant / là / sur Spotify ». */
const TAIL = String.raw`(?: ${NOW})*$`;
const TAIL_WITH_NOW = String.raw`(?: ${NOW})+$`;
const START = String.raw`(?:^| )`;

const IDENTITY_QUESTION = String.raw`(?:c'est quoi|qu'est-ce que c'est(?: que)?|quel(?:le)? est|quel(?:le)?s sont|comment s'appelle|comment (?:ça|ca) s'appelle|(?:ça|ca) s'appelle comment|c'est qui|qui chante|c'est de qui|de qui est|c'est quel|le nom de|le titre de)`;
const TRAILING_QUESTION = String.raw`(?:c'est quoi|c'est qui|c'est de qui|c'est quel(?:le)? \S+|(?:elle|il|ça|ca) s'appelle comment|s'appelle comment)`;

const CURRENT_TRACK_PATTERNS: RegExp[] = [
  // « Que joue Spotify (en ce moment) ? », « Spotify joue quoi ? »
  new RegExp(`${START}(?:que|qu'est-ce que) (?:${PLAYING_VERB}|lit) spotify(?: |$)`, 'u'),
  new RegExp(`${START}qu'est-ce que spotify (?:${PLAYING_VERB}|lit)(?: |$)`, 'u'),
  new RegExp(`${START}spotify (?:${PLAYING_VERB}|lit) quoi(?: |$)`, 'u'),
  new RegExp(
    `${START}(?:(?:tu|ça|ca) ${PLAYING_VERB} quoi|qu'est-ce que tu ${PLAYING_VERB})${TAIL}`,
    'u',
  ),
  // « Qu'est-ce qui passe (là) ? », « dis-moi ce qui tourne sur Spotify »
  new RegExp(
    `${START}(?:qu'est-ce qui|c'est quoi qui|(?:dire|dis-moi|dis moi|sais|savoir|voir|regarde|v[ée]rifie) ce qui) ${PLAYING_VERB}${TAIL}`,
    'u',
  ),
  // « Qu'est-ce que j'écoute ? » ; « on écoute quoi là ? » (sans « là », c'est une demande d'idée)
  new RegExp(
    `${START}(?:qu'est-ce que j'[ée]coute|j'[ée]coute quoi|je suis en train d'[ée]couter quoi)${TAIL}`,
    'u',
  ),
  new RegExp(`${START}(?:qu'est-ce qu'on [ée]coute|on [ée]coute quoi)${TAIL_WITH_NOW}`, 'u'),
  // « Quelle musique tourne ? », « quel son passe là ? »
  new RegExp(
    `${START}quel(?:le)?s? ${NOUN} (?:${PLAYING_VERB}|est en (?:train de (?:jouer|passer|tourner)|lecture|cours)|on [ée]coute|j'[ée]coute)${TAIL}`,
    'u',
  ),
  // « C'est quoi cette musique ? », « quel est ce morceau / ce son ? », « le nom de cette chanson »
  new RegExp(
    `${START}${IDENTITY_QUESTION} (?:.* )?${DEMONSTRATIVE} ${NOUN}(?: ${NOW})*(?: qui (?:${PLAYING_VERB}|chante)| qu'on (?:entend|[ée]coute)| que j'(?:entends|[ée]coute))?${TAIL}`,
    'u',
  ),
  // « Cette musique, c'est quoi ? », « le son qui passe, c'est qui ? »
  new RegExp(
    `${START}${DEMONSTRATIVE} ${NOUN}(?: ${NOW})*(?: qui ${PLAYING_VERB}(?: ${NOW})*)? ${TRAILING_QUESTION}$`,
    'u',
  ),
  new RegExp(
    `${START}(?:le|la|l') ?${NOUN}(?: qui ${PLAYING_VERB}(?: ${NOW})*|(?: ${NOW})+) ${TRAILING_QUESTION}$`,
    'u',
  ),
  // « C'est quoi le son là ? », « quel est le nom du morceau en ce moment ? »
  new RegExp(
    `${START}${IDENTITY_QUESTION} (?:le|la|l') ?(?:(?:nom|titre) (?:du|de la|de l') ?)?${NOUN}${TAIL_WITH_NOW}`,
    'u',
  ),
  // « C'est qui qui chante ? », « qui chante ça ? » — pas « qui chante Bohemian Rhapsody ? »
  new RegExp(
    `(?:^|${START}(?:c'est|qui c'est|qui est-ce|savoir|sais|dire|dis-moi|dis moi|demande) )qui (?:qui )?chant(?:e|ent)(?: (?:ça|ca))?${TAIL}`,
    'u',
  ),
  new RegExp(
    `${START}(?:c'est qui|qui est|quel(?:le)? est|c'est quel(?:le)?|c'est quoi) (?:l'|le |la |ce |cet |cette )?(?:artiste|chanteur|chanteuse|groupe|rappeur|rappeuse)${TAIL}`,
    'u',
  ),
  new RegExp(`${START}c'est de qui(?: (?:ça|ca))?${TAIL}`, 'u'),
];

/**
 * Sans mot interrogatif (« le morceau en cours ? », « la musique qui passe
 * là »). Une proposition qui commence par une commande (« mets le morceau en
 * cours en boucle ») n'est pas une question.
 */
const IMPLICIT_CURRENT_TRACK_PATTERNS: RegExp[] = [
  new RegExp(
    `${START}(?:(?:morceau|titre|piste|chanson|track) (?:actuel(?:le)?|en cours)|(?:musique|son|lecture) en cours)(?: |$)`,
    'u',
  ),
  new RegExp(`${START}(?:le|la|l'|ce|cet|cette) ?${NOUN} qui ${PLAYING_VERB}${TAIL}`, 'u'),
];

const COMMAND_START =
  /^(?:joue[rz]?|[ée]coute[rz]?|lance[rz]?|mets|mettre|remets|passe|ajoute|enregistre|like|r[ée]p[èe]te|coupe|arr[êe]te|baisse|monte|supprime|retire|enl[èe]ve|partage|envoie)(?: |$)/u;

/** La musique vient d'ailleurs : Spotify n'a pas la réponse. */
const OTHER_MEDIA =
  /(?<![\p{L}])(?:t[ée]l[ée]|tv|radio|cin[ée]ma|cin[ée]|netflix|youtube|twitch|tiktok|instagram|films?|s[ée]ries?|vid[ée]os?|pubs?|publicit[ée]s?|concert|festival|th[ée][aâ]tre|replay|cha[iî]ne|deezer|soundcloud|apple music|jeu vid[ée]o)(?![\p{L}])/u;

const FILLERS =
  /(?:^| )(?:jarvis|s'il te pla[iî]t|s'il vous pla[iî]t|stp|svp|merci|please|euh|hein|dis donc)(?= |$)/gu;

/** Graphies Whisper / frappe rapide ramenées à une forme unique avant les motifs. */
const SPEECH_ALIASES: Array<[RegExp, string]> = [
  [/(?<![\p{L}])spot+[iy] ?-?f(?:y|ye|ie|i|ai|aï|aille|aye)(?![\p{L}])/gu, 'spotify'],
  [/(?<![\p{L}])koi(?![\p{L}])/gu, 'quoi'],
  [/(?<![\p{L}])kel(le)?(s)?(?![\p{L}])/gu, 'quel$1$2'],
  [/(?<![\p{L}])(?:qu' ?est|qu ?est|qu'es|que est|kes|kess)[ -]?ce(?![\p{L}])/gu, "qu'est-ce"],
  [/(?<![\p{L}])qu'est-ce qu'?ils? (pass|jou|tourn)/gu, "qu'est-ce qui $1"],
  [/(?<![\p{L}])qui (c'est|est-ce) qu'?ils? chant/gu, 'qui $1 qui chant'],
  [/(?<![\p{L}])c'est qui qu'?ils? chant/gu, "c'est qui qui chant"],
  [/(?<![\p{L}])(?:c|cé|sé) (quoi|qui)(?![\p{L}])/gu, "c'est $1"],
  [/(?<![\p{L}])c'te(?![\p{L}])/gu, 'cette'],
  [/(?<![\p{L}])(?:cet|set) (musique|chanson|zik|zic|piste)(?![\p{L}])/gu, 'cette $1'],
  [/(?<![\p{L}])se (morceau|son|titre|track|song)(?![\p{L}])/gu, 'ce $1'],
  [
    /(?<![\p{L}])(c'est quoi|quel est|c'est de qui|comment s'appelle|de qui est) ce sont(?![\p{L}])/gu,
    '$1 ce son',
  ],
];

function normalize(prompt: string): string {
  let text = prompt
    .toLowerCase()
    .normalize('NFC')
    .replace(/[’‘`´]/gu, "'")
    .replace(/\s+/gu, ' ');
  for (const [pattern, replacement] of SPEECH_ALIASES) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function clean(clause: string): string {
  return clause
    .replace(/[^\p{L}\p{N}'\- ]/gu, ' ')
    .replace(FILLERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Phrases entières (« cette musique, c'est quoi ») et leurs morceaux entre
 * virgules (« c'est quoi cette musique, elle est trop bien »).
 */
function clauses(normalized: string): string[] {
  const sentences = normalized.split(/[?!.;:…]+| [-–—] /u);
  const parts = sentences.flatMap((sentence) => [sentence, ...sentence.split(',')]);
  return [...new Set(parts.map(clean).filter(Boolean))];
}

/**
 * Le dernier message demande-t-il ce qui joue en ce moment ? Vrai pour
 * « Que joue Spotify ? », « qu'est-ce qui passe ? », « c'est quoi cette
 * musique ? », « c'est qui qui chante ? »… Faux pour « joue du Nekfeu » ou
 * une question générale sur la musique.
 */
export function isCurrentTrackQuestion(prompt: string): boolean {
  const normalized = normalize(prompt.trim());
  if (!normalized) return false;
  if (OTHER_MEDIA.test(normalized)) return false;

  return clauses(normalized).some((clause) => {
    if (CURRENT_TRACK_PATTERNS.some((pattern) => pattern.test(clause))) return true;
    if (COMMAND_START.test(clause)) return false;
    return IMPLICIT_CURRENT_TRACK_PATTERNS.some((pattern) => pattern.test(clause));
  });
}

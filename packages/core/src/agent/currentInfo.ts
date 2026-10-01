import { extractKnowledgeIntent } from '../knowledge/intent.js';
import { looksLikeGoogleIntent } from '../google/intent.js';
import { isCurrentTrackQuestion } from '../media/currentTrackIntent.js';
import { isMusicIntent } from '../media/playIntent.js';
import { extractPersonalizationIntent } from '../personalization/intent.js';
import { extractSiteBlockIntent } from '../siteblock/intent.js';
import { extractYoutubeUrl } from '../youtube/url.js';
import type { SearchFreshness } from '../search/types.js';

export type CurrentInfoKind =
  | 'explicit'
  | 'news'
  | 'weather'
  | 'price'
  | 'sport'
  | 'version'
  | 'office'
  | 'figure'
  | 'generic';

export interface CurrentInfoPlan {
  kind: CurrentInfoKind;
  /** Requête web (année ajoutée quand elle aide la fraîcheur). */
  query: string;
  /** Requête actualité : mots porteurs seulement ; « * » = la une. */
  newsQuery: string;
  freshness: SearchFreshness;
  /** Les flux d'actualité passent avant le web (actualité, sport, personnalités). */
  preferNews: boolean;
  /** Question complexe ou contestée : `web_research` (2 à 4 requêtes) en plus. */
  complex: boolean;
  researchQueries: string[];
  /** Ville pour la météo, si elle est nommée. */
  city?: string;
}

export const NEWS_HEADLINES_QUERY = '*';

/** `\b` de JavaScript ne connaît que l'ASCII : « actualité » finirait sans frontière. */
const WORD_BOUNDARY = String.raw`(?:(?<=[\p{L}\p{N}])(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?=[\p{L}\p{N}]))`;

function rx(source: string, flags = 'iu'): RegExp {
  return new RegExp(source.replace(/\\b/g, WORD_BOUNDARY), flags);
}

function normalize(prompt: string): string {
  return prompt
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:ok(?:ay)?|dis|hey|bon|alors|euh)[,\s]+/iu, '')
    .replace(/^jarvis[,:!.\s]*/iu, '')
    .trim();
}

/** « quelle heure est-il », « on est quel jour » : l'horloge du PC, pas Internet. */
const LOCAL_CLOCK = rx(
  String.raw`^(?:(?:dis[- ]moi|tu peux me dire|peux[- ]tu me dire|tu sais|sais[- ]tu)\s+)?(?:quelle heure (?:est-il|il est|est il)|il est quelle heure|l'heure(?: qu'il est| actuelle)?\s*[?.!]*$|quel jour (?:sommes-nous|on est|est-on|nous sommes|est-ce|c'est)|on est quel jour|quelle (?:est la )?date (?:d'aujourd'hui|aujourd'hui|du jour|sommes-nous|on est|est-on)|on est le combien|c'est quoi la date)`,
);

const CHITCHAT = rx(
  String.raw`^(?:salut|bonjour|bonsoir|coucou|hello|merci|bonne nuit|bonne journée|comment (?:ça|ca) va|(?:ça|ca) va|comment vas-tu|comment allez-vous|quoi de neuf\s*[?!.]*$)`,
);

/** Ordres adressés au PC ou à Jarvis : jamais déroutés vers Internet. */
const HARD_ACTION = rx(
  String.raw`^(?:(?:peux[- ]tu|pourrais[- ]tu|tu peux|est-ce que tu peux|je veux que tu|merci de|il faut)\s+)?(?:ouvre|ouvrir|lance|lancer|ferme|fermer|quitte|quitter|cr[ée]e|cr[ée]er|supprime|supprimer|efface|effacer|d[ée]place|d[ée]placer|copie|copier|renomme|renommer|installe|installer|d[ée]sinstalle|[ée]teins|[ée]teindre|red[ée]marre|red[ée]marrer|verrouille|bloque|bloquer|d[ée]bloque|active|activer|d[ée]sactive|mets|mettre|met|monte|baisse|augmente|diminue|coupe|joue|jouer|[ée]cris|[ée]crire|r[ée]dige|r[ée]diger|envoie|envoyer|programme|rappelle[- ]moi|souviens[- ]toi|retiens|note|enregistre|indexe|capture|prends|traduis|traduire|calcule|calculer|convertis|r[ée]p[èe]te|arr[êe]te|stop|pause|reprends|passe|vide|range|trie|nettoie|scanne)\b`,
);

/** Verbes neutres : déroutés seulement si la suite parle d'actualité, de météo ou de sport. */
const SOFT_ACTION = rx(
  String.raw`^(?:(?:peux[- ]tu|pourrais[- ]tu|tu peux)\s+)?(?:lis|lire|fais|faire|donne|r[ée]sume|r[ée]sumer|raconte|explique|analyse)\b`,
);

/** Possessif à la première personne : contexte personnel (mémoire, fichiers, agenda). */
const FIRST_PERSON_POSSESSIVE = rx(String.raw`\b(?:mon|ma|mes)\b`);

const OUR_OBJECT = rx(
  String.raw`\b(?:notre|nos)\s+(?:pc|ordi(?:nateur)?|machine|fichiers?|dossiers?|documents?|projets?|famille|maison|appartement|agenda|calendrier|r[ée]seau|wifi|wi-fi|compte|abonnements?)\b`,
);

const SELF_OR_ASSISTANT = rx(
  String.raw`\b(?:ton|ta|tes)\s+\p{L}+|\bqui es[- ]tu\b|\bcomment tu t'appelles\b|\btu (?:es|fais|peux|sais faire) quoi\b`,
);

/** Questions sur l'état de la machine, même sans possessif. */
const LOCAL_SYSTEM = rx(
  String.raw`\b(?:processus|m[ée]moire vive|ram|espace (?:disque|libre)|utilisation (?:du|de la) (?:cpu|processeur|disque|gpu|m[ée]moire)|charge (?:du|de la) (?:cpu|machine|pc|processeur)|consomm\p{L}*(?: le plus| de la ram| du cpu| de m[ée]moire)|fen[êe]tres? (?:active|ouverte|au premier plan)|onglets? ouverts?|fichiers? (?:r[ée]cents|ouverts)|journal (?:d'[ée]v[ée]nements|syst[èe]me)|erreurs? (?:syst[èe]me|windows|du pc)|presse-papiers?|ce pc|cet ordinateur|sur le pc|de l'ordinateur|mode (?:travail|concentration|focus)|sites? bloqu[ée]s?)\b`,
);

/** Cours de bourse : l'outil `get_stock_quote` existe, le modèle garde la main. */
const STOCK_MARKET = rx(
  String.raw`\b(?:cours de (?:l'|la |les )?actions?|actions? (?:de |d'|du |des )|cours (?:boursier|en bourse)|en bourse|la bourse|cac ?40|nasdaq|dow jones|s&p ?500|euronext|ticker|symbole boursier)`,
);

const MATH = rx(String.raw`\bcombien (?:font|fait|donne)\s+[\d(]|\d+\s*[-+*/x×÷]\s*\d+|racine carr[ée]e|pourcentage de \d`);

const EXPLICIT_WEB = rx(
  String.raw`\b(?:sur internet|sur le web|sur le net|en ligne|sur google|sur la toile|recherche (?:web|internet|en ligne)|fais une recherche|cherche[- ]moi|google[- ]moi|regarde sur)\b`,
);
const EXPLICIT_WEB_VERB = rx(
  String.raw`^(?:(?:peux[- ]tu|tu peux|pourrais[- ]tu)\s+)?(?:cherche|recherche|regarde|v[ée]rifie|trouve)\b`,
);
const WEB_WORD = rx(String.raw`\b(?:internet|web|google|en ligne)\b`);

const NEWS = rx(
  String.raw`\b(?:actualit[ée]s?|actus?|news|infos? (?:du jour|d'aujourd'hui|du moment)|nouvelles du jour|les nouvelles|derni[èe]res? nouvelles|[àa] la une|gros titres|titres du jour|quoi de neuf (?:dans|en|sur|aujourd'hui)|que se passe-t-il|qu'est-ce qui se passe|il se passe quoi|flash info|breaking)\b`,
);

const WEATHER = rx(
  String.raw`\b(?:m[ée]t[ée]o|quel temps|temps qu'il fait|temps fait-il|va-t-il (?:pleuvoir|neiger)|il va (?:pleuvoir|neiger)|est-ce qu'il (?:pleut|neige|va pleuvoir)|pr[ée]visions? (?:m[ée]t[ée]o|du temps)|temp[ée]rature (?:[àa]|ext[ée]rieure|dehors|de demain|aujourd'hui)|il fait combien)\b`,
);

const PRICE = rx(
  String.raw`\b(?:prix|tarifs?|co[ûu]te(?:nt)?|vaut|valent|cours du|cours de l'(?:or|euro|argent|essence|p[ée]trole)|cotation|taux de change|combien (?:co[ûu]te|vaut|valent|est le|faut-il payer)|combien d'euros|combien de dollars|bitcoin|ethereum|crypto)\b`,
);

const SPORT = rx(
  String.raw`\b(?:score|r[ée]sultats? (?:du|des|de la) (?:match|matchs|course|finale|grand prix|gp)|r[ée]sultat du match|match d'hier|dernier match|prochain match|classement (?:de la|du|des) (?:ligue|championnat|premier league|liga|serie a|bundesliga|top 14|nba|f1|formule 1|pilotes|constructeurs)|classement actuel|qui a gagn[ée]|qui a remport[ée]|vainqueur|gagnant|champion(?:ne)? (?:du monde|de france|d'europe|en titre)|ligue 1|ligue 2|ligue des champions|champions league|ligue europa|premier league|liga|serie a|bundesliga|coupe du monde|coupe de france|euro 20\d\d|jeux olympiques|jo|grand prix|formule 1|f1|motogp|tour de france|roland[- ]garros|wimbledon|us open|open d'australie|nba|nfl|top 14|six nations|6 nations|mercato)\b`,
);

const VERSION = rx(
  String.raw`\b(?:derni[èe]re version|derni[èe]re mise [àa] jour|nouvelle version|version actuelle|version stable|mise [àa] jour|maj|release|date de sortie|quand sort|sort quand|vient de sortir|est sorti|nouveau mod[èe]le|dernier mod[èe]le|dernier iphone|nouvel iphone|prochain(?:e)? (?:film|album|saison|[ée]pisode|jeu|iphone|sortie|mise [àa] jour|version))\b`,
);

const OFFICE = rx(
  String.raw`\bqui (?:est|sont|[ée]tait|est actuellement|dirige|gouverne|pr[ée]side|entra[îi]ne|a [ée]t[ée] (?:[ée]lu|nomm[ée]|d[ée]sign[ée]))\b[^?]{0,40}?\b(?:pr[ée]sident(?:e)?|premi[èe]re? ministre|ministre|pdg|ceo|directeur g[ée]n[ée]ral|directrice g[ée]n[ée]rale|patron(?:ne)?|dirigeant(?:e)?|maire|gouverneur|chancelier|chanceli[èe]re|roi|reine|pape|entra[îi]neur|s[ée]lectionneur|coach|capitaine|secr[ée]taire g[ée]n[ée]ral|porte-parole|chef (?:de l'[ée]tat|du gouvernement|d'[ée]tat)|champion(?:ne)?|tenant du titre|meilleur buteur|ballon d'or|num[ée]ro un|leader|fondateur)\b|\bqui (?:dirige|gouverne|pr[ée]side)\b|\bqui est (?:le|la|l') [^?]{1,50} actuel(?:le)?\b|\b(?:est|il est|elle est) toujours (?:en vie|vivant|vivante|pr[ée]sident|ministre|en poste|au pouvoir)\b`,
);

const FIGURE = rx(
  String.raw`\b(?:taux (?:du livret a|du pel|de ch[ôo]mage|d'inflation|d'int[ée]r[êe]t|directeur|d'usure|de change|immobilier|de la bce|de la fed)|livret a|inflation|smic|ch[ôo]mage|pib|population (?:de|du|des|mondiale|actuelle)|nombre d'habitants|combien d'habitants|dette (?:publique|de la france)|d[ée]ficit public|prix de l'immobilier)\b`,
);

const TIME_MARKER = rx(
  String.raw`\b(?:aujourd'hui|ce soir|ce matin|cet apr[èe]s-midi|cette semaine|ce week-?end|hier|avant-hier|demain|en ce moment|actuellement|actuel(?:le)?s?|maintenant|r[ée]cemment|derni[èe]rement|ces derniers jours|cette ann[ée]e|cette saison|cette nuit|en direct|en temps r[ée]el|[àa] jour|le plus r[ée]cent|la plus r[ée]cente|les plus r[ée]cents|du moment|[àa] l'heure actuelle|de nos jours|en cours)\b`,
);

const SAME_DAY = rx(
  String.raw`\b(?:aujourd'hui|ce soir|ce matin|cet apr[èe]s-midi|cette nuit|hier|en direct|en ce moment|maintenant)\b`,
);

const FIRST_OR_SECOND_PERSON = rx(String.raw`\b(?:je|moi|me|tu|te|toi|vous)\b|\b[jmt]'`);
const QUESTION_FORM = rx(
  String.raw`\?\s*$|^(?:qui|que|quoi|quel(?:le)?s?|combien|quand|o[ùu]|est-ce que|est-ce qu'|c'est quoi|qu'est-ce|comment|pourquoi|y a-t-il|il y a)\b`,
);

const COMPLEX = rx(
  String.raw`\b(?:compare[rz]?|comparaison|diff[ée]rence entre|vs\.?|versus|lequel|laquelle|lesquels|pourquoi|est-ce vrai|c'est vrai que|vrai ou faux|rumeur|fake news|intox|pol[ée]mique|controvers[ée]e?|contest[ée]e?|selon les sources|plusieurs sources|fiable|fiabilit[ée]|quelles cons[ée]quences|impact|explique(?:-moi)? pourquoi|analyse)\b`,
);

const MEMORY_WORD = rx(String.raw`\bm[ée]moire\b`);
const SPOTIFY_WORD = rx(String.raw`\bspotify\b`);

/**
 * Règle d'intention ajoutée à côté des intentions forcées (YouTube, Spotify) :
 * une question sur un fait actuel ou changeant part sur Internet avant que le
 * modèle réponde. Les demandes personnelles, sur le PC, Spotify, la mémoire,
 * SiteBlock, Google (Gmail, Agenda, Drive…), l'horloge et la bourse ne sont
 * jamais déroutées : elles gardent exactement leur chemin d'avant.
 */
export function detectCurrentInfoIntent(prompt: string, now: Date = new Date()): CurrentInfoPlan | null {
  const text = normalize(prompt);
  if (!text) return null;

  if (extractYoutubeUrl(text)) return null;
  if (isMusicIntent(text) || isCurrentTrackQuestion(text) || SPOTIFY_WORD.test(text)) return null;
  if (extractKnowledgeIntent(text) || MEMORY_WORD.test(text)) return null;
  if (extractPersonalizationIntent(text)) return null;
  if (extractSiteBlockIntent(text)) return null;
  // Gmail, Agenda, Drive, Docs, Sheets : les outils google_* répondent, pas le web.
  if (looksLikeGoogleIntent(text)) return null;
  if (LOCAL_CLOCK.test(text) || CHITCHAT.test(text)) return null;
  if (FIRST_PERSON_POSSESSIVE.test(text) || OUR_OBJECT.test(text) || SELF_OR_ASSISTANT.test(text)) return null;
  if (LOCAL_SYSTEM.test(text) || STOCK_MARKET.test(text) || MATH.test(text)) return null;

  const explicitWeb = EXPLICIT_WEB.test(text) || (EXPLICIT_WEB_VERB.test(text) && WEB_WORD.test(text));
  if (!explicitWeb && HARD_ACTION.test(text)) return null;
  if (!explicitWeb && SOFT_ACTION.test(text) && !(NEWS.test(text) || WEATHER.test(text) || SPORT.test(text))) {
    return null;
  }

  const kind = classify(text, explicitWeb, now);
  if (!kind) return null;

  const complex = COMPLEX.test(text) || wordCount(text) > 22;
  const city = kind === 'weather' ? extractCity(text) : undefined;
  const query = kind === 'weather' && !city ? 'météo aujourd’hui France' : webQuery(text, kind, now);
  const newsQuery = kind === 'weather' ? (city ? `météo ${city}` : 'météo') : newsKeywords(text, kind);

  return {
    kind,
    query,
    newsQuery,
    freshness: freshnessFor(kind, text),
    preferNews: kind === 'news' || kind === 'sport' || kind === 'office' || kind === 'generic' || kind === 'explicit',
    complex,
    researchQueries: complex ? researchQueries(query, newsQuery, now) : [],
    ...(city ? { city } : {}),
  };
}

export function isCurrentInfoQuestion(prompt: string, now: Date = new Date()): boolean {
  return detectCurrentInfoIntent(prompt, now) !== null;
}

function classify(text: string, explicitWeb: boolean, now: Date): CurrentInfoKind | null {
  if (isHistorical(text, now)) return explicitWeb ? 'explicit' : null;
  if (WEATHER.test(text)) return 'weather';
  if (NEWS.test(text)) return 'news';
  if (SPORT.test(text)) return 'sport';
  if (OFFICE.test(text)) return 'office';
  if (FIGURE.test(text)) return 'figure';
  if (VERSION.test(text)) return 'version';
  if (PRICE.test(text) && QUESTION_FORM.test(text)) return 'price';
  if (explicitWeb) return 'explicit';
  const impersonalQuestion = QUESTION_FORM.test(text) && !FIRST_OR_SECOND_PERSON.test(text);
  if (impersonalQuestion && (TIME_MARKER.test(text) || mentionsRecentYear(text, now))) return 'generic';
  return null;
}

/** Une année passée nommée, sans marqueur de temps présent : question d'histoire. */
function isHistorical(text: string, now: Date): boolean {
  const years = [...text.matchAll(/(?<!\d)(1[89]\d\d|20\d\d)(?!\d)/g)].map((match) => Number(match[1]));
  if (years.length === 0) return false;
  const current = now.getFullYear();
  return years.every((year) => year <= current - 2) && !TIME_MARKER.test(text);
}

function mentionsRecentYear(text: string, now: Date): boolean {
  const current = now.getFullYear();
  return [...text.matchAll(/(?<!\d)(20\d\d)(?!\d)/g)].some((match) => Number(match[1]) >= current - 1);
}

function freshnessFor(kind: CurrentInfoKind, text: string): SearchFreshness {
  const slow = kind === 'version' || kind === 'figure' || kind === 'office';
  if (slow) return 'month';
  return SAME_DAY.test(text) ? 'day' : 'week';
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const POLITE_PREFIX = rx(
  String.raw`^(?:(?:est-ce que )?(?:tu peux|peux[- ]tu|pourrais[- ]tu|tu pourrais|tu sais|sais[- ]tu|tu connais|connais[- ]tu)\s+(?:me\s+)?(?:dire|donner|trouver|chercher|rechercher|regarder|v[ée]rifier)?\s*|dis[- ]moi\s+|je (?:voudrais|veux|aimerais) (?:savoir|conna[îi]tre)\s+|j'aimerais (?:savoir|conna[îi]tre)\s+|donne[- ]moi\s+|(?:fais une |faire une )?recherche (?:sur internet |sur le web |en ligne )?(?:sur |pour )?|cherche(?:-moi)? (?:sur internet |sur le web |en ligne |sur google )?|regarde (?:sur internet |sur le web |en ligne |sur google )?)`,
);
const WEB_PLACE = rx(String.raw`\b(?:sur internet|sur le web|sur le net|en ligne|sur google|sur la toile)\b`, 'giu');

/** Requête web : la question nettoyée ; l'année en cours aide à écarter les pages anciennes. */
function webQuery(text: string, kind: CurrentInfoKind, now: Date): string {
  let query = text
    .replace(POLITE_PREFIX, '')
    .replace(WEB_PLACE, '')
    .replace(/[?!.]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!query) query = text.replace(/[?!.]+$/u, '').trim();
  const slowKind = kind === 'version' || kind === 'office' || kind === 'figure' || kind === 'price';
  if (slowKind && !/(?<!\d)20\d\d(?!\d)/.test(query)) query = `${query} ${now.getFullYear()}`;
  return query.slice(0, 220);
}

const NEWS_STOPWORDS = new Set(
  (
    "le la les l un une des du de d au aux a à et ou en dans sur pour par avec sans ce cet cette ces " +
    'qui que quoi qu quel quelle quels quelles quand comment combien pourquoi où est sont été être était ' +
    'il elle ils elles on je tu nous vous me te se y ne pas plus c ça ca s sait fait dis dit moi toi ' +
    'jarvis stp svp merci peux peut pourrais sais connais savoir dire donner trouver chercher cherche recherche ' +
    "actuel actuelle actuels actuelles actuellement moment maintenant aujourd'hui hui ce soir matin " +
    'dernier dernière derniers dernières principales principaux grandes grands ' +
    'vaut valent coûte coute coûtent coutent fait-il fait-on temps ' +
    "internet web google ligne net toile y-a-t-il a-t-il est-ce qu'est-ce c'est"
  ).split(/\s+/),
);

const GENERIC_NEWS_WORDS = rx(
  String.raw`^(?:actualit[ée]s?|actus?|news|infos?|nouvelles|titres|une|jour|france|monde|semaine|neuf|passe|passe-t-il|se|flash|breaking|gros)$`,
);

/** Mots porteurs pour les flux d'actualité ; « * » quand il ne reste que des mots génériques. */
function newsKeywords(text: string, kind: CurrentInfoKind): string {
  const words = text
    .replace(POLITE_PREFIX, '')
    .replace(/[?!.,;:«»"()]/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^(?:l|d|qu|c|j|n|s)'/iu, ''))
    .filter((word) => word && (/^\p{Lu}$/u.test(word) || !NEWS_STOPWORDS.has(word.toLowerCase())));
  if (kind === 'news' && words.every((word) => GENERIC_NEWS_WORDS.test(word))) {
    return NEWS_HEADLINES_QUERY;
  }
  return words.join(' ').trim() || NEWS_HEADLINES_QUERY;
}

function researchQueries(query: string, newsQuery: string, now: Date): string[] {
  const base = newsQuery === NEWS_HEADLINES_QUERY ? query : newsQuery;
  const month = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(now);
  const queries = [query, `${base} source officielle`, `${base} ${month}`, `${base} vérification des faits`];
  return [...new Set(queries.map((item) => item.trim()).filter(Boolean))].slice(0, 4);
}

const CITY_STOP = rx(String.raw`^(?:aujourd'hui|demain|ce|cette|en|la|le|les|maintenant|dehors|chez|ici|noël|paques|pâques)$`);
const CITY_NAME = String.raw`(?:(?:Saint|Sainte|St|Ste|Le|La|Les|L')[- ]?)?\p{Lu}[\p{L}'-]*\p{L}(?:[- ](?:sur|en|de|du|des|la|le|les|lès|aux)[- ]\p{Lu}[\p{L}'-]*\p{L}|[- ]\p{Lu}[\p{L}'-]*\p{L})*`;
const CITY_AFTER_PREPOSITION = new RegExp(String.raw`(?:^|[\s,])(?:à|a|sur|pour|de|dans|vers)\s+(${CITY_NAME})`, 'u');
const CITY_AFTER_WEATHER = new RegExp(String.raw`[Mm][ée]t[ée]o\s+(${CITY_NAME})`, 'u');

/** « météo à Lyon », « quel temps fait-il sur Marseille demain » → « Lyon », « Marseille ». */
export function extractCity(text: string): string | undefined {
  const match = text.match(CITY_AFTER_PREPOSITION) ?? text.match(CITY_AFTER_WEATHER);
  const city = match?.[1]?.trim();
  if (!city || CITY_STOP.test(city)) return undefined;
  return city;
}

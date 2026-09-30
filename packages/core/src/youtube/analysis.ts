import { detectVideoDomain, type VideoDomain } from './domain.js';

export type ImportanceBand = 'faible' | 'moyen' | 'important' | 'critique';
export type ClaimKind = 'FACT' | 'OPINION' | 'PREDICTION' | 'UNCERTAINTY';

export interface ScoredSegment {
  index: number;
  text: string;
  timestamp?: string;
  score: number;
  band: ImportanceBand;
  signals: string[];
}

export interface Claim {
  kind: ClaimKind;
  text: string;
}

export interface VideoMemoryRecord {
  summary: string;
  themes: string[];
  concepts: string[];
  figures: string[];
  companies: string[];
  risks: string[];
  conclusions: string[];
  timestamps: string[];
}

export interface VisionHook {
  available: false;
  timestamp?: string;
  detectedGraphic: boolean;
  message: string;
}

const TRANSITION =
  /\b(bonjour|bienvenue|passons|ensuite|pour commencer|introduction|on va voir|abonnez|likez)\b/i;
const CONCLUSION = /\b(en conclusion|au final|donc|pour résumer|à retenir|il en résulte)\b/i;
const DECISION = /\b(décision|décide|nous allons|il faut|choisit)\b/i;
const RISK = /\b(risque|danger|incertitude|menace|dilution)\b/i;
const CHANGE = /\b(hausse|baisse|changement|augmente|diminue|croissance)\b/i;
const CONCEPT = /\b(concept|définition|signifie|c'est-à-dire|notion)\b/i;
const CLAIM = /\b(l'essentiel|la thèse|le point central|affirme)\b/i;
const EXAMPLE = /\b(par exemple|exemple|illustration)\b/i;
const OPINION = /\b(je pense|selon moi|à mon avis|l'analyste considère|opinion|trouve que)\b/i;
const PREDICTION = /\b(prévoit|prévision|devrait|pourrait|anticipation|guidance)\b/i;
const UNCERTAIN = /\b(peut-être|incertain|dépend|on ne sait pas|si)\b/i;
const NUMBER = /\d[\d\s.,]*\s*(%|€|\$|milliards?|millions?|mds|eps|bpa)?/i;

export function importanceBand(score: number): ImportanceBand {
  if (score <= 30) return 'faible';
  if (score <= 60) return 'moyen';
  if (score <= 80) return 'important';
  return 'critique';
}

export function splitAnalysisSegments(transcript: string): { text: string; timestamp?: string }[] {
  const lines = transcript
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const source = lines.length > 1 ? lines : chunkPlain(transcript);
  return source.map((line) => {
    const stamp = line.match(/^\[([^\]]+)\]/)?.[1];
    const text = line.replace(/^\[[^\]]+\]\s*/, '').trim();
    return stamp ? { text, timestamp: stamp } : { text };
  }).filter((segment) => segment.text.length > 0);
}

export function scoreSegment(text: string, index: number, previous?: string): ScoredSegment {
  const signals: string[] = [];
  let score = 20;
  const stamp = text.match(/^\[([^\]]+)\]/)?.[1];
  const body = text.replace(/^\[[^\]]+\]\s*/, '');

  if (NUMBER.test(body)) {
    score += 18;
    signals.push('chiffre');
  }
  if (CONCLUSION.test(body)) {
    score += 16;
    signals.push('conclusion');
  }
  if (DECISION.test(body)) {
    score += 14;
    signals.push('décision');
  }
  if (RISK.test(body)) {
    score += 14;
    signals.push('risque');
  }
  if (CHANGE.test(body)) {
    score += 10;
    signals.push('changement');
  }
  if (CONCEPT.test(body)) {
    score += 10;
    signals.push('concept');
  }
  if (CLAIM.test(body)) {
    score += 12;
    signals.push('affirmation');
  }
  if (EXAMPLE.test(body)) {
    score += 8;
    signals.push('exemple');
  }
  if (previous && similarity(body, previous) > 0.72) {
    score -= 22;
    signals.push('répétition');
  } else if (body.length > 40) {
    score += 8;
    signals.push('information');
  }
  if (TRANSITION.test(body) && !NUMBER.test(body)) {
    score -= 16;
    signals.push('transition');
  }

  const clamped = Math.max(0, Math.min(100, score));
  return {
    index,
    text: body,
    ...(stamp ? { timestamp: stamp } : {}),
    score: clamped,
    band: importanceBand(clamped),
    signals,
  };
}

export function scoreTranscript(transcript: string): ScoredSegment[] {
  const parts = splitAnalysisSegments(transcript);
  const scored: ScoredSegment[] = [];
  for (const [index, part] of parts.entries()) {
    const previous = scored[scored.length - 1]?.text;
    const item = scoreSegment(part.text, index, previous);
    if (part.timestamp) item.timestamp = part.timestamp;
    scored.push(item);
  }
  return scored;
}

export function classifyClaim(text: string): Claim {
  if (OPINION.test(text) && !looksLikeReportedFact(text)) return { kind: 'OPINION', text };
  if (/\b(dépend|incertain|peut-être|on ne sait pas)\b/i.test(text)) return { kind: 'UNCERTAINTY', text };
  if (PREDICTION.test(text)) return { kind: 'PREDICTION', text };
  if (UNCERTAIN.test(text) && !NUMBER.test(text)) return { kind: 'UNCERTAINTY', text };
  if (OPINION.test(text)) return { kind: 'OPINION', text };
  return { kind: 'FACT', text };
}

export function visionHook(transcript: string, segments: ScoredSegment[]): VisionHook {
  const graphic = segments.find((segment) => /graphique|tableau|courbe|slide|présentation/i.test(segment.text));
  const timestamp = graphic?.timestamp;
  const where = timestamp ? ` à ${timestamp}` : '';
  const hint = graphic ? ' Un graphique est mentionné dans l’audio, sans lecture visuelle.' : '';
  return {
    available: false,
    ...(timestamp ? { timestamp } : {}),
    detectedGraphic: Boolean(graphic),
    message: `Vision indisponible${where}.${hint} Aucun graphique n'a été lu. L'analyse audio est complète.`,
  };
}

export function buildVideoMemory(transcript: string, summary: string): VideoMemoryRecord {
  const segments = scoreTranscript(transcript).filter((segment) => segment.score >= 31);
  const claims = segments.map((segment) => classifyClaim(segment.text));
  return {
    summary: summary.slice(0, 2000),
    themes: themesOf(transcript),
    concepts: unique(segments.filter((s) => s.signals.includes('concept')).map((s) => s.text)).slice(0, 6),
    figures: unique(segments.flatMap((s) => s.text.match(/\d[\d\s.,]*%?/g) ?? [])).slice(0, 12),
    companies: unique(transcript.match(/\b[A-Z][A-Za-z0-9&.-]{2,}\b/g) ?? []).slice(0, 8),
    risks: claims.filter((c) => RISK.test(c.text)).map((c) => c.text).slice(0, 6),
    conclusions: claims.filter((c) => CONCLUSION.test(c.text) || c.kind === 'FACT').map((c) => c.text).slice(0, 6),
    timestamps: unique(segments.flatMap((s) => (s.timestamp ? [s.timestamp] : []))).slice(0, 8),
  };
}

export function formatVideoAnalysis(transcript: string, summary: string): string {
  const domain = detectVideoDomain(transcript);
  const segments = scoreTranscript(transcript);
  const useful = segments.filter((segment) => segment.score >= 31).slice(0, 8);
  const claims = useful.map((segment) => classifyClaim(segment.text));
  const memory = buildVideoMemory(transcript, summary);
  const vision = visionHook(transcript, segments);
  const lines = [
    'Analyse par segments (le transcript complet n’est pas envoyé au modèle).',
    ...useful.map((segment) => {
      const when = segment.timestamp ? ` [${segment.timestamp}]` : '';
      return `- ${segment.band} ${segment.score}/100${when} : ${clip(segment.text)}`;
    }),
    '',
    'Synthèse intermédiaire',
    ...groupThemes(useful).map((theme) => `- ${theme}`),
    '',
    pedagogical(summary, claims, memory, domain),
    '',
    vision.message,
  ];
  if (domain === 'finance') {
    lines.push('', financeFrame(claims, memory));
  }
  return lines.filter((line) => line !== undefined).join('\n').trim();
}

export function formatVideoMemory(record: VideoMemoryRecord): string {
  return [
    'Mémoire vidéo',
    `Résumé : ${record.summary}`,
    `Thèmes : ${record.themes.join(', ') || 'aucun'}`,
    `Concepts : ${record.concepts.join(' | ') || 'aucun'}`,
    `Chiffres : ${record.figures.join(', ') || 'aucun'}`,
    `Entreprises : ${record.companies.join(', ') || 'aucune'}`,
    `Risques : ${record.risks.join(' | ') || 'aucun'}`,
    `Conclusions : ${record.conclusions.join(' | ') || 'aucune'}`,
    `Timestamps : ${record.timestamps.join(', ') || 'aucun'}`,
  ].join('\n');
}

function pedagogical(
  summary: string,
  claims: Claim[],
  memory: VideoMemoryRecord,
  domain: VideoDomain,
): string {
  const points = claims.slice(0, 5).map((claim, index) => `${index + 1}. ${claim.kind} — ${clip(claim.text)}`);
  while (points.length < 5) points.push(`${points.length + 1}. —`);
  const figures = memory.figures.slice(0, 4);
  const plain = domain === 'finance' ? 'Les termes financiers sont gardés tels qu’ils ont été dits.' : 'Formulation simple.';
  return [
    'Ce qu’il faut comprendre',
    clip(summary) || 'Le condensé ci-dessus.',
    '5 points essentiels',
    ...points,
    'Chiffres importants',
    figures.length ? figures.map((figure) => `${figure} : valeur dite dans la vidéo, à lire avec son contexte.`).join('\n') : 'Aucun chiffre retenu.',
    'Risques',
    memory.risks[0] ?? 'Aucun risque explicite retenu.',
    'Exemples',
    claims.find((claim) => EXAMPLE.test(claim.text))?.text ?? 'Aucun exemple marquant.',
    'À retenir',
    memory.conclusions[0] ?? clip(summary),
    plain,
  ].join('\n');
}

function financeFrame(claims: Claim[], memory: VideoMemoryRecord): string {
  const opinion = claims.find((claim) => claim.kind === 'OPINION');
  const prediction = claims.find((claim) => claim.kind === 'PREDICTION');
  const fact = claims.find((claim) => claim.kind === 'FACT');
  return [
    'Cadre finance',
    `Thèse : ${clip(fact?.text ?? 'non énoncée')}`,
    `Arguments : ${clip(opinion?.text ?? fact?.text ?? 'non énoncés')}`,
    `Catalyseurs : ${memory.figures.slice(0, 3).join(', ') || 'aucun chiffre catalyseur'}`,
    `Risques : ${memory.risks[0] ?? 'aucun risque chiffré'}`,
    `Hypothèses : ${prediction ? `PRÉVISION — ${clip(prediction.text)}` : 'aucune prévision retenue'}`,
    'Conditions d’invalidation : si les chiffres cités sont contredits par une source ultérieure.',
    'Une opinion n’est pas un fait.',
  ].join('\n');
}

function groupThemes(segments: ScoredSegment[]): string[] {
  if (segments.length === 0) return ['Pas assez de matière pour un thème.'];
  const groups = new Map<string, string[]>();
  for (const segment of segments) {
    const key = segment.signals.find((signal) => signal !== 'information') ?? 'autre';
    const list = groups.get(key) ?? [];
    list.push(clip(segment.text));
    groups.set(key, list);
  }
  return [...groups.entries()].slice(0, 4).map(([theme, lines]) => `${theme} : ${lines[0]}`);
}

function themesOf(transcript: string): string[] {
  const domain = detectVideoDomain(transcript);
  const themes = domain === 'finance' ? ['finance'] : ['général'];
  if (/marge|chiffre d’affaires|eps|bénéfice/i.test(transcript)) themes.push('résultats');
  if (RISK.test(transcript)) themes.push('risques');
  return themes;
}

function chunkPlain(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [text.trim()].filter(Boolean);
}

function similarity(a: string, b: string): number {
  const left = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const right = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

function looksLikeReportedFact(text: string): boolean {
  return /\b(annonce|a déclaré|publie|selon le communiqué)\b/i.test(text) && NUMBER.test(text);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 220 ? `${clean.slice(0, 219)}…` : clean;
}

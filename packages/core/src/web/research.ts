export interface ResearchHit {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  query?: string;
}

export interface PageAssessment {
  empty: boolean;
  antiBot: boolean;
  invalidHtml: boolean;
}

export interface ReadSource {
  url: string;
  title: string;
  text: string;
  assessment: PageAssessment;
}

const ANTI_BOT =
  /captcha|unusual traffic|cf-browser-verification|vérification anti-robot|attention required|access denied|enable javascript and cookies|bot detection/i;

export function normalizeResearchUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function researchDomain(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

export function dedupeHits(hits: ResearchHit[]): ResearchHit[] {
  const seen = new Set<string>();
  const out: ResearchHit[] = [];
  for (const hit of hits) {
    const key = normalizeResearchUrl(hit.url) || `${hit.title}|${hit.snippet}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

/** Plusieurs domaines, pas seulement le premier lien. */
export function selectSources(hits: ResearchHit[], max = 4): ResearchHit[] {
  const picked: ResearchHit[] = [];
  const domains = new Set<string>();
  for (const hit of hits) {
    const domain = researchDomain(hit.url) || hit.source || hit.title;
    if (domains.has(domain)) continue;
    domains.add(domain);
    picked.push(hit);
    if (picked.length >= max) break;
  }
  if (picked.length < Math.min(max, hits.length)) {
    for (const hit of hits) {
      if (picked.includes(hit)) continue;
      picked.push(hit);
      if (picked.length >= max) break;
    }
  }
  return picked;
}

export function assessHtml(raw: string, text: string): PageAssessment {
  const trimmed = raw.trim();
  const antiBot = ANTI_BOT.test(raw);
  const hasTag = /<[a-z!/]/i.test(trimmed);
  const invalidHtml = trimmed.length > 20 && !hasTag && /[\u0000-\u0008]/.test(trimmed);
  const empty = text.trim().length < 40;
  return { empty, antiBot, invalidHtml };
}

export interface ResearchBrief {
  facts: string[];
  sources: string[];
  interpretation: string[];
  uncertainty: string[];
}

/**
 * Un fait n'est retenu que s'il est porté par au moins deux lectures.
 * Le premier résultat seul reste une source, pas une vérité.
 */
export function compareSources(reads: ReadSource[]): ResearchBrief {
  const usable = reads.filter((read) => read.text.trim().length >= 40 && !read.assessment.antiBot);
  const sentences = usable.flatMap((read) =>
    splitSentences(read.text).map((sentence) => ({
      sentence,
      skeleton: skeletonOf(sentence),
      domain: researchDomain(read.url) || read.title,
    })),
  );

  const grouped = new Map<string, { sentence: string; domains: Set<string>; numbers: Set<string> }>();
  for (const item of sentences) {
    if (item.skeleton.length < 24) continue;
    const numbers = item.sentence.match(/\d[\d\s.,]*/g)?.join('|') ?? '';
    const existing = grouped.get(item.skeleton);
    if (existing) {
      existing.domains.add(item.domain);
      existing.numbers.add(numbers);
    } else {
      grouped.set(item.skeleton, {
        sentence: item.sentence,
        domains: new Set([item.domain]),
        numbers: new Set([numbers]),
      });
    }
  }

  const facts: string[] = [];
  const uncertainty: string[] = [];
  for (const item of grouped.values()) {
    if (item.domains.size >= 2 && item.numbers.size <= 1) facts.push(item.sentence);
  }

  const contradictions = findNumericContradictions(sentences);
  uncertainty.push(...contradictions);

  for (const read of reads) {
    if (read.assessment.antiBot) {
      uncertainty.push(`Mur anti-robot sur ${researchDomain(read.url) || read.url} : page non lue.`);
    } else if (read.assessment.invalidHtml) {
      uncertainty.push(`HTML invalide sur ${researchDomain(read.url) || read.url}.`);
    } else if (read.assessment.empty || read.text.trim().length < 40) {
      uncertainty.push(`Page vide ou illisible : ${researchDomain(read.url) || read.url}.`);
    }
  }

  if (facts.length === 0) {
    uncertainty.push(
      'Aucune affirmation n’est confirmée par deux sources. Le premier résultat n’est pas traité comme un fait.',
    );
  }

  const sources = reads.map((read) => {
    const domain = researchDomain(read.url) || read.title;
    return read.title ? `${read.title} (${domain})` : domain;
  });

  return {
    facts: facts.slice(0, 5),
    sources,
    interpretation: [
      facts.length
        ? 'Les faits ci-dessus sont ceux repris par au moins deux domaines. Le reste reste à vérifier.'
        : 'Les extraits et les pages lues ne se recoupent pas assez pour une affirmation ferme.',
    ],
    uncertainty,
  };
}

export function formatClaimLabels(brief: ResearchBrief): string {
  const lines = [
    'Le premier résultat n’est pas une vérité.',
    ...brief.facts.map((fact) => `FAIT — ${fact}`),
    ...brief.sources.map((source) => `SOURCE — ${source}`),
    ...brief.interpretation.map((line) => `INTERPRÉTATION — ${line}`),
    ...(brief.uncertainty.length
      ? brief.uncertainty.map((line) => `INCERTITUDE — ${line}`)
      : ['INCERTITUDE — rien de contradictoire n’a été détecté dans les pages lues.']),
  ];
  if (brief.facts.length === 0) {
    lines.splice(1, 0, 'FAIT — aucun fait recoupé.');
  }
  return lines.join('\n');
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length >= 24 && part.length <= 280);
}

function skeletonOf(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/\d[\d\s.,%]*/g, '#')
    .replace(/[^\p{L}\p{N}# ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findNumericContradictions(
  sentences: { sentence: string; skeleton: string; domain: string }[],
): string[] {
  const bySkeleton = new Map<string, { numbers: string; domain: string }[]>();
  for (const item of sentences) {
    const numbers = item.sentence.match(/\d[\d\s.,]*/g)?.join('|') ?? '';
    if (!numbers) continue;
    const list = bySkeleton.get(item.skeleton) ?? [];
    list.push({ numbers, domain: item.domain });
    bySkeleton.set(item.skeleton, list);
  }
  const notes: string[] = [];
  for (const list of bySkeleton.values()) {
    const distinct = new Map<string, string>();
    for (const item of list) distinct.set(item.numbers, item.domain);
    if (distinct.size >= 2) {
      const domains = [...distinct.values()].slice(0, 3).join(' et ');
      notes.push(`Sources contradictoires (${domains}) : les chiffres ne concordent pas.`);
    }
  }
  return notes.slice(0, 3);
}

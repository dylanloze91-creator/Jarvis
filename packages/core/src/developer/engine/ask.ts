import { z } from 'zod';
import { CodeModelFormatError, extractJson } from '../codeSchemas.js';
import { normalizeRepoRelative, protectedRepoPath } from '../repoPaths.js';
import type { ProjectProfile } from './projectProfile.js';

export const ASK_MARKER = 'ÉTAPE : QUESTION';

/** Outils de lecture montrés au modèle pour une question : rien n'écrit. */
export const ASK_TOOLS = [
  'dev_read_file',
  'dev_search_code',
  'dev_search_files',
  'dev_git_status',
  'dev_git_diff',
  'dev_inspect_logs',
] as const;

const citationSchema = z
  .object({
    path: z.string().optional(),
    chemin: z.string().optional(),
    excerpt: z.string().optional(),
    extrait: z.string().optional(),
  })
  .passthrough();

/** Le modèle peut répondre en français ou en anglais : les deux formes sont acceptées. */
const rawAskSchema = z
  .object({
    reponse: z.string().optional(),
    réponse: z.string().optional(),
    answer: z.string().optional(),
    fichiers: z.array(z.string()).optional(),
    files: z.array(z.string()).optional(),
    citations: z.array(citationSchema).optional(),
  })
  .passthrough()
  .refine((value) => (value.reponse ?? value.réponse ?? value.answer ?? '').trim().length > 0, {
    message: 'la réponse (« reponse ») est vide',
  });

export interface AskCitation {
  path: string;
  excerpt: string;
}

export interface AskAnswer {
  answer: string;
  files: string[];
  citations: AskCitation[];
}

export type CitationStatus = 'verified' | 'not-found' | 'missing-file' | 'refused';

export interface CheckedCitation extends AskCitation {
  status: CitationStatus;
}

export interface CheckedFile {
  path: string;
  exists: boolean;
}

export interface CheckedAnswer {
  answer: string;
  files: CheckedFile[];
  citations: CheckedCitation[];
  verified: number;
}

export const CITATION_LABELS: Record<CitationStatus, string> = {
  verified: 'vérifiée dans le fichier',
  'not-found': 'extrait introuvable dans le fichier',
  'missing-file': 'fichier absent',
  refused: 'chemin refusé',
};

export function askSystemPrompt(project: ProjectProfile): string {
  return `Tu es Jarvis Développeur. ${ASK_MARKER}.
${project.promptContext}
Tu réponds à une question sur le code existant. Tu ne modifies rien.
Cherche les vrais fichiers avec les outils de lecture (dev_search_files, dev_search_code, dev_read_file ; dev_git_status, dev_git_diff et dev_inspect_logs si la question porte sur l'état de la copie ou les journaux), en peu d'appels.
N'affirme rien que tu n'as pas lu. Appuie chaque fait sur un extrait copié tel quel depuis un fichier lu.
Termine par un seul bloc JSON, sans autre texte après :
{"reponse": "réponse en français", "fichiers": ["chemin/relatif.ts"], "citations": [{"chemin": "chemin/relatif.ts", "extrait": "ligne copiée telle quelle"}]}`;
}

export function askPrompt(question: string): string {
  return `Question de l'utilisateur :\n${question.trim()}`;
}

/** Réponse extraite ; lève CodeModelFormatError avec un message à renvoyer au modèle. */
export function parseAskReply(text: string): AskAnswer {
  const parsed = rawAskSchema.safeParse(extractJson(text));
  if (!parsed.success) {
    throw new CodeModelFormatError(
      `Réponse invalide : ${parsed.error.issues.map((i) => i.message).join(' ; ')}`,
      text,
    );
  }
  const raw = parsed.data;
  return {
    answer: (raw.reponse ?? raw.réponse ?? raw.answer ?? '').trim().slice(0, 4_000),
    files: [
      ...new Set((raw.fichiers ?? raw.files ?? []).map((f) => f.trim()).filter(Boolean)),
    ].slice(0, 20),
    citations: (raw.citations ?? [])
      .map((c) => ({
        path: (c.chemin ?? c.path ?? '').trim(),
        excerpt: (c.extrait ?? c.excerpt ?? '').trim().slice(0, 600),
      }))
      .filter((c) => c.path && c.excerpt)
      .slice(0, 12),
  };
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Extrait présent dans le fichier, espaces mis à part. Un extrait de moins de 4 caractères ne prouve rien. */
export function excerptFound(excerpt: string, content: string): boolean {
  const needle = squash(excerpt);
  return needle.length >= 4 && squash(content).includes(needle);
}

/** Lecture d'un fichier de la copie : son texte, ou null s'il n'existe pas. */
export type RepoReader = (path: string) => Promise<string | null>;

/**
 * Vérifie les fichiers et les extraits cités par le modèle. Le modèle ne dit
 * jamais lui-même qu'une citation est juste : le fichier est relu.
 */
export async function checkAnswer(answer: AskAnswer, read: RepoReader): Promise<CheckedAnswer> {
  const cache = new Map<string, string | null>();
  const load = async (path: string): Promise<string | null | 'refused'> => {
    const rel = normalizeRepoRelative(path);
    if (!rel || protectedRepoPath(rel)) return 'refused';
    if (!cache.has(rel)) cache.set(rel, await read(rel));
    return cache.get(rel) ?? null;
  };
  const files: CheckedFile[] = [];
  for (const path of answer.files) {
    const content = await load(path);
    files.push({ path, exists: typeof content === 'string' && content !== 'refused' });
  }
  const citations: CheckedCitation[] = [];
  for (const citation of answer.citations) {
    const content = await load(citation.path);
    const status: CitationStatus =
      content === 'refused'
        ? 'refused'
        : content === null
          ? 'missing-file'
          : excerptFound(citation.excerpt, content)
            ? 'verified'
            : 'not-found';
    citations.push({ ...citation, status });
  }
  return {
    answer: answer.answer,
    files,
    citations,
    verified: citations.filter((c) => c.status === 'verified').length,
  };
}

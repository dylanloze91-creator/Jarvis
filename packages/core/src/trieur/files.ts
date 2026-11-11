/** Fichiers du trieur dans le dossier de données utilisateur (jamais commités). */
export const TRIEUR_DEFAULT_DIR = 'C:\\dev\\jarvis-data\\trieur';

export const TRIEUR_FILES = {
  toSort: 'a-trier.jsonl',
  exam: 'examen.jsonl',
  training: 'entrainement.jsonl',
  validated: 'valide.jsonl',
  rejects: 'rejets.jsonl',
  sortProgress: 'tri-progress.json',
  prepDir: 'preparation',
} as const;

/** Nom d'un examen à part (`--examen jarvis` → `examen-jarvis.jsonl`) : lettres minuscules, chiffres, tirets. */
const EXAM_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function checkExamName(name: string): string | null {
  if (!EXAM_NAME.test(name)) return 'nom d’examen invalide : lettres minuscules, chiffres et tirets seulement';
  return null;
}

function withSuffix(file: string, name: string | undefined): string {
  if (!name) return file;
  const dot = file.lastIndexOf('.');
  return `${file.slice(0, dot)}-${name}${file.slice(dot)}`;
}

/**
 * Chemins des fichiers du trieur. Avec `examName`, les fichiers de l'examen (à trier, examen, progression du
 * tri) prennent un suffixe ; cahier, validées, rejets et préparation restent communs.
 */
export function trieurFileNames(dir: string, examName?: string): Record<keyof typeof TRIEUR_FILES, string> {
  if (examName) {
    const problem = checkExamName(examName);
    if (problem) throw new Error(problem);
  }
  const base = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  return {
    toSort: `${base}/${withSuffix(TRIEUR_FILES.toSort, examName)}`,
    exam: `${base}/${withSuffix(TRIEUR_FILES.exam, examName)}`,
    training: `${base}/${TRIEUR_FILES.training}`,
    validated: `${base}/${TRIEUR_FILES.validated}`,
    rejects: `${base}/${TRIEUR_FILES.rejects}`,
    sortProgress: `${base}/${withSuffix(TRIEUR_FILES.sortProgress, examName)}`,
    prepDir: `${base}/${TRIEUR_FILES.prepDir}`,
  };
}

/**
 * Tous les fichiers d'examen d'un dossier (`examen.jsonl` puis `examen-<nom>.jsonl`), à partir de la liste des
 * noms de fichiers. Le générateur et la préparation les lisent tous : aucune phrase d'examen n'entre dans le cahier.
 */
export function listExamFiles(dir: string, entries: readonly string[]): string[] {
  const base = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  const names = entries
    .filter((name) => name === TRIEUR_FILES.exam || /^examen-[a-z0-9]+(?:-[a-z0-9]+)*\.jsonl$/.test(name))
    .sort((a, b) => (a === TRIEUR_FILES.exam ? -1 : b === TRIEUR_FILES.exam ? 1 : a.localeCompare(b)));
  return names.map((name) => `${base}/${name}`);
}

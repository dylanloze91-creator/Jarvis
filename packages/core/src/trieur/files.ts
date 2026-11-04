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

export function trieurFileNames(dir: string): Record<keyof typeof TRIEUR_FILES, string> {
  const base = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  return {
    toSort: `${base}/${TRIEUR_FILES.toSort}`,
    exam: `${base}/${TRIEUR_FILES.exam}`,
    training: `${base}/${TRIEUR_FILES.training}`,
    validated: `${base}/${TRIEUR_FILES.validated}`,
    rejects: `${base}/${TRIEUR_FILES.rejects}`,
    sortProgress: `${base}/${TRIEUR_FILES.sortProgress}`,
    prepDir: `${base}/${TRIEUR_FILES.prepDir}`,
  };
}

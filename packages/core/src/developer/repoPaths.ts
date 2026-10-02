import { secretReason } from './commandRulesSystem.js';

/**
 * Chemins demandés par un outil de lecture : toujours relatifs à la copie de
 * travail. `null` = refusé (absolu, lecteur, `..`, chemin réseau, magie git).
 */
export function normalizeRepoRelative(input: string): string | null {
  // eslint-disable-next-line no-control-regex -- un octet nul ou de contrôle dans un chemin est refusé.
  if (/[\u0000-\u001F]/.test(input)) return null;
  const value = input.trim().replace(/\\/g, '/');
  if (!value || value === '.') return '';
  if (
    value.startsWith('/') ||
    /^[a-z]:/i.test(value) ||
    value.startsWith(':') ||
    value.startsWith('~')
  )
    return null;
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') return null;
    parts.push(part);
  }
  return parts.join('/');
}

/** Fichiers que les outils de code ne lisent jamais : internes de git, secrets, dépendances. */
export function protectedRepoPath(relative: string): string | null {
  const lower = relative.toLowerCase();
  const segments = lower.split('/');
  if (segments.includes('.git')) return 'les fichiers internes de git ne sont pas lisibles';
  if (segments.includes('node_modules')) return 'les dépendances (node_modules) ne sont pas lues';
  const name = segments[segments.length - 1] ?? '';
  const secret = secretReason(name) ?? secretReason(relative);
  return secret ? `fichier protégé : ${secret}` : null;
}

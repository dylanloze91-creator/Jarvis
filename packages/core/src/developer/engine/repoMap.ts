/** Carte courte du dépôt pour le prompt Codeur (5.0.30). */
export function summarizeRepoTree(paths: readonly string[], maxChars = 2_000): string {
  const sorted = [...paths].sort((a, b) => a.localeCompare(b, 'fr'));
  const lines: string[] = [];
  let used = 0;
  for (const p of sorted) {
    const line = `- ${p}`;
    if (used + line.length + 1 > maxChars) {
      lines.push(`- … (${sorted.length - lines.length} autres fichiers)`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length ? `Arborescence du projet :\n${lines.join('\n')}` : '';
}

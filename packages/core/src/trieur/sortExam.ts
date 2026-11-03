/** Retire la dernière ligne non vide d'un fichier examen.jsonl. */
export function dropLastExamLine(raw: string): { content: string; removed: boolean } {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { content: '', removed: false };
  lines.pop();
  return { content: lines.length ? `${lines.join('\n')}\n` : '', removed: true };
}

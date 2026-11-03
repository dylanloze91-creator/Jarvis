/**
 * Piper (2023.11.14-2, `src/cpp/main.cpp`) lit stdin ligne par ligne ; avec
 * `--output_file`, les lignes suivantes sont fusionnées en une seule phrase
 * avant synthèse. On envoie une seule ligne : retours à la ligne et blancs
 * multiples deviennent une espace.
 */
export function normalizePiperStdinText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

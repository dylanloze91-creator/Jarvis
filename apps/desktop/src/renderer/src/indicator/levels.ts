const MIN_BAR_PX = 4;
const MAX_BAR_PX = 22;

/** Niveaux récents du micro (RMS) → hauteurs des barres, les plus récents au centre. */
export function indicatorBarHeights(history: number[], count: number): number[] {
  const center = (count - 1) / 2;
  return Array.from({ length: count }, (_, index) => {
    const age = Math.round(Math.abs(index - center));
    const level = history[history.length - 1 - age] ?? 0;
    const normalized = Math.max(0, Math.min(1, Math.sqrt(Math.max(0, level) / 0.25)));
    const taper = 1 - age / (count + 1);
    return MIN_BAR_PX + normalized * taper * (MAX_BAR_PX - MIN_BAR_PX);
  });
}

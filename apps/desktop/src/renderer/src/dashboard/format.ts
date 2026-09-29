export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return 'indisponible';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : 1;
  const label = units[unit] ?? 'o';
  return `${value.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${label}`;
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'indisponible';
  return `${Math.round(value).toLocaleString('fr-FR')} %`;
}

/** Température de génération du modèle (réglage 0–2), pas une sonde en degrés. */
export function formatModelTemperature(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'indisponible';
  return value.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

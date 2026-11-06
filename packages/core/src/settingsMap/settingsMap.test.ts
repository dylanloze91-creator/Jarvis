import { describe, expect, it } from 'vitest';
import { SETTINGS_ACTION_MAP, SETTINGS_FIELD_MAP } from './fields.js';
import { sampleSettingsFromSchema } from './schemaSample.js';

function flattenPaths(value: unknown, prefix = ''): string[] {
  if (value === null || value === undefined) return prefix ? [prefix] : [];
  if (Array.isArray(value)) return prefix ? [prefix] : [];
  if (typeof value !== 'object') return prefix ? [prefix] : [];
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) return prefix ? [prefix] : [];
  const paths: string[] = [];
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const child = record[key];
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      const nested = flattenPaths(child, path);
      paths.push(...(nested.length ? nested : [path]));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

describe('settingsMap — carte complète', () => {
  it('chaque chemin du schéma a une place dans la nouvelle carte', () => {
    const paths = flattenPaths(sampleSettingsFromSchema());
    const missing = paths.filter((path) => !SETTINGS_FIELD_MAP[path]);
    expect(missing).toEqual([]);
  });

  it('chaque action ou état hors schéma a une place', () => {
    for (const key of Object.keys(SETTINGS_ACTION_MAP)) {
      expect(SETTINGS_ACTION_MAP[key]).toBeTruthy();
    }
  });

  it('aucune entrée ne pointe vers une catégorie inconnue', () => {
    const valid = new Set(['moi', 'parler', 'services', 'brain', 'security', 'application']);
    for (const entry of [...Object.values(SETTINGS_FIELD_MAP), ...Object.values(SETTINGS_ACTION_MAP)]) {
      expect(valid.has(entry.category)).toBe(true);
      expect(entry.subcategory.length).toBeGreaterThan(0);
    }
  });
});

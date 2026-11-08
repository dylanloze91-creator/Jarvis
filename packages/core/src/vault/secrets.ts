import type { ZodType } from 'zod';
import { isSecretObjectKey } from '../security/redact.js';
import { parseSettings, settingsSchema, type Settings } from '../settings.js';

/** Marqueur envoyé à la fenêtre à la place d'une clé. Jamais la clé elle-même. */
export const SECRET_MARKER = 'clé enregistrée';

function schemaDef(schema: ZodType): { type: string; [key: string]: unknown } {
  return (schema as ZodType)._zod.def as { type: string; [key: string]: unknown };
}

function unwrap(schema: ZodType): ZodType {
  let current = schema;
  for (;;) {
    const def = schemaDef(current);
    if (def.type === 'optional' || def.type === 'default') {
      current = def.innerType as ZodType;
      continue;
    }
    return current;
  }
}

function objectShape(schema: ZodType): Record<string, ZodType> {
  const def = schemaDef(unwrap(schema));
  if (def.type !== 'object') return {};
  const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
  return shape as Record<string, ZodType>;
}

function collect(schema: ZodType, prefix: string, out: string[]): void {
  const def = schemaDef(unwrap(schema));
  if (def.type !== 'object') return;
  for (const [key, child] of Object.entries(objectShape(schema))) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isSecretObjectKey(key)) out.push(path);
    collect(child, path, out);
  }
}

/** Liste unique des champs secrets du schéma, ceux que `redactValue` masque. */
export function secretSettingPaths(schema: ZodType = settingsSchema): string[] {
  const paths: string[] = [];
  collect(schema, '', paths);
  return paths.sort();
}

export const SECRET_SETTING_PATHS = secretSettingPaths();

function readPath(source: unknown, path: string): unknown {
  let current = source;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function writePath(source: Record<string, unknown>, path: string, value: string): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = source;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      const created: Record<string, unknown> = {};
      current[part] = created;
      current = created;
    } else {
      current = next as Record<string, unknown>;
    }
  }
  const leaf = parts[parts.length - 1];
  if (leaf) current[leaf] = value;
}

export function readSecret(settings: unknown, path: string): string {
  const value = readPath(settings, path);
  return typeof value === 'string' ? value : '';
}

export function blankSecrets(settings: Settings): Settings {
  const copy = structuredClone(settings) as unknown as Record<string, unknown>;
  for (const path of SECRET_SETTING_PATHS) writePath(copy, path, '');
  return copy as unknown as Settings;
}

export function secretsFromSettings(settings: Settings): Record<string, string> {
  const found: Record<string, string> = {};
  for (const path of SECRET_SETTING_PATHS) {
    const value = readSecret(settings, path).trim();
    if (value && value !== SECRET_MARKER) found[path] = value;
  }
  return found;
}

/** La fenêtre reçoit le marqueur, jamais la clé. */
export function maskSecrets(settings: Settings, secrets: Record<string, string>): Settings {
  const copy = structuredClone(settings) as unknown as Record<string, unknown>;
  for (const path of SECRET_SETTING_PATHS) {
    writePath(copy, path, secrets[path] ? SECRET_MARKER : '');
  }
  return copy as unknown as Settings;
}

export interface SecretEdit {
  /** Réglages complets pour les fournisseurs (clés en mémoire). */
  settings: Settings;
  /** Réglages à écrire : clés vidées. */
  disk: Settings;
  /** Coffre après l'édition. */
  secrets: Record<string, string>;
}

/**
 * Un champ laissé sur le marqueur garde la clé du coffre.
 * Un champ vidé la retire. Un champ rempli la remplace.
 * Sans chiffrement : les clés restent dans les réglages, comme avant.
 */
export function applySecretEdit(
  current: Settings,
  patch: Record<string, unknown>,
  vault: Record<string, string>,
  encryptionAvailable: boolean,
): SecretEdit {
  const merged = parseSettings({ ...current, ...patch }, current);
  if (!encryptionAvailable) {
    return { settings: merged, disk: merged, secrets: {} };
  }
  const secrets = { ...vault };
  for (const path of SECRET_SETTING_PATHS) {
    if (!pathInPatch(patch, path)) continue;
    const incoming = readSecret(patch, path);
    if (incoming === SECRET_MARKER) continue;
    if (!incoming.trim()) delete secrets[path];
    else secrets[path] = incoming.trim();
  }
  const withSecrets = structuredClone(blankSecrets(merged)) as unknown as Record<string, unknown>;
  for (const [path, value] of Object.entries(secrets)) writePath(withSecrets, path, value);
  return { settings: withSecrets as unknown as Settings, disk: blankSecrets(withSecrets as unknown as Settings), secrets };
}

function pathInPatch(patch: Record<string, unknown>, path: string): boolean {
  const [top, ...rest] = path.split('.');
  if (!top || !Object.prototype.hasOwnProperty.call(patch, top)) return false;
  if (rest.length === 0) return true;
  const child = patch[top];
  if (!child || typeof child !== 'object' || Array.isArray(child)) return false;
  return pathInPatch(child as Record<string, unknown>, rest.join('.'));
}

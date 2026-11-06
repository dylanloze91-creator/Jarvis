import type { ZodType } from 'zod';
import { ORCHESTRA_TEAMS } from '../agent/orchestraTeams.js';
import { settingsSchema } from '../settings.js';

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

function sampleZodType(schema: ZodType): unknown {
  const def = schemaDef(unwrap(schema));
  switch (def.type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(objectShape(schema))) {
        out[key] = sampleZodType(child);
      }
      return out;
    }
    case 'string':
      return 'exemple';
    case 'number': {
      let value = 1;
      if (typeof def.minimum === 'number') value = Math.max(value, def.minimum);
      if (typeof def.maximum === 'number') value = Math.min(value, def.maximum);
      return value;
    }
    case 'boolean':
      return true;
    case 'enum': {
      const entries = def.entries as Record<string, string> | readonly string[];
      if (Array.isArray(entries)) return entries[0];
      return Object.values(entries)[0];
    }
    case 'array':
      return [];
    case 'record': {
      const keyType = unwrap(def.keyType as ZodType);
      if (keyType && schemaDef(keyType).type === 'enum') {
        const keyDef = schemaDef(keyType);
        const keyEntries = keyDef.entries as Record<string, string> | readonly string[];
        const key = Array.isArray(keyEntries) ? keyEntries[0] : Object.values(keyEntries)[0];
        return { [key]: sampleZodType(def.valueType as ZodType) };
      }
      return { cle: sampleZodType(def.valueType as ZodType) };
    }
    default:
      return 'valeur';
  }
}

/** Objet représentatif dérivé de `settingsSchema.shape` (optionnels et objets dépliés). */
/** Objet représentatif pour parcourir les chemins du schéma (sans exiger un JSON utilisateur valide). */
export function sampleSettingsFromSchema(): Record<string, unknown> {
  const sample = sampleZodType(settingsSchema) as Record<string, unknown>;
  if (sample.orchestra && typeof sample.orchestra === 'object') {
    const orchestra = sample.orchestra as Record<string, unknown>;
    orchestra.teams = Object.fromEntries(
      ORCHESTRA_TEAMS.map((team) => [team, { model: 'qwen2.5:3b', place: 'carte' }]),
    );
  }
  sample.ollamaNumCtx = 8192;
  sample.spotifySpeakerMaxVolume = 70;
  return sample;
}

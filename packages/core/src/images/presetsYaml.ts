/**
 * Lecture du fichier `images_presets.yaml`, sans dépendance.
 *
 * Ce n'est pas un lecteur YAML complet : il lit exactement la forme écrite par
 * `defaultPresetsYaml()`, que l'utilisateur modifie à la main :
 *
 * ```yaml
 * # commentaire
 * drivers-ink:
 *   label: Drivers Ink
 *   steps: 30
 *   blackAndWhite: true
 *   formats: [carre, portrait]
 *   negative: >
 *     texte sur
 *     plusieurs lignes
 * ```
 *
 * Deux niveaux (projet → clé), valeurs : texte (avec ou sans guillemets), nombre,
 * true/false, liste entre crochets, liste `- x` sur les lignes suivantes, texte
 * replié `>` ou `|`. Tout le reste est signalé dans `errors` et ignoré.
 */

import { DEFAULT_PRESETS, IMAGE_PROJECTS, type ImagePreset } from './presets.js';

export interface PresetsYamlResult {
  values: Record<string, Record<string, unknown>>;
  errors: string[];
}

function stripComment(line: string): string {
  // Un `#` précédé d'un espace (ou en tête) commence un commentaire ; `#` collé reste du texte.
  const index = line.search(/(^|\s)#/);
  return index < 0 ? line : line.slice(0, index);
}

function parseScalar(raw: string): unknown {
  const text = raw.trim();
  if (text === '') return '';
  if (/^(true|oui|yes)$/i.test(text)) return true;
  if (/^(false|non|no)$/i.test(text)) return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).replace(/\\"/g, '"');
  }
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => parseScalar(item));
  }
  return text;
}

export function parsePresetsYaml(text: string): PresetsYamlResult {
  const values: Record<string, Record<string, unknown>> = {};
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);
  let project: string | null = null;
  let index = 0;
  while (index < lines.length) {
    const rawLine = lines[index] ?? '';
    const line = stripComment(rawLine).replace(/\s+$/, '');
    index += 1;
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
      if (!match) {
        errors.push(`Ligne ${index} : attendu « projet: » (ignorée).`);
        project = null;
        continue;
      }
      if (match[2]?.trim()) {
        errors.push(`Ligne ${index} : un projet n’a pas de valeur sur sa ligne (ignorée).`);
      }
      project = match[1]!;
      values[project] ??= {};
      continue;
    }
    if (!project) {
      errors.push(`Ligne ${index} : clé sans projet (ignorée).`);
      continue;
    }
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) {
      errors.push(`Ligne ${index} : attendu « clé: valeur » (ignorée).`);
      continue;
    }
    const key = match[1]!;
    const rest = match[2] ?? '';
    if (rest === '>' || rest === '|' || rest === '>-' || rest === '|-') {
      // Texte sur les lignes suivantes, plus indentées.
      const parts: string[] = [];
      while (index < lines.length) {
        const next = stripComment(lines[index] ?? '').replace(/\s+$/, '');
        if (!next.trim()) {
          index += 1;
          continue;
        }
        const nextIndent = next.length - next.trimStart().length;
        if (nextIndent <= indent) break;
        parts.push(next.trim());
        index += 1;
      }
      values[project]![key] = rest.startsWith('>') ? parts.join(' ') : parts.join('\n');
      continue;
    }
    if (rest === '') {
      // Liste « - x » sur les lignes suivantes.
      const items: unknown[] = [];
      while (index < lines.length) {
        const next = stripComment(lines[index] ?? '').replace(/\s+$/, '');
        if (!next.trim()) {
          index += 1;
          continue;
        }
        const nextIndent = next.length - next.trimStart().length;
        if (nextIndent <= indent) break;
        const item = /^-\s*(.*)$/.exec(next.trim());
        if (!item) break;
        items.push(parseScalar(item[1] ?? ''));
        index += 1;
      }
      if (items.length) values[project]![key] = items;
      else errors.push(`Ligne ${index} : « ${key} » sans valeur (ignorée).`);
      continue;
    }
    values[project]![key] = parseScalar(rest);
  }
  return { values, errors };
}

function yamlText(value: string): string {
  // Guillemets seulement si nécessaire (deux-points, dièse, crochets, guillemets, bords blancs).
  if (value === '' || /[:#[\]"']|^\s|\s$/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
}

function folded(key: string, value: string): string {
  if (!value) return `  ${key}: ""`;
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && current.length + word.length + 1 > 90) {
      lines.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  return [`  ${key}: >`, ...lines.map((line) => `    ${line}`)].join('\n');
}

/** Fichier de réglages par défaut, commenté en français, prêt à être modifié. */
export function defaultPresetsYaml(presets: Record<string, ImagePreset> = DEFAULT_PRESETS): string {
  const header = [
    '# Réglages des images par projet (Jarvis, module images).',
    '# Modifie les valeurs puis enregistre : Jarvis relit ce fichier à chaque image.',
    '# Une clé absente garde sa valeur par défaut. Une valeur fausse est ignorée et signalée.',
    '#',
    '# Clés : label, description, positivePrefix (texte ajouté devant ta demande),',
    '#   positiveSuffix (texte ajouté derrière), negative (ce que l’image ne doit pas avoir),',
    `#   defaultFormat et formats (parmi : carre, paysage, portrait, 16:9, 9:16),`,
    '#   steps (20 à 40), cfg (4 à 9), sampler, scheduler, blackAndWhite (true/false).',
    '',
  ];
  const blocks = IMAGE_PROJECTS.map((project) => {
    const preset = presets[project]!;
    return [
      `${project}:`,
      `  label: ${yamlText(preset.label)}`,
      folded('description', preset.description),
      folded('positivePrefix', preset.positivePrefix),
      folded('positiveSuffix', preset.positiveSuffix),
      folded('negative', preset.negative),
      `  defaultFormat: ${yamlText(preset.defaultFormat)}`,
      `  formats: [${preset.formats.join(', ')}]`,
      `  steps: ${preset.steps}`,
      `  cfg: ${preset.cfg}`,
      `  sampler: ${yamlText(preset.sampler)}`,
      `  scheduler: ${yamlText(preset.scheduler)}`,
      `  blackAndWhite: ${preset.blackAndWhite ? 'true' : 'false'}`,
      '',
    ].join('\n');
  });
  return `${header.join('\n')}\n${blocks.join('\n')}`;
}

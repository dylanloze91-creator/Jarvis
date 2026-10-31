/**
 * Récupération des appels d'outils écrits en texte (5.0.54). Pur : pas de réseau, pas de disque.
 *
 * Un petit modèle local (Qwen 1,5B à 7B, Qwen-Coder) écrit souvent son appel
 * d'outil dans le texte au lieu du canal structuré d'Ollama :
 *
 * - `<tool_call>{"name": …, "arguments": …}</tool_call>` (gabarit Hermes de Qwen2.5) ;
 * - un objet JSON nu ou un bloc ```json qui contient `{"name", "arguments"}` (Qwen2.5-Coder) ;
 * - `<function=nom><parameter=clé>valeur</parameter></function>` (gabarit XML de Qwen3-Coder) ;
 * - du JSON presque valide : retours à la ligne bruts dans une chaîne (le code d'un
 *   fichier), virgule finale, `arguments` encodé en chaîne, `parameters` au lieu d'`arguments`.
 *
 * Seuls les outils réellement proposés au modèle sont acceptés. Un appel qu'on ne
 * sait pas relire n'est jamais inventé : la fonction rend une liste vide.
 */
import type { ToolSchema } from './types.js';

export interface RecoveredToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rend un JSON presque valide lisible : caractères de contrôle bruts échappés
 * dans les chaînes, échappements inconnus (`\s` d'une regex) gardés comme une
 * barre oblique littérale, virgules finales retirées hors des chaînes.
 */
export function repairJsonText(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) {
        out += char;
        escaped = false;
        continue;
      }
      if (char === '\\') {
        // 5.0.59 : un échappement que JSON ne connaît pas (`\s`, `\d`, `\.` d'une
        // expression régulière recopiée telle quelle, ou `\` en fin de texte) est
        // gardé comme une barre oblique littérale au lieu de rendre l'appel illisible.
        const next = text[index + 1];
        const valid =
          next !== undefined &&
          ('"\\/bfnrt'.includes(next) || (next === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(index + 2, index + 6))));
        if (valid) {
          out += char;
          escaped = true;
        } else {
          out += '\\\\';
        }
        continue;
      }
      if (char === '"') {
        inString = false;
        out += char;
        continue;
      }
      const code = char.charCodeAt(0);
      if (char === '\n') out += '\\n';
      else if (char === '\r') out += '\\r';
      else if (char === '\t') out += '\\t';
      else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
      else out += char;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === ',') {
      let next = index + 1;
      while (next < text.length && /\s/.test(text[next]!)) next += 1;
      if (text[next] === '}' || text[next] === ']') continue;
    }
    out += char;
  }
  return out;
}

/** JSON.parse, puis une seconde chance après réparation. `undefined` si illisible. */
export function parseLooseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return JSON.parse(repairJsonText(trimmed));
    } catch {
      return undefined;
    }
  }
}

/**
 * Objets `{…}` ou listes `[…]` de premier niveau trouvés dans un texte, bornés en
 * tenant compte des chaînes (une accolade dans du code ne coupe pas l'objet).
 * Un objet non refermé (réponse tronquée) est ignoré.
 */
export function balancedJsonSpans(text: string): string[] {
  const spans: string[] = [];
  let index = 0;
  while (index < text.length) {
    const open = text[index];
    if (open !== '{' && open !== '[') {
      index += 1;
      continue;
    }
    const stack: string[] = [open];
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let cursor = index + 1; cursor < text.length; cursor += 1) {
      const char = text[cursor]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{' || char === '[') stack.push(char);
      else if (char === '}' || char === ']') {
        const top = stack.pop();
        if ((char === '}' && top !== '{') || (char === ']' && top !== '[')) break;
        if (stack.length === 0) {
          end = cursor;
          break;
        }
      }
    }
    if (end === -1) {
      index += 1;
      continue;
    }
    spans.push(text.slice(index, end + 1));
    index = end + 1;
  }
  return spans;
}

function argumentsOf(candidate: JsonObject): JsonObject | undefined {
  const raw = 'arguments' in candidate ? candidate.arguments : candidate.parameters;
  if (raw === undefined || raw === null) return {};
  if (isObject(raw)) return raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return {};
    const parsed = parseLooseJson(raw);
    return isObject(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** `{"name", "arguments"}`, `{"function": {"name", "arguments"}}` ou une liste de ceux-ci. */
function callsFromJsonValue(value: unknown, allowed: ReadonlyMap<string, ToolSchema>): RecoveredToolCall[] {
  if (Array.isArray(value)) return value.flatMap((item) => callsFromJsonValue(item, allowed));
  if (!isObject(value)) return [];
  const inner = isObject(value.function) ? value.function : value;
  const name = typeof inner.name === 'string' ? inner.name.trim() : '';
  if (!name || !allowed.has(name)) return [];
  if (!('arguments' in inner) && !('parameters' in inner)) {
    // `{"name": "read_file"}` seul n'est un appel que pour un outil sans paramètre obligatoire.
    const required = allowed.get(name)?.parameters.required;
    if (Array.isArray(required) && required.length > 0) return [];
  }
  const args = argumentsOf(inner);
  if (!args) return [];
  return [{ name, arguments: args }];
}

function callsFromJsonText(text: string, allowed: ReadonlyMap<string, ToolSchema>): RecoveredToolCall[] {
  const whole = parseLooseJson(text);
  if (whole !== undefined) return callsFromJsonValue(whole, allowed);
  return balancedJsonSpans(text).flatMap((span) => {
    const parsed = parseLooseJson(span);
    return parsed === undefined ? [] : callsFromJsonValue(parsed, allowed);
  });
}

function schemaType(schema: ToolSchema | undefined, key: string): string | undefined {
  const properties = schema?.parameters.properties;
  if (!isObject(properties)) return undefined;
  const property = properties[key];
  if (!isObject(property)) return undefined;
  return typeof property.type === 'string' ? property.type : undefined;
}

/** Valeur d'un `<parameter=…>` convertie d'après le schéma de l'outil (le gabarit Qwen3-Coder écrit tout en texte). */
function xmlParameterValue(raw: string, type: string | undefined): unknown {
  const value = raw.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  if (type === 'integer' || type === 'number') {
    const number = Number(value.trim());
    return Number.isFinite(number) && value.trim() !== '' ? number : value;
  }
  if (type === 'boolean') {
    const word = value.trim().toLowerCase();
    if (word === 'true') return true;
    if (word === 'false') return false;
    return value;
  }
  if (type === 'object' || type === 'array') {
    const parsed = parseLooseJson(value);
    return parsed === undefined ? value : parsed;
  }
  return value;
}

const XML_FUNCTION = /<function=([^>\s]+)\s*>([\s\S]*?)(?:<\/function>|$)/g;
const XML_PARAMETER = /<parameter=([^>\s]+)\s*>([\s\S]*?)(?:<\/parameter>|(?=<parameter=)|$)/g;

function callsFromXml(text: string, allowed: ReadonlyMap<string, ToolSchema>): RecoveredToolCall[] {
  const calls: RecoveredToolCall[] = [];
  for (const match of text.matchAll(XML_FUNCTION)) {
    const name = match[1]!.trim();
    const schema = allowed.get(name);
    if (!schema) continue;
    const args: JsonObject = {};
    for (const parameter of match[2]!.matchAll(XML_PARAMETER)) {
      const key = parameter[1]!.trim();
      args[key] = xmlParameterValue(parameter[2]!, schemaType(schema, key));
    }
    calls.push({ name, arguments: args });
  }
  return calls;
}

const TOOL_CALL_BLOCK = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/gi;
const FENCE = /```[ \t]*([a-z_-]*)[ \t]*\r?\n([\s\S]*?)```/gi;

/**
 * Appels d'outils lisibles dans un texte, limités aux outils proposés.
 * Ordre d'essai : balises `<tool_call>`, format XML de Qwen3-Coder, texte JSON
 * entier, blocs ```json. Le premier format qui donne au moins un appel gagne.
 */
export function recoverToolCallsFromText(
  text: string,
  tools: readonly ToolSchema[],
): RecoveredToolCall[] {
  if (!text.trim() || tools.length === 0) return [];
  const allowed = new Map(tools.map((tool) => [tool.name, tool]));

  const tagged = [...text.matchAll(TOOL_CALL_BLOCK)].map((match) => match[1]!);
  if (tagged.length > 0) {
    const calls = tagged.flatMap((body) =>
      /<function=/.test(body) ? callsFromXml(body, allowed) : callsFromJsonText(body, allowed),
    );
    if (calls.length > 0) return calls;
  }

  if (/<function=/.test(text)) {
    const calls = callsFromXml(text, allowed);
    if (calls.length > 0) return calls;
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const calls = callsFromJsonText(trimmed, allowed);
    if (calls.length > 0) return calls;
  }

  for (const match of text.matchAll(FENCE)) {
    const language = match[1]!.toLowerCase();
    if (language && !['json', 'tool_call', 'tool', 'jsonc'].includes(language)) continue;
    const calls = callsFromJsonText(match[2]!, allowed);
    if (calls.length > 0) return calls;
  }
  return [];
}

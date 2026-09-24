import { ollamaDescriptor } from './ollama.js';

/**
 * Trois états, pas deux : un serveur qui répond correctement, un serveur
 * absent (rien n'écoute sur le port — Ollama n'est probablement pas démarré
 * ou pas installé), et un serveur injoignable pour une autre raison (URL
 * erronée, pare-feu, DNS, délai dépassé). L'interface a besoin de cette
 * distinction pour orienter l'utilisateur vers la bonne correction.
 */
export type OllamaServerStatus = 'detected' | 'absent' | 'unreachable';

export interface OllamaModelInfo {
  /** Nom complet tel que renvoyé par Ollama, ex. `qwen2.5:3b`. */
  name: string;
  sizeBytes: number;
  parameterSize: string;
  quantizationLevel: string;
  /** Vrai si `/api/tags` annonce la capacité `tools` pour ce modèle. */
  supportsTools: boolean;
  contextLength?: number;
}

export interface OllamaStatusResult {
  status: OllamaServerStatus;
  baseUrl: string;
  /** Présent seulement quand `status === 'detected'`. */
  version?: string;
  models: OllamaModelInfo[];
  /** Message d'explication en français, prêt à afficher tel quel. */
  message: string;
}

interface OllamaTagsResponse {
  models?: {
    name: string;
    size: number;
    details?: { parameter_size?: string; quantization_level?: string; context_length?: number };
    capabilities?: string[];
  }[];
}

interface OllamaVersionResponse {
  version?: string;
}

export type FetchLike = typeof fetch;

/**
 * Sonde le serveur Ollama local. Une seule requête HTTP suffit : `/api/tags`
 * répond avec la liste des modèles installés dès que le serveur tourne, ce
 * qui couvre à la fois « est-il là ? » et « qu'a-t-il d'installé ? ».
 */
export async function checkOllamaStatus(
  baseUrl: string = ollamaDescriptor.defaultBaseUrl!,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<OllamaStatusResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2500;
  const url = normalizeBaseUrl(baseUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${url}/api/tags`, { signal: controller.signal });
    if (!response.ok) {
      return {
        status: 'unreachable',
        baseUrl: url,
        models: [],
        message: `Le serveur a répondu, mais avec une erreur HTTP ${response.status}. Vérifie l'URL configurée.`,
      };
    }
    const data = (await response.json().catch(() => null)) as OllamaTagsResponse | null;
    const models = (data?.models ?? []).map(toModelInfo);
    const version = await fetchVersion(url, fetchImpl, controller.signal);
    return {
      status: 'detected',
      baseUrl: url,
      version,
      models,
      message:
        models.length > 0
          ? `Serveur Ollama détecté${version ? ` (v${version})` : ''} — ${models.length} modèle${models.length > 1 ? 's' : ''} installé${models.length > 1 ? 's' : ''}.`
          : `Serveur Ollama détecté${version ? ` (v${version})` : ''}, mais aucun modèle n'est encore installé.`,
    };
  } catch (error) {
    return classifyError(error, url);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchVersion(
  baseUrl: string,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<string | undefined> {
  try {
    const response = await fetchImpl(`${baseUrl}/api/version`, { signal });
    if (!response.ok) return undefined;
    const data = (await response.json().catch(() => null)) as OllamaVersionResponse | null;
    return data?.version;
  } catch {
    return undefined;
  }
}

function toModelInfo(model: NonNullable<OllamaTagsResponse['models']>[number]): OllamaModelInfo {
  return {
    name: model.name,
    sizeBytes: model.size,
    parameterSize: model.details?.parameter_size ?? '?',
    quantizationLevel: model.details?.quantization_level ?? '?',
    supportsTools: model.capabilities?.includes('tools') ?? false,
    contextLength: model.details?.context_length,
  };
}

/**
 * Distingue « rien n'écoute » (connexion refusée : Ollama n'est pas démarré)
 * de « pas de réponse pour une autre raison » (délai dépassé, hôte inconnu,
 * pare-feu…), en inspectant la cause de l'erreur réseau plutôt que de tout
 * regrouper sous un même message vague.
 */
function classifyError(error: unknown, baseUrl: string): OllamaStatusResult {
  const description = describeNetworkError(error);

  if (description.kind === 'refused') {
    return {
      status: 'absent',
      baseUrl,
      models: [],
      message:
        "Aucun serveur Ollama ne répond sur cette adresse. Ollama n'est probablement pas installé, ou pas démarré.",
    };
  }

  if (description.kind === 'timeout') {
    return {
      status: 'unreachable',
      baseUrl,
      models: [],
      message: "Le serveur n'a pas répondu à temps. Vérifie l'URL, le pare-feu, ou réessaie.",
    };
  }

  return {
    status: 'unreachable',
    baseUrl,
    models: [],
    message: `Impossible de contacter Ollama à cette adresse (${description.detail}). Vérifie l'URL configurée.`,
  };
}

function describeNetworkError(error: unknown): {
  kind: 'refused' | 'timeout' | 'other';
  detail: string;
} {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { kind: 'timeout', detail: 'délai dépassé' };
  }
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause;
  const code = cause?.code ?? '';
  if (code === 'ECONNREFUSED') return { kind: 'refused', detail: code };
  if (code === 'ETIMEDOUT') return { kind: 'timeout', detail: code };
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED/.test(message)) return { kind: 'refused', detail: message };
  return { kind: 'other', detail: message || 'erreur réseau inconnue' };
}

export function normalizeBaseUrl(baseUrl: string): string {
  return (baseUrl || ollamaDescriptor.defaultBaseUrl!).replace(/\/+$/, '');
}

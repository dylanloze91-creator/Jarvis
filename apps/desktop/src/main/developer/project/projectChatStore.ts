import type { ProjectChatMessage } from '../../../shared/developerIpc.js';

export interface ProjectChatPersisted {
  version: 2;
  messages: ProjectChatMessage[];
  decisions: string[];
  codingPick: { model: string; reason: string; at: number } | null;
  webSearchUsed: boolean;
  compareOffer: { alternateModel: string; reason: string } | null;
  /** Accord chat pour télécharger ou lancer un moteur graphique (Godot, Unity…). */
  graphicsEngineGranted?: boolean;
}

export function emptyChatState(): ProjectChatPersisted {
  return {
    version: 2,
    messages: [],
    decisions: [],
    codingPick: null,
    webSearchUsed: false,
    compareOffer: null,
    graphicsEngineGranted: false,
  };
}

export function parseChatPersisted(raw: unknown): ProjectChatPersisted {
  const base = emptyChatState();
  if (!raw || typeof raw !== 'object') return base;
  const row = raw as Record<string, unknown>;
  const messages = parseMessages(row.messages);
  const decisions = Array.isArray(row.decisions)
    ? row.decisions
        .filter((d): d is string => typeof d === 'string')
        .map((d) => d.slice(0, 300))
        .slice(0, 40)
    : [];
  const codingPick = parseCodingPick(row.codingPick);
  return {
    version: 2,
    messages,
    decisions,
    codingPick,
    webSearchUsed: row.webSearchUsed === true,
    compareOffer: parseCompareOffer(row.compareOffer),
    graphicsEngineGranted: row.graphicsEngineGranted === true,
  };
}

function parseMessages(raw: unknown): ProjectChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as Record<string, unknown>;
      const role = row.role === 'assistant' ? 'assistant' : row.role === 'user' ? 'user' : null;
      const content = typeof row.content === 'string' ? row.content.slice(0, 12_000) : '';
      const id = typeof row.id === 'string' ? row.id.slice(0, 40) : '';
      const at = typeof row.at === 'number' ? row.at : 0;
      const hasScreenshot = row.hasScreenshot === true;
      if (!role || !content || !id) return null;
      return { id, role, content, at, ...(hasScreenshot ? { hasScreenshot: true } : {}) };
    })
    .filter((m): m is ProjectChatMessage => m !== null)
    .slice(-80);
}

function parseCodingPick(raw: unknown): ProjectChatPersisted['codingPick'] {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.model !== 'string' || typeof row.reason !== 'string') return null;
  return {
    model: row.model.slice(0, 100),
    reason: row.reason.slice(0, 500),
    at: typeof row.at === 'number' ? row.at : Date.now(),
  };
}

function parseCompareOffer(raw: unknown): ProjectChatPersisted['compareOffer'] {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.alternateModel !== 'string' || typeof row.reason !== 'string') return null;
  return {
    alternateModel: row.alternateModel.slice(0, 100),
    reason: row.reason.slice(0, 400),
  };
}

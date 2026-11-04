import { routerUserPrompt } from '../agent/orchestra.js';
import { createMessage } from '../types.js';
import type { ToSortLine } from './extract.js';
import { phraseKey } from './extract.js';

/** Forme minimale d’un export claude.ai (`conversations.json`). */
export interface ClaudeExportMessage {
  uuid: string;
  sender: string;
  text?: string;
  content?: ReadonlyArray<{ type?: string; text?: string }>;
  parent_message_uuid?: string;
  created_at?: string;
}

export interface ClaudeExportConversation {
  uuid?: string;
  current_leaf_message_uuid?: string;
  chat_messages?: readonly ClaudeExportMessage[];
}

export const CLAUDE_EXPORT_SOURCE = 'claude.ai' as const;
export const CLAUDE_PHRASE_MAX_CHARS = 400;

/** Texte utilisateur tel qu’exporté (sans réécriture). */
export function claudeHumanMessageText(message: ClaudeExportMessage): string {
  if (message.sender !== 'human') return '';
  const parts: string[] = [];
  if (Array.isArray(message.content) && message.content.length > 0) {
    for (const block of message.content) {
      if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    }
  } else if (typeof message.text === 'string') {
    parts.push(message.text);
  }
  return parts.join('\n');
}

export function isPastedCodeBlock(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.includes('```')) return true;
  const lines = trimmed.split('\n');
  if (lines.length >= 2) {
    const codeLike = lines.filter(
      (line) =>
        /^\s*(function |const |let |var |import |export |class |def |public |#include|<\?php)/.test(line) ||
        /^\s*[{}];?\s*$/.test(line) ||
        /^\s{4,}\S/.test(line),
    ).length;
    if (codeLike >= 2) return true;
  }
  return false;
}

export function shouldKeepClaudeUserPhrase(phrase: string): boolean {
  const trimmed = phrase.trim();
  if (!trimmed) return false;
  if (trimmed.length > CLAUDE_PHRASE_MAX_CHARS) return false;
  if (isPastedCodeBlock(trimmed)) return false;
  return true;
}

/** Branche active (feuille la plus récente), ordre chronologique. */
export function claudeMessageBranch(
  messages: readonly ClaudeExportMessage[],
  currentLeafUuid?: string,
): ClaudeExportMessage[] {
  if (!messages.length) return [];
  const byUuid = new Map(messages.map((message) => [message.uuid, message]));
  let leaf: ClaudeExportMessage | undefined =
    (currentLeafUuid ? byUuid.get(currentLeafUuid) : undefined) ?? undefined;
  if (!leaf) {
    const parentUuids = new Set<string>();
    for (const message of messages) {
      if (message.parent_message_uuid) parentUuids.add(message.parent_message_uuid);
    }
    const leaves = messages.filter((message) => !parentUuids.has(message.uuid));
    if (!leaves.length) return [...messages];
    leaf = leaves[0]!;
    for (const candidate of leaves.slice(1)) {
      const a = Date.parse(leaf.created_at ?? '');
      const b = Date.parse(candidate.created_at ?? '');
      if (!Number.isNaN(b) && (Number.isNaN(a) || b >= a)) leaf = candidate;
    }
  }

  const branch: ClaudeExportMessage[] = [];
  const visited = new Set<string>();
  let current: ClaudeExportMessage | undefined = leaf;
  while (current && !visited.has(current.uuid)) {
    visited.add(current.uuid);
    branch.push(current);
    current = current.parent_message_uuid ? byUuid.get(current.parent_message_uuid) : undefined;
  }
  branch.reverse();
  return branch;
}

export function extractFromClaudeExport(
  conversations: readonly ClaudeExportConversation[],
  options?: { synthetiqueTest?: boolean },
): ToSortLine[] {
  const byKey = new Map<string, ToSortLine>();
  for (const conversation of conversations) {
    const branch = claudeMessageBranch(conversation.chat_messages ?? [], conversation.current_leaf_message_uuid);
    let previousUser = '';
    for (const message of branch) {
      if (message.sender !== 'human') continue;
      const phrase = claudeHumanMessageText(message);
      if (!shouldKeepClaudeUserPhrase(phrase)) continue;
      // Même forme que l'extraction des conversations Jarvis (extract.ts) : le contexte est la
      // demande complète vue par le trieur (routerUserPrompt), phrase comprise. Le banc et
      // l'entraînement l'envoient tel quel au modèle ; un simple « message d'avant » ferait
      // classer ce message-là au lieu de la phrase.
      const context = routerUserPrompt(
        phrase.trim(),
        previousUser ? [createMessage('user', previousUser)] : [],
      );
      const key = phraseKey(phrase.trim(), context.trim());
      if (byKey.has(key)) continue;
      byKey.set(key, {
        id: key,
        phrase: phrase.trim(),
        context,
        suggestion: null,
        source: CLAUDE_EXPORT_SOURCE,
        ...(options?.synthetiqueTest ? { synthetiqueTest: true } : {}),
      });
      previousUser = phrase.trim();
    }
  }
  return [...byKey.values()].sort((a, b) => a.phrase.localeCompare(b.phrase, 'fr'));
}

export function mergeToSortLines(...groups: readonly (readonly ToSortLine[])[]): ToSortLine[] {
  const byKey = new Map<string, ToSortLine>();
  for (const lines of groups) {
    for (const line of lines) {
      const key = line.id || phraseKey(line.phrase, line.context);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...line, id: key });
        continue;
      }
      if (!existing.suggestion && line.suggestion) existing.suggestion = line.suggestion;
      if (!existing.source && line.source) existing.source = line.source;
    }
  }
  return [...byKey.values()].sort((a, b) => a.phrase.localeCompare(b.phrase, 'fr'));
}

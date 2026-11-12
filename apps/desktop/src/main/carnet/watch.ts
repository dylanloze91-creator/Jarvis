/**
 * Ce qu'un tour laisse voir au carnet, à partir des événements déjà émis.
 * N'ajoute rien à ces événements.
 */
import type { CarnetHow, ToolLine } from '@jarvis/core';
import type { ChatEvent } from '../../shared/ipc.js';

export function createTurnWatch(startedAt: number) {
  let reply = '';
  let firstAt: number | null = null;
  let team: string | null = null;
  let model: string | null = null;
  let how: CarnetHow | null = null;
  const tools: ToolLine[] = [];

  return {
    see(event: ChatEvent, now: number): void {
      if (event.type === 'delta') {
        reply += event.text;
        if (firstAt === null && event.text.trim()) firstAt = now;
      } else if (event.type === 'route') {
        team = event.team;
        model = event.model;
        how = event.how;
      } else if (event.type === 'tool_result') {
        tools.push({
          name: event.toolName,
          status: event.status,
          line: event.content.replace(/\s+/g, ' ').trim(),
        });
      }
    },
    reply: () => reply,
    team: () => team,
    model: () => model,
    how: () => how,
    tools: () => tools,
    firstWordMs: (): number | null => (firstAt === null ? null : Math.max(0, firstAt - startedAt)),
    responseStartedAt: (): number | null => firstAt,
    buttonCut(now: number): { afterMs: number; button: true } | null {
      if (firstAt === null) return null;
      return { afterMs: Math.max(0, now - firstAt), button: true };
    },
  };
}

import { z } from 'zod';
import { defineTool } from '@jarvis/core';
import { runPowerShell } from './platform/exec.js';

interface EventRow {
  TimeCreated: string;
  LevelDisplayName: string;
  ProviderName: string;
  Id: number;
  Message: string;
}

export const getSystemErrorsTool = defineTool({
  name: 'get_system_errors',
  description:
    "Récupère les erreurs et avertissements récents du journal d'événements Windows (Système et Application). Fonctionnalité propre à Windows : renvoie un message clair sur les autres systèmes.",
  risk: 'safe',
  schema: z.object({
    maxEvents: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(15)
      .describe("Nombre maximum d'événements renvoyés."),
    logName: z.enum(['System', 'Application', 'both']).default('both').describe('Journal ciblé.'),
  }),
  execute: async ({ maxEvents, logName }) => {
    if (process.platform !== 'win32') {
      return {
        ok: false,
        content:
          "Le journal d'événements Windows n'existe pas sur ce système. Cet outil est spécifique à Windows.",
      };
    }

    const logs = logName === 'both' ? "'System','Application'" : `'${logName}'`;
    const script = `
$events = Get-WinEvent -FilterHashtable @{LogName=${logs}; Level=1,2,3} -MaxEvents ${maxEvents} -ErrorAction Stop
$events | Select-Object TimeCreated,LevelDisplayName,ProviderName,Id,@{n='Message';e={$_.Message -replace "\`r\`n"," "}} | ConvertTo-Json -Compress -Depth 3
`.trim();

    const result = await runPowerShell(script, { timeoutMs: 15_000 });
    if (result.timedOut) {
      return { ok: false, content: "Délai dépassé lors de la lecture du journal d'événements." };
    }
    if (result.code !== 0) {
      if (/No events were found/i.test(result.stderr)) {
        return {
          ok: true,
          content: 'Aucune erreur ou avertissement récent dans le journal.',
          data: { events: [] },
        };
      }
      return {
        ok: false,
        content: `Impossible de lire le journal d'événements : ${result.stderr || 'erreur inconnue'}`,
      };
    }

    let events: EventRow[];
    try {
      const parsed = JSON.parse(result.stdout || '[]');
      events = Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      return { ok: false, content: `Réponse inattendue de PowerShell : ${describeError(error)}` };
    }

    if (events.length === 0) {
      return {
        ok: true,
        content: 'Aucune erreur ou avertissement récent dans le journal.',
        data: { events: [] },
      };
    }

    const lines = events.map(
      (e) =>
        `[${e.LevelDisplayName}] ${e.TimeCreated} — ${e.ProviderName} (ID ${e.Id}) : ${truncate(e.Message, 200)}`,
    );

    return {
      ok: true,
      content: [`${events.length} événement(s) récents :`, ...lines].join('\n'),
      data: { events },
    };
  },
});

function truncate(text: string | undefined, max: number): string {
  const value = (text ?? '').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

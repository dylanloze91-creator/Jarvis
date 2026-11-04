import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ORCHESTRA_TEAMS,
  type OrchestraTeam,
  type Settings,
  serializeValidationLine,
  teamValidationEnabled,
  validationPathForHow,
  validationRecord,
  VALIDATION_FILE,
} from '@jarvis/core';

export interface TeamValidationPayload {
  phrase: string;
  context: string;
  proposedTeam: OrchestraTeam;
  chosenTeam: OrchestraTeam;
  path: 'express' | 'cerveau' | 'trieur';
}

export function resolveTrieurDataDir(settings: Settings): string | null {
  const dir = settings.orchestra?.trieurDataDir?.trim();
  return dir || null;
}

export function canOfferTeamValidation(settings: Settings): boolean {
  return teamValidationEnabled(settings.orchestra);
}

export async function appendTeamValidation(settings: Settings, input: TeamValidationPayload): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!canOfferTeamValidation(settings)) {
    return { ok: false, error: 'Validation des équipes désactivée ou dossier absent.' };
  }
  const dir = resolveTrieurDataDir(settings);
  if (!dir) return { ok: false, error: 'Dossier du trieur non configuré.' };
  if (!ORCHESTRA_TEAMS.includes(input.proposedTeam) || !ORCHESTRA_TEAMS.includes(input.chosenTeam)) {
    return { ok: false, error: 'Équipe inconnue.' };
  }
  if (input.path !== 'express' && input.path !== 'cerveau' && input.path !== 'trieur') {
    return { ok: false, error: 'Chemin invalide.' };
  }
  if (!input.phrase.trim()) return { ok: false, error: 'Phrase vide.' };

  const line = validationRecord({
    phrase: input.phrase,
    context: input.context,
    proposedTeam: input.proposedTeam,
    chosenTeam: input.chosenTeam,
    path: validationPathForHow(input.path),
  });

  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, VALIDATION_FILE), serializeValidationLine(line), 'utf8');
  return { ok: true };
}

export { validationPathForHow };

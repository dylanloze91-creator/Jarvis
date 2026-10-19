/** Agents visibles dans le chat Développeur (5.0.28) — un rôle, une tâche. */
export type DeveloperMissionAgent = 'web' | 'preparer' | 'architecte' | 'codeur' | 'testeur';

export const DEVELOPER_MISSION_AGENT_LABELS: Record<DeveloperMissionAgent, string> = {
  web: 'Recherche web (sans modèle)',
  preparer: 'Dossier du projet',
  architecte: 'Gabarit (règles fixes)',
  codeur: 'Code et corrections (modèle)',
  testeur: 'Tests npm/dotnet',
};

export function developerAgentStarted(agent: DeveloperMissionAgent, task: string): string {
  const label = DEVELOPER_MISSION_AGENT_LABELS[agent];
  const t = task.trim();
  return `▶ ${label} — ${t}`;
}

export function developerAgentFinished(agent: DeveloperMissionAgent, result: string): string {
  const label = DEVELOPER_MISSION_AGENT_LABELS[agent];
  const r = result.trim();
  return `✓ ${label} — ${r}`;
}

/** Une ligne française dans le chat quand la mission s’arrête avant le Codeur (5.0.29). */
export function developerAgentFailed(agent: DeveloperMissionAgent, result: string): string {
  const label = DEVELOPER_MISSION_AGENT_LABELS[agent];
  const r = result.trim();
  return `✗ ${label} — ${r}`;
}

export function developerMissionFailureLine(reason: string): string {
  const r = reason.trim().replace(/\s+/g, ' ');
  if (!r) return 'Échec — la mission s’est arrêtée après l’Architecte (raison inconnue).';
  const one = r.split(/[.!?]\s/)[0]!.slice(0, 220);
  return `Échec — ${one}${one.length < r.length ? '…' : ''}`;
}

function clipSentence(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim().replace(/[.。]+$/g, '');
  if (!flat) return '';
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * Une seule phrase française après une étape finie (succès ou échec).
 * Le nom de l’agent et le fait concret (chemin, fichier, nombre de tests).
 */
export function developerStepSentence(input: {
  name: string;
  status: 'done' | 'failed' | 'cancelled';
  detail?: string;
  files?: readonly string[];
  error?: string;
}): string {
  const name = input.name.trim() || 'Étape';
  const who = name.toLocaleLowerCase('fr-FR');
  const detail = clipSentence(input.detail ?? '');
  const error = clipSentence(input.error ?? '');
  const files = [...new Set((input.files ?? []).map((file) => file.trim()).filter(Boolean))];
  if (input.status === 'cancelled') return `${name} : annulé.`;
  if (input.status === 'failed') {
    const why = error || detail || 'cause inconnue';
    if (/préparateur/.test(who)) return `Échec du dossier : ${why}.`;
    if (/n’a pas changé|n'a pas changé|aucune modification/.test(why)) {
      return `Échec du ${who} : le fichier n’a pas changé.`;
    }
    return `Échec du ${who} : ${why}.`;
  }
  if (/préparateur/.test(who)) {
    const path = detail.match(/[A-Za-z]:\\[^\s]+|\/[\w./\\-]+/)?.[0] ?? detail;
    if (/déjà/.test(detail) && path) return `Dossier déjà là : ${path}.`;
    if (path) return `Dossier créé : ${path}.`;
    return 'Dossier créé.';
  }
  if (/testeur/.test(who)) {
    const passed = detail.match(/(\d+)\s+tests?\s+(?:réussis|passés|passed)/i)?.[1];
    if (passed) return `Testeur : ${passed} tests passés.`;
    const failed = detail.match(/(\d+)\s+test(?:\(s\))?\s+échoué/i)?.[1];
    if (failed) return `Testeur : ${failed} tests en échec.`;
    return `Testeur : ${detail || 'vérification terminée'}.`;
  }
  if (/codeur|correcteur/.test(who)) {
    if (files.length === 1) return `${name} : ${files[0]} modifié.`;
    if (files.length > 1) return `${name} : ${files.slice(0, 3).join(', ')} modifiés.`;
    if (input.files && input.files.length === 0) {
      return `Échec du ${who} : le fichier n’a pas changé.`;
    }
    if (detail) return `${name} : ${detail}.`;
    return `${name} : modification enregistrée.`;
  }
  if (/livreur/.test(who)) return `Livreur : ${detail || 'livrable prêt'}.`;
  if (/architecte/.test(who)) return `Architecte : ${detail || 'gabarit choisi'}.`;
  if (/superviseur/.test(who)) return `Superviseur : ${detail || 'plan prêt'}.`;
  if (/recherche/.test(who)) return `Recherche : ${detail || 'aucune source exploitable'}.`;
  return detail ? `${name} : ${detail}.` : `${name} : terminé.`;
}

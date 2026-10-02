import { SCAN_LABELS } from '@jarvis/core';
import type { CodeTaskState } from '../../../shared/developerIpc.js';

const VERDICT: Record<NonNullable<CodeTaskState['report']>['verdict'], string> = {
  success: 'Réussie : aucun nouvel échec par rapport à la référence.',
  failed: 'Échec : des tests échouent encore après les corrections.',
  stopped: 'Arrêtée avant la fin.',
};

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)} s`;
}

/** Rapport de fin de tâche : ce qui a changé, les preuves, et ce qui reste à décider. */
export function buildTaskReport(
  state: CodeTaskState,
  verdict: NonNullable<CodeTaskState['report']>['verdict'],
  reason?: string,
): string {
  const out: string[] = [];
  out.push(`## Tâche : ${state.request}`);
  out.push(`**Verdict :** ${VERDICT[verdict]}${reason ? ` ${reason}` : ''}`);
  out.push(
    `Branche \`${state.branch}\` · copie isolée \`${state.worktreePath}\` · modèle \`${state.model}\`${state.finishedAt ? ` · ${seconds(state.finishedAt - state.startedAt)}` : ''}`,
  );
  out.push('### Fichiers modifiés');
  if (state.diff.length === 0) out.push('Aucun.');
  for (const file of state.diff) {
    const planned = state.plan?.files.find((f) => f.path.toLowerCase() === file.path.toLowerCase());
    const tags = [planned?.core ? 'cœur' : null, planned ? null : 'hors plan'].filter(Boolean);
    out.push(
      `- \`${file.path}\` (+${file.additions} −${file.deletions})${tags.length ? ` — ${tags.join(', ')}` : ''}`,
    );
  }
  out.push('### Tests');
  if (state.baseline) {
    out.push(`| Série | ${state.baseline.map((r) => r.suite).join(' | ')} | Nouveaux échecs |`);
    out.push(`| --- | ${state.baseline.map(() => '---').join(' | ')} | --- |`);
    out.push(`| Référence (avant) | ${state.baseline.map((r) => r.summary).join(' | ')} | — |`);
    for (const run of state.runs)
      out.push(
        `| ${run.label} | ${run.results.map((r) => r.summary).join(' | ')} | ${run.ok ? 'aucun' : run.newFailures.length} |`,
      );
    const last = state.runs[state.runs.length - 1];
    if (last && !last.ok) {
      out.push('Échecs restants :');
      for (const failure of last.newFailures.slice(0, 10)) out.push(`- ${failure}`);
    }
    if (last?.fixed.length) out.push(`Échecs d’avant corrigés au passage : ${last.fixed.length}.`);
  } else out.push('Pas lancés.');
  out.push(`Corrections : ${state.attempts} sur ${state.maxAttempts} au plus.`);
  if (state.checkpoints.length) {
    out.push('### Points de reprise');
    for (const c of state.checkpoints) out.push(`- \`${c.sha.slice(0, 7)}\` ${c.label}`);
  }
  out.push('### Confirmations');
  out.push(
    `${state.planApproved.length} action(s) couvertes par ta validation du plan, ${state.asked} confirmation(s) demandée(s).`,
  );
  if (state.findings.length) {
    out.push('Revue du diff avant les tests (autorisée par toi) :');
    for (const f of state.findings.slice(0, 10))
      out.push(`- ${SCAN_LABELS[f.category]} : \`${f.file}:${f.line}\``);
  }
  const paused = state.pauses.filter((p) => p.endedAt !== null);
  if (paused.length)
    out.push(
      `Pauses pour la discussion : ${paused.length} (${seconds(paused.reduce((t, p) => t + (p.endedAt! - p.startedAt), 0))}).`,
    );
  out.push('### Et maintenant');
  out.push(
    'Ta copie de travail n’a pas été touchée. Tu peux garder la branche, revenir à un point de reprise ou jeter la tâche. Appliquer à ta copie arrivera dans une prochaine version.',
  );
  return out.join('\n\n');
}

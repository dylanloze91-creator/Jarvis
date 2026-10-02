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

/**
 * Rapport de fin de tâche : ce qui a changé, les preuves, et ce qui reste à
 * décider. Chaque bloc est séparé par une ligne vide ; un tableau ou une
 * liste reste d'un seul tenant (sinon le Markdown ne les reconnaît pas).
 */
export function buildTaskReport(
  state: CodeTaskState,
  verdict: NonNullable<CodeTaskState['report']>['verdict'],
  reason?: string,
): string {
  const blocks: string[] = [];
  const add = (...lines: string[]) => {
    if (lines.length) blocks.push(lines.join('\n'));
  };
  add(`## Tâche : ${state.request}`);
  add(`**Verdict :** ${VERDICT[verdict]}${reason ? ` ${reason}` : ''}`);
  add(
    `Branche \`${state.branch}\` · copie isolée \`${state.worktreePath || '—'}\` · modèle \`${state.model}\`${state.finishedAt ? ` · ${seconds(state.finishedAt - state.startedAt)}` : ''}`,
  );
  add('### Fichiers modifiés');
  if (state.diff.length === 0) add('Aucun.');
  add(
    ...state.diff.map((file) => {
      const planned = state.plan?.files.find(
        (f) => f.path.toLowerCase() === file.path.toLowerCase(),
      );
      const tags = [planned?.core ? 'cœur' : null, planned ? null : 'hors plan'].filter(Boolean);
      return `- \`${file.path}\` (+${file.additions} −${file.deletions})${tags.length ? ` — ${tags.join(', ')}` : ''}`;
    }),
  );
  add('### Tests');
  if (state.baseline) {
    add(
      `| Série | ${state.baseline.map((r) => r.suite).join(' | ')} | Nouveaux échecs |`,
      `| --- | ${state.baseline.map(() => '---').join(' | ')} | --- |`,
      `| Référence (avant) | ${state.baseline.map((r) => r.summary).join(' | ')} | — |`,
      ...state.runs.map(
        (run) =>
          `| ${run.label} | ${run.results.map((r) => r.summary).join(' | ')} | ${run.ok ? 'aucun' : run.newFailures.length} |`,
      ),
    );
    const last = state.runs[state.runs.length - 1];
    if (last && !last.ok) {
      add('Échecs restants :');
      add(...last.newFailures.slice(0, 10).map((failure) => `- ${failure.replace(/\|/g, '/')}`));
    }
    if (last?.fixed.length) add(`Échecs d’avant corrigés au passage : ${last.fixed.length}.`);
  } else add('Pas lancés.');
  add(`Corrections : ${state.attempts} sur ${state.maxAttempts} au plus.`);
  if (state.checkpoints.length) {
    add('### Points de reprise');
    add(...state.checkpoints.map((c) => `- \`${c.sha.slice(0, 7)}\` ${c.label}`));
  }
  add('### Confirmations');
  add(
    `${state.planApproved.length} action(s) couvertes par ta validation du plan, ${state.asked} confirmation(s) demandée(s).`,
  );
  if (state.findings.length) {
    add('Revue du diff avant les tests (autorisée par toi) :');
    add(
      ...state.findings
        .slice(0, 10)
        .map((f) => `- ${SCAN_LABELS[f.category]} : \`${f.file}:${f.line}\``),
    );
  }
  const paused = state.pauses.filter((p) => p.endedAt !== null);
  if (paused.length)
    add(
      `Pauses pour la discussion : ${paused.length} (${seconds(paused.reduce((t, p) => t + (p.endedAt! - p.startedAt), 0))}).`,
    );
  add('### Et maintenant');
  add(
    'Ta copie de travail n’a pas été touchée. Tu peux garder la branche, revenir à un point de reprise ou jeter la tâche. Appliquer à ta copie arrivera dans une prochaine version.',
  );
  return blocks.join('\n\n');
}

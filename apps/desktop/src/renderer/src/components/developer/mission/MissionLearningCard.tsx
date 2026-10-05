import type { MissionLearning } from '@jarvis/core';

export function MissionLearningCard({ learning }: { learning: MissionLearning }) {
  if (learning.saved) {
    return (
      <p
        className="rounded-lg border border-emerald-400/20 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-100"
        data-mission-learning="saved"
      >
        Solution validée enregistrée dans le manuel local
        {learning.fixId ? ` (fiche ${learning.fixId})` : ''}. Les prochaines missions pourront
        retrouver ce correctif par recherche, sans réécrire tout le manuel.
      </p>
    );
  }
  return (
    <p
      className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-slate-400"
      data-mission-learning="skipped"
    >
      Aucune fiche mémorisée{learning.reason ? ` : ${learning.reason}` : ''}.
    </p>
  );
}

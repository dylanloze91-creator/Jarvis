import { EVIDENCE_STATUS_LABELS, type MissionEvidence } from '@jarvis/core';

const STAGING: Record<MissionEvidence['staging']['validationStatus'], string> = {
  candidate: 'Candidate',
  accepted: 'Acceptée',
  rejected: 'Rejetée',
};

/**
 * Preuve d’une mission. Une candidate reste hors du jeu final tant qu’elle n’est pas acceptée.
 */
export function EvidenceCard({ evidence }: { evidence: MissionEvidence }) {
  const missing = evidence.checksNotRun;
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-xs text-slate-300"
      data-mission-evidence={evidence.status}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-100">{EVIDENCE_STATUS_LABELS[evidence.status]}</span>
        <span className="text-slate-500" data-evidence-staging={evidence.staging.validationStatus}>
          Jeu : {STAGING[evidence.staging.validationStatus]}
        </span>
        <span className="text-slate-500" data-evidence-skill={evidence.skill.action}>
          Compétence : {evidence.skill.action}
        </span>
      </header>
      <p>{evidence.statusReason}</p>
      {missing.length ? (
        <p data-evidence-missing>
          Preuves manquantes : {missing.join(' · ')}
        </p>
      ) : null}
      <p data-evidence-reason>{evidence.staging.reason}</p>
      <p className="text-slate-500">{evidence.skill.reason}</p>
      {evidence.commands.length ? (
        <ul className="flex flex-col gap-0.5 font-mono text-[11px] text-slate-400">
          {evidence.commands.map((command) => (
            <li key={`${command.command}-${command.exitCode ?? 'absent'}`}>
              {command.command} · {command.exitCode === null ? 'non lancé' : `exit ${command.exitCode}`}
            </li>
          ))}
        </ul>
      ) : null}
      <details>
        <summary className="cursor-pointer text-slate-200">Inspecter la preuve avant le jeu final</summary>
        <p className="mt-1 text-slate-500">
          Cette ligne n’entre pas dans l’export tant que son statut n’est pas « acceptée ». Un rejet
          ou une candidate reste hors du jeu.
        </p>
        {evidence.finalResult ? <p className="mt-1">{evidence.finalResult}</p> : null}
        {evidence.diff ? (
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-slate-400">
            {evidence.diff.slice(0, 1_200)}
          </pre>
        ) : null}
      </details>
    </section>
  );
}

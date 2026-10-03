import { CheckCircle2, CircleSlash, ExternalLink, Rocket } from 'lucide-react';
import { EVIDENCE_LABELS, PROPOSAL_LABELS, type MissionState } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DeveloperApi, DeveloperState } from '../../../../../shared/developerIpc';

type Act = (action: (api: DeveloperApi) => Promise<DeveloperState | void>) => void;

/**
 * Propositions d'une mission « Améliorer » (0.5.5) : chaque preuve relue par
 * Jarvis ; seules les propositions retenues deviennent des missions, sur ta demande.
 */
export function ProposalList({
  mission,
  busy,
  act,
}: {
  mission: MissionState;
  busy: boolean;
  act: Act;
}) {
  const proposals = mission.proposals ?? [];
  if (!proposals.length) return null;
  return (
    <section className="flex flex-col gap-2" data-proposals>
      <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
        Propositions ({proposals.filter((p) => p.retained).length} retenue(s) sur {proposals.length}
        )
      </p>
      <ul className="flex flex-col gap-1.5">
        {proposals.map((proposal, index) => (
          <li
            key={`${index}-${proposal.title}`}
            className={cn(
              'flex flex-col gap-1 rounded-lg border px-3 py-2',
              proposal.retained
                ? 'border-emerald-400/20 bg-emerald-400/[0.04]'
                : 'border-white/8 bg-black/20 opacity-70',
            )}
            data-proposal={proposal.retained ? 'retained' : 'rejected'}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              {proposal.retained ? (
                <CheckCircle2 className="size-3.5 text-emerald-400" />
              ) : (
                <CircleSlash className="size-3.5 text-slate-500" />
              )}
              <span className="font-medium text-slate-100">{proposal.title}</span>
              <span className="text-[11px] text-slate-500">{PROPOSAL_LABELS[proposal.kind]}</span>
              <span
                className={cn(
                  'text-[11px]',
                  proposal.retained ? 'text-emerald-300' : 'text-slate-400',
                )}
              >
                {proposal.retained ? 'retenue' : 'avis non retenu'}
              </span>
              <span className="ml-auto">
                {proposal.missionId ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      act((api) => api.openMission(proposal.missionId!, mission.projectId))
                    }
                  >
                    <ExternalLink className="size-3.5" /> Mission liée
                  </Button>
                ) : proposal.retained ? (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      act((api) => api.startProposal(mission.id, index, mission.projectId))
                    }
                  >
                    <Rocket className="size-3.5" /> En faire une mission
                  </Button>
                ) : null}
              </span>
            </div>
            <ul className="flex flex-col gap-0.5 pl-5 text-[11px] text-slate-400">
              {proposal.evidence.map((e, i) => (
                <li key={i}>
                  <span
                    className={
                      e.status === 'verified' || e.status === 'metric'
                        ? 'text-emerald-300'
                        : 'text-rose-200'
                    }
                  >
                    {EVIDENCE_LABELS[e.status]}
                  </span>{' '}
                  —{' '}
                  <span className="font-mono">
                    {e.metric ?? `${e.path ?? '?'} : « ${(e.excerpt ?? '').slice(0, 120)} »`}
                  </span>
                </li>
              ))}
              {proposal.evidence.length === 0 ? <li>aucune preuve donnée</li> : null}
            </ul>
            {proposal.gain || proposal.risk ? (
              <p className="pl-5 text-[11px] text-slate-400">
                {proposal.gain ? `Gain : ${proposal.gain}` : ''}
                {proposal.gain && proposal.risk ? ' · ' : ''}
                {proposal.risk ? `Risque : ${proposal.risk}` : ''}
              </p>
            ) : null}
            {proposal.proofTests.length ? (
              <p className="pl-5 text-[11px] text-slate-500">
                Tests de preuve : {proposal.proofTests.join(' ; ')}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

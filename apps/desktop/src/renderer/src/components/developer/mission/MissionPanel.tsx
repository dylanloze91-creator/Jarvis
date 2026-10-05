import { useEffect, useState, type ReactNode } from 'react';
import { History, Rocket } from 'lucide-react';
import {
  JARVIS_PROJECT_ID,
  MISSION_KINDS,
  MISSION_LABELS,
  NEW_PROJECT_SCOPE,
  ROLE_LABELS,
  SPECIALIST_ROLES,
  resolveRoleModel,
  suggestMissionKind,
  type MissionKind,
  type Settings,
} from '@jarvis/core';
import { Button } from '@/components/ui/button';
import type { DeveloperApi, DeveloperState } from '../../../../../shared/developerIpc';
import { TaskPanel } from '../task/TaskPanel';
import { ProposalList } from './ProposalList';
import { MissionGateCard } from './MissionGateCard';
import { MissionLearningCard } from './MissionLearningCard';
import { SpecialistRow } from './SpecialistRow';

type Act = (action: (api: DeveloperApi) => Promise<DeveloperState | void>) => void;

const STATUS: Record<string, string> = {
  running: 'En cours',
  'waiting-answers': 'Attend tes réponses',
  task: 'Boucle de modification',
  finished: 'Terminée',
  failed: 'Pas réussie',
  cancelled: 'Annulée',
};

/**
 * Onglet « Missions » : une demande, un type (proposé, jamais imposé), les
 * questions éventuelles, puis une ligne par spécialiste et la boucle de
 * modification habituelle (plan à valider, diffs, tests, rapport).
 */
export function MissionPanel({
  state,
  act,
  settings,
  onOpenModelTab,
  timeline,
}: {
  state: DeveloperState;
  act: Act;
  settings: Settings | null;
  onOpenModelTab: () => void;
  timeline: ReactNode;
}) {
  const [request, setRequest] = useState('');
  const [kind, setKind] = useState<MissionKind>('modify');
  const [kindTouched, setKindTouched] = useState(false);
  const [skipQuestions, setSkipQuestions] = useState(false);
  const [projectId, setProjectId] = useState(JARVIS_PROJECT_ID);
  const mission = state.mission;
  const [answers, setAnswers] = useState<string[]>([]);
  const creates = kind === 'new-project' || kind === 'skill';
  const scope = creates ? NEW_PROJECT_SCOPE : projectId;
  useEffect(() => {
    if (state.projects === null) act((api) => api.listProjects());
  }, []);
  useEffect(() => {
    act((api) => api.listMissions(scope));
  }, [scope]);
  useEffect(() => setAnswers([]), [mission?.id]);
  const developer = settings?.developer ?? { codeModel: '' };
  const active = mission && (mission.status === 'running' || mission.status === 'task');
  const project = state.projects?.find((p) => p.id === projectId);
  const repoReady = creates
    ? true
    : projectId === JARVIS_PROJECT_ID
      ? (state.repo?.ok ?? Boolean(state.repoPath))
      : (project?.ok ?? false);
  const models = SPECIALIST_ROLES.map(
    (role) => `${ROLE_LABELS[role]} → ${resolveRoleModel(role, developer) ?? 'aucun'}`,
  );
  return (
    <div className="flex flex-col gap-3" data-mission-panel>
      {!active ? (
        <section className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="dev-mission-request" className="text-[13px] font-medium text-slate-100">
              {kind === 'skill'
                ? `Nouvelle compétence (projet à part, hors du chat), dans ${state.projectsRoot || '—'}`
                : creates
                  ? `Nouveau projet, dans ${state.projectsRoot || '—'}`
                  : `Nouvelle mission sur ${project?.name ?? 'Jarvis'}`}
            </label>
            {!creates && (state.projects?.length ?? 0) > 1 ? (
              <select
                className="no-drag rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-slate-200"
                value={projectId}
                aria-label="Projet de la mission"
                onChange={(event) => setProjectId(event.target.value)}
              >
                {state.projects!.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.ok ? '' : ' (à vérifier)'}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <textarea
            id="dev-mission-request"
            className="no-drag min-h-20 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/40"
            placeholder="Ajoute un réglage pour… / Corrige… / Où est… ? / Crée une petite CLI qui…"
            value={request}
            maxLength={2000}
            onChange={(event) => {
              setRequest(event.target.value);
              if (!kindTouched) setKind(suggestMissionKind(event.target.value));
            }}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <select
              className="no-drag rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs"
              value={kind}
              aria-label="Type de mission"
              onChange={(event) => {
                setKind(event.target.value as MissionKind);
                setKindTouched(true);
              }}
            >
              {MISSION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {MISSION_LABELS[k]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                className="accent-cyan-300"
                checked={skipQuestions}
                onChange={(event) => setSkipQuestions(event.target.checked)}
              />
              Sans questions
            </label>
            <Button
              size="sm"
              disabled={
                state.busy || !repoReady || request.trim().length < (kind === 'question' ? 4 : 8)
              }
              onClick={() =>
                act((api) =>
                  api.startMission(kind, request, skipQuestions, creates ? undefined : projectId),
                )
              }
            >
              <Rocket className="size-3.5" /> Lancer la mission
            </Button>
          </div>
          <p className="text-[11px] leading-snug text-slate-500">
            Modèles : {models.join(' · ')}.{' '}
            <button type="button" className="no-drag underline" onClick={onOpenModelTab}>
              Changer (onglet Modèle de code)
            </button>
            .{' '}
            {creates
              ? 'Le dossier n’est créé qu’après ta confirmation ; ensuite, le plan de modification attend ta validation.'
              : kind === 'improve'
                ? 'Rien n’est modifié : des propositions dont chaque preuve est relue ; tu choisis celles qui deviennent des missions.'
                : 'Rien n’est écrit avant ta validation du plan ; ta copie ne change qu’avec « Appliquer », après ta confirmation.'}
          </p>
        </section>
      ) : null}
      {!active && state.missionGate ? (
        <MissionGateCard
          gate={state.missionGate}
          busy={state.busy}
          onEdit={setRequest}
          onLaunch={(text) =>
            act((api) =>
              api.startMission(
                state.missionGate!.kind,
                text,
                skipQuestions,
                creates ? undefined : projectId,
              ),
            )
          }
        />
      ) : null}

      {mission ? (
        <section className="flex flex-col gap-2" data-mission-status={mission.status}>
          <header className="flex flex-wrap items-center gap-x-3 text-xs">
            <span className="font-medium text-slate-100">
              {MISSION_LABELS[mission.kind]} · {STATUS[mission.status] ?? mission.status}
            </span>
            <span className="text-[11px] text-slate-400">« {mission.request} »</span>
          </header>
          {mission.gate ? (
            <p className="text-[11px] text-slate-400" data-mission-difficulty>
              {mission.gate.message}
            </p>
          ) : null}
          {mission.goal ? (
            <p className="text-[11px] text-slate-300">
              Objectif : {mission.goal.goal}
              {mission.goal.criteria.length
                ? ` · Critères : ${mission.goal.criteria.join(' ; ')}`
                : ''}
            </p>
          ) : null}
          {mission.status === 'waiting-answers' && mission.goal ? (
            <div className="flex flex-col gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3.5 py-3">
              {mission.goal.questions.map((question, index) => (
                <label key={question} className="flex flex-col gap-1 text-xs text-amber-100">
                  {question}
                  <input
                    className="no-drag rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[13px] text-slate-100"
                    value={answers[index] ?? ''}
                    onChange={(event) => {
                      const next = [...answers];
                      next[index] = event.target.value;
                      setAnswers(next);
                    }}
                  />
                </label>
              ))}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={state.busy}
                  onClick={() => act((api) => api.answerMission(answers))}
                >
                  Répondre et continuer
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={state.busy}
                  onClick={() => act((api) => api.answerMission([]))}
                >
                  Continuer sans répondre
                </Button>
              </div>
            </div>
          ) : null}
          <ul className="flex flex-col gap-1.5">
            {mission.steps.map((step) => (
              <SpecialistRow key={step.id} step={step} />
            ))}
          </ul>
          {mission.summary ? <p className="text-xs text-slate-200">{mission.summary}</p> : null}
          {mission.learning ? <MissionLearningCard learning={mission.learning} /> : null}
          <ProposalList mission={mission} busy={state.busy} act={act} />
        </section>
      ) : null}

      {mission?.taskId || mission?.status === 'task' ? (
        <TaskPanel
          state={state}
          act={act}
          codeModel={developer.codeModel}
          onOpenModelTab={onOpenModelTab}
          timeline={timeline}
          showRequest={false}
        />
      ) : (
        timeline
      )}

      {state.missions?.length ? (
        <section className="flex flex-col gap-1 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-100">
            <History className="size-4" /> Missions précédentes
          </span>
          <ul className="flex flex-col gap-1">
            {state.missions.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-[11px] text-slate-300">
                <span className="font-mono text-slate-500">
                  {new Date(m.createdAt).toLocaleString('fr-FR')}
                </span>
                <span>{MISSION_LABELS[m.kind]}</span>
                <span className="truncate text-slate-400">« {m.request} »</span>
                <span className="text-slate-500">{STATUS[m.status] ?? m.status}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={state.busy}
                  onClick={() => act((api) => api.openMission(m.id, state.missionsProject))}
                >
                  Ouvrir
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

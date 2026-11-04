import { useEffect, useState } from 'react';
import {
  DIFFICULTY_LABELS,
  JARVIS_PROJECT_ID,
  MISSION_LABELS,
  type ChatMissionProposalPayload,
  type MissionKind,
} from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { MissionGateCard } from '@/components/developer/mission/MissionGateCard';

export function ChatMissionProposalCard({
  data,
  busy,
  onLaunch,
  onModify,
  onDecline,
  onProjectChange,
}: {
  data: ChatMissionProposalPayload;
  busy: boolean;
  onLaunch: (projectId: string, request: string) => void;
  onModify: (objectif: string) => void;
  onDecline: () => void;
  onProjectChange: (projectId: string) => void;
}) {
  const [projectId, setProjectId] = useState<string | null>(data.projectId);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    void window.jarvis.developer.listProjects().then((state) => {
      const list = state.projects ?? [];
      setProjects(list.map((p) => ({ id: p.id, name: p.name })));
    });
  }, []);

  useEffect(() => {
    setProjectId(data.projectId);
  }, [data.projectId]);

  if (data.status === 'declined') {
    return (
      <p className="text-[12px] text-slate-400" data-chat-mission="declined">
        Mission refusée.
      </p>
    );
  }
  if (data.status === 'launched') {
    return null;
  }

  const kindLabel = MISSION_LABELS[data.kind as MissionKind] ?? data.missionType;
  const selected = projectId ?? '';

  const pick = (id: string): void => {
    setProjectId(id);
    onProjectChange(id);
  };

  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-cyan-400/25 bg-cyan-950/30 px-3.5 py-3"
      data-chat-mission="proposal"
    >
      <p className="text-[13px] font-medium text-cyan-100">Mission proposée — {kindLabel}</p>
      <p className="text-[13px] text-slate-100">{data.objectif}</p>
      <p className="text-[11px] text-slate-400">
        Modèle Codeur :{' '}
        {data.codeModelMissing ? (
          <span className="text-amber-200">non configuré (Réglages → Modèle de code)</span>
        ) : (
          data.codeModel
        )}
      </p>
      <p className="text-[11px] text-slate-400">
        Difficulté : {DIFFICULTY_LABELS[data.gate.difficulty.level]} — {data.gate.message}
      </p>
      {data.blockedMessage ? (
        <p className="text-[12px] text-amber-200">{data.blockedMessage}</p>
      ) : null}
      {!data.gate.ok ? (
        <MissionGateCard
          gate={data.gate}
          busy={busy}
          onLaunch={(request) => selected && onLaunch(selected, request)}
          onEdit={onModify}
        />
      ) : null}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-slate-400">Projet visé (obligatoire) :</span>
        <select
          className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[13px]"
          value={selected}
          onChange={(event) => pick(event.target.value)}
          disabled={busy}
        >
          <option value="">— Choisir —</option>
          <option value={JARVIS_PROJECT_ID}>Jarvis (dépôt principal)</option>
          {projects
            .filter((p) => p.id !== JARVIS_PROJECT_ID)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          <option value="new-project">Nouveau projet</option>
        </select>
        {data.projetHint ? (
          <p className="text-[10px] text-slate-500">Indice du modèle : « {data.projetHint} » (à confirmer).</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || !selected || Boolean(data.blockedMessage) || data.codeModelMissing || !data.gate.ok}
          onClick={() => onLaunch(selected, data.objectif)}
        >
          Lancer
        </Button>
        <Button size="sm" variant="subtle" disabled={busy} onClick={() => onModify(data.objectif)}>
          Modifier l&apos;objectif
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDecline}>
          Non
        </Button>
      </div>
    </section>
  );
}

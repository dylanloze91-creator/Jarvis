import {
  ORCHESTRA_TEAMS,
  SUGGESTED_ORCHESTRA,
  TEAM_SPECS,
  type ModelPlace,
  type OrchestraTeam,
  type Settings,
} from '@jarvis/core';
import { Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Select, Toggle } from '@/components/ui/field';

type Orchestra = NonNullable<Settings['orchestra']>;

interface OrchestraSettingsProps {
  baseUrl: string;
  /** Modèle du chat, cerveau par défaut si la proposition n'est pas installée. */
  chatModel: string;
  value: Settings['orchestra'];
  onChange: (value: Orchestra) => void;
  /** Vrai quand l'onglet Modèle IA est ouvert : la liste des modèles est relue. */
  active?: boolean;
}

/**
 * 5.0.60 — chef d'orchestre. Le cerveau choisit l'équipe de chaque demande ; chaque équipe
 * a son modèle et ses seuls outils. Seuls les modèles installés sont proposés.
 */
export function OrchestraSettingsSection({ baseUrl, chatModel, value, onChange, active = true }: OrchestraSettingsProps) {
  const [installed, setInstalled] = useState<string[]>([]);

  useEffect(() => {
    if (!active) return;
    void window.jarvis.settings
      .ollamaStatus(baseUrl)
      .then((status) => setInstalled(status.models.map((model) => model.name)))
      .catch(() => setInstalled([]));
  }, [baseUrl, active]);

  const suggestion = (): Orchestra => {
    const has = (model: string) => installed.length === 0 || installed.includes(model);
    const brain = has(SUGGESTED_ORCHESTRA.brain) ? SUGGESTED_ORCHESTRA.brain : chatModel;
    const teams: Orchestra['teams'] = {};
    for (const team of ORCHESTRA_TEAMS) {
      const assignment = SUGGESTED_ORCHESTRA.teams[team];
      if (assignment && has(assignment.model)) teams[team] = { ...assignment };
    }
    return { enabled: value?.enabled ?? true, brain, teams };
  };

  const current: Orchestra = value ?? { enabled: false, brain: '', teams: {} };
  const enable = (enabled: boolean): void => {
    onChange(value?.brain ? { ...current, enabled } : { ...suggestion(), enabled });
  };
  const setTeam = (team: OrchestraTeam, model: string, place: ModelPlace): void => {
    const teams = { ...(current.teams ?? {}) };
    if (model) teams[team] = { model, place };
    else delete teams[team];
    onChange({ ...current, teams });
  };
  const missing = (model: string) => installed.length > 0 && model !== '' && !installed.includes(model);
  const options = [...new Set([...installed, current.brain, ...Object.values(current.teams ?? {}).map((t) => t.model)])]
    .filter(Boolean)
    .sort();

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <Toggle
        label="Chef d’orchestre"
        hint="Le cerveau lit chaque demande et la confie à une équipe : chaque équipe a son modèle et seulement ses outils. Les calculs sont faits par Jarvis lui-même, sans modèle. Coupé : Jarvis répond comme avant."
        checked={current.enabled}
        onChange={enable}
      />
      {current.enabled ? (
        <>
          <Field
            label="Cerveau (choisit l’équipe, garde la carte graphique)"
            hint="Un 7B est conseillé : assez fin pour bien trier, assez léger pour rester chargé."
          >
            <Select value={current.brain} onChange={(event) => onChange({ ...current, brain: event.target.value })}>
              {options.map((model) => (
                <option key={model} value={model}>
                  {model}
                  {missing(model) ? ' (non installé)' : ''}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Équipes</span>
              <Button size="sm" variant="ghost" onClick={() => onChange(suggestion())}>
                <Wand2 className="size-3.5" />
                Proposition pour ce PC
              </Button>
            </div>
            {ORCHESTRA_TEAMS.map((team) => {
              const assignment = current.teams?.[team];
              return (
                <div key={team} className="grid grid-cols-[1fr_1.4fr_0.9fr] items-center gap-2">
                  <span className="text-sm text-slate-200" title={TEAM_SPECS[team].description}>
                    {TEAM_SPECS[team].label}
                  </span>
                  <Select
                    value={assignment?.model ?? ''}
                    onChange={(event) => setTeam(team, event.target.value, assignment?.place ?? 'processeur')}
                  >
                    <option value="">Le cerveau</option>
                    {options.map((model) => (
                      <option key={model} value={model}>
                        {model}
                        {missing(model) ? ' (non installé)' : ''}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={assignment ? assignment.place : 'carte'}
                    disabled={!assignment}
                    onChange={(event) => assignment && setTeam(team, assignment.model, event.target.value as ModelPlace)}
                  >
                    <option value="carte">Carte graphique</option>
                    <option value="processeur">Processeur</option>
                  </Select>
                </div>
              );
            })}
            <p className="text-xs leading-snug text-slate-500">
              « Processeur » laisse la carte au cerveau : pas de rechargement entre deux demandes, mais une
              réponse plus lente pour les gros modèles. N’oublie pas d’enregistrer.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

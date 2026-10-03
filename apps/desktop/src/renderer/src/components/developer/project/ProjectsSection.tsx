import { useEffect, useState } from 'react';
import { FolderInput, FolderKanban, Hammer, NotebookPen, Trash2 } from 'lucide-react';
import { PROJECT_TEMPLATES } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import type { DeveloperApi, DeveloperState, ProjectView } from '../../../../../shared/developerIpc';
import { CheckList } from '../parts';

type Act = (action: (api: DeveloperApi) => Promise<DeveloperState | void>) => void;

const ORIGIN: Record<ProjectView['origin'], string> = {
  jarvis: 'Jarvis',
  imported: 'importé',
  created: 'créé par Jarvis',
};

function ProjectRow({
  project,
  state,
  act,
}: {
  project: ProjectView;
  state: DeveloperState;
  act: Act;
}) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(project.memory);
  useEffect(() => setNotes(project.memory), [project.memory]);
  const failing = project.checks.filter((c) => c.status !== 'ok');
  return (
    <li
      className="flex flex-col gap-1.5 rounded-lg border border-white/8 bg-black/20 px-3 py-2"
      data-project={project.id}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-medium text-slate-100">{project.name}</span>
        <span className="text-[11px] text-slate-500">
          {project.template === 'node-skill'
            ? 'Compétence, hors du chat · '
            : project.kind === 'dotnet'
              ? '.NET · '
              : project.kind === 'node'
                ? 'Node · '
                : ''}
          {ORIGIN[project.origin]}
          {project.template ? ` · ${PROJECT_TEMPLATES[project.template].label}` : ''}
        </span>
        <span
          className={project.ok ? 'text-[11px] text-emerald-300' : 'text-[11px] text-amber-200'}
        >
          {project.ok ? 'prêt' : 'à vérifier'}
        </span>
        <span className="ml-auto flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
            <NotebookPen className="size-3.5" /> Mémoire
          </Button>
          {project.build ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={state.busy || !project.ok}
              title={project.build.command}
              onClick={() => act((api) => api.buildProject(project.id))}
            >
              <Hammer className="size-3.5" />{' '}
              {project.kind === 'jarvis' ? 'Construire l’installateur' : 'Construire'}
            </Button>
          ) : null}
          {project.kind !== 'jarvis' ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={state.busy}
              onClick={() => act((api) => api.forgetProject(project.id))}
            >
              <Trash2 className="size-3.5" /> Retirer de la liste
            </Button>
          ) : null}
        </span>
      </div>
      <p className="font-mono text-[11px] break-all text-slate-400">{project.path || '—'}</p>
      {project.description ? (
        <p className="text-[11px] text-slate-400">{project.description}</p>
      ) : null}
      {project.build?.artifact ? (
        <p className="text-[11px] text-slate-500">
          « Construire » produit {project.build.artifact} dans ta copie ; rien n’est publié.
        </p>
      ) : null}
      {failing.length ? <CheckList checks={failing} /> : null}
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`memory-${project.id}`} className="text-[11px] text-slate-400">
            Mémoire du projet, donnée aux spécialistes de chaque mission (4 000 caractères au plus).
            Gardée dans les données de Jarvis, jamais dans le dépôt.
            {project.memoryDefault && project.kind === 'jarvis' ? ' Texte proposé par défaut.' : ''}
          </label>
          <textarea
            id={`memory-${project.id}`}
            className="no-drag min-h-24 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-slate-100 outline-none focus:border-cyan-300/40"
            maxLength={4000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          <div>
            <Button
              size="sm"
              disabled={state.busy}
              onClick={() => act((api) => api.saveProjectMemory(project.id, notes))}
            >
              Enregistrer la mémoire
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** Projets de Jarvis Développeur (0.5.3) : Jarvis, les projets importés et ceux créés depuis un gabarit. */
export function ProjectsSection({ state, act }: { state: DeveloperState; act: Act }) {
  const [path, setPath] = useState('');
  useEffect(() => {
    if (state.projects === null) act((api) => api.listProjects());
  }, []);
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3"
      data-projects
    >
      <div className="flex items-center gap-2 text-[13px] font-medium text-slate-100">
        <FolderKanban className="size-4" /> Projets
      </div>
      <p className="text-[11px] leading-snug text-slate-400">
        Les nouveaux projets sont créés dans {state.projectsRoot || '—'} (mission « Nouveau projet
        », onglet Missions). Chaque projet a sa mémoire, ses missions et ses copies isolées ; rien
        de Jarvis n’est écrit dans leurs dépôts.
      </p>
      {state.dotnet ? (
        <p className="text-[11px] leading-snug text-slate-400" data-dotnet-sdk>
          {state.dotnet.sdks.length ? (
            <>SDK .NET : {state.dotnet.sdks.join(', ')} (applis Windows WinForms, WPF, services).</>
          ) : (
            <>
              SDK .NET absent : nécessaire seulement pour les applis Windows. À installer toi-même
              {state.dotnet.hint ? (
                <>
                  {' '}
                  : <code className="font-mono text-slate-300">{state.dotnet.hint}</code>
                </>
              ) : null}
              . Jarvis ne l’installe jamais.
            </>
          )}
        </p>
      ) : null}
      {state.projects === null ? (
        <p className="text-xs text-slate-500">Lecture des projets…</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {state.projects.map((project) => (
            <ProjectRow key={project.id} project={project} state={state} act={act} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="no-drag min-w-64 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 font-mono text-[12px] text-slate-100"
          placeholder="Chemin complet d’un projet Node ou .NET existant (dépôt git)"
          aria-label="Dossier du projet à importer"
          value={path}
          maxLength={400}
          onChange={(event) => setPath(event.target.value)}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={state.busy || path.trim().length < 3}
          onClick={() => act((api) => api.importProject(path))}
        >
          <FolderInput className="size-3.5" /> Importer ce dossier
        </Button>
      </div>
    </section>
  );
}

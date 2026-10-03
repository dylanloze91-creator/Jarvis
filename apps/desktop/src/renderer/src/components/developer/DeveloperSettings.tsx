import { useEffect, useState } from 'react';
import { codeModelById, type DeveloperSettings } from '@jarvis/core';
import {
  Download,
  FolderSearch,
  HardDrive,
  Loader2,
  PackageOpen,
  ShieldOff,
  Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Toggle } from '@/components/ui/field';
import { useDeveloper } from '@/hooks/useDeveloper';
import { CommandTester } from './CommandTester';
import { DeveloperConfirmationCard } from './DeveloperConfirmationCard';
import { CheckList, SectionTitle, StepTimeline } from './parts';

interface Props {
  developer: DeveloperSettings;
  /** Enregistre tout de suite (comme le choix du micro) : les actions en dépendent. */
  onSave: (next: DeveloperSettings) => void;
}

export function DeveloperSettingsSection({ developer, onSave }: Props) {
  const { state, error, act } = useDeveloper(developer.enabled);
  const [path, setPath] = useState(developer.repoPath);
  const [worktreeRoot, setWorktreeRoot] = useState(developer.worktreeRoot);
  useEffect(() => {
    if (state && !path) setPath(state.repoPath || state.suggestedPath);
  }, [state, path]);
  useEffect(() => {
    if (state?.repo?.ok && state.repoPath && state.repoPath !== developer.repoPath)
      onSave({ ...developer, repoPath: state.repoPath });
  }, [state?.repo?.ok, state?.repoPath, developer, onSave]);

  const busy = state?.busy ?? false;
  const folderMissing =
    state?.repo?.checks.some((check) => check.id === 'folder' && check.status === 'fail') ?? false;
  return (
    <div className="flex flex-col gap-4" data-developer-settings>
      <p className="text-xs leading-snug text-slate-400">
        Jarvis Développeur travaille sur le code de Jarvis et sur tes projets, dans des copies
        isolées sur ton PC : questions, missions, modifications testées, toujours avec ta
        validation. Coupé, rien ne change : discussion, voix, Spotify, Google et recherche restent
        identiques.
      </p>
      <Toggle
        label="Activer Jarvis Développeur"
        hint="Désactivé par défaut. Ajoute l’entrée « Développeur » au tableau de bord."
        checked={developer.enabled}
        onChange={(enabled) => onSave({ ...developer, enabled })}
      />

      {developer.enabled && state ? (
        <>
          <div className="flex flex-col gap-2">
            <SectionTitle>Copie de travail</SectionTitle>
            <Field label="Dossier" hint={`Conseillé : ${state.suggestedPath}, hors de OneDrive.`}>
              <Input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                spellCheck={false}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => act((api) => api.detect())}>
                <FolderSearch className="size-3.5" /> Détecter
              </Button>
              <Button
                size="sm"
                disabled={busy || !path.trim()}
                onClick={() => act((api) => api.validate(path))}
              >
                Vérifier ce dossier
              </Button>
            </div>
            {state.repo ? <CheckList checks={state.repo.checks} /> : null}
          </div>

          <div className="flex flex-col gap-2">
            <SectionTitle>Environnement</SectionTitle>
            <div>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => act((api) => api.checkEnvironment())}
              >
                <HardDrive className="size-3.5" /> Vérifier Git, Node et le disque
              </Button>
            </div>
            {state.environment ? <CheckList checks={state.environment.checks} /> : null}
          </div>

          <div className="flex flex-col gap-2">
            <SectionTitle>Préparer</SectionTitle>
            <p className="text-xs leading-snug text-slate-500">
              Chaque action affiche une carte avec la commande exacte et attend ton accord. Git et
              Node, c’est toi qui les installes.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={
                  busy || (state.repo?.ok ?? false) || (!folderMissing && state.repo !== null)
                }
                onClick={() => act((api) => api.clone(path))}
              >
                <Download className="size-3.5" /> Cloner le code dans {path || state.suggestedPath}
              </Button>
              <Button
                size="sm"
                disabled={busy || !state.repo?.ok}
                onClick={() => act((api) => api.install())}
              >
                <PackageOpen className="size-3.5" /> Installer les dépendances (npm ci)
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1" data-developer-code-model>
            <SectionTitle>Modèle de code</SectionTitle>
            <p className="text-xs leading-snug text-slate-400">
              {developer.codeModel
                ? `Choisi : ${codeModelById(developer.codeModel)?.label ?? developer.codeModel}.`
                : 'Pas encore choisi.'}{' '}
              Matériel, estimations, téléchargement confirmé et banc : tableau de bord → Développeur
              → onglet « Modèle de code ».
            </p>
          </div>

          <div className="flex flex-col gap-2" data-developer-worktrees>
            <SectionTitle>Copies isolées des tâches</SectionTitle>
            <Field
              label="Dossier"
              hint="Une copie par tâche (environ 1,1 Go avec ses dépendances), sur une branche jarvis-dev/*. Ta copie de travail ne change qu’avec « Appliquer », après ta confirmation."
            >
              <Input
                value={worktreeRoot}
                placeholder={state.worktreeRoot}
                onChange={(event) => setWorktreeRoot(event.target.value)}
                onBlur={() => {
                  if (worktreeRoot.trim() !== developer.worktreeRoot)
                    onSave({ ...developer, worktreeRoot: worktreeRoot.trim() });
                }}
                spellCheck={false}
              />
            </Field>
          </div>

          {state.confirmation ? (
            <DeveloperConfirmationCard
              confirmation={state.confirmation}
              onRespond={(id, ok) => act((api) => api.respondConfirmation(id, ok))}
            />
          ) : null}
          {state.task && state.task.kind !== 'analyze' ? (
            <div className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
              <div className="flex items-center gap-2 text-[13px] text-slate-200">
                {busy ? <Loader2 className="size-3.5 animate-spin text-cyan-300" /> : null}
                {state.task.title}
                {busy ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => act((api) => api.cancel())}
                  >
                    <Square className="size-3" /> Annuler
                  </Button>
                ) : null}
              </div>
              <StepTimeline steps={state.task.steps} />
              {state.task.log.length ? (
                <pre className="max-h-32 overflow-auto rounded bg-black/40 p-2 font-mono text-[10px] text-slate-400">
                  {state.task.log.slice(-8).join('\n')}
                </pre>
              ) : null}
              {state.task.message ? (
                <p className="text-xs text-slate-300">{state.task.message}</p>
              ) : null}
            </div>
          ) : null}
          {state.notice ? <p className="text-xs leading-snug text-accent">{state.notice}</p> : null}
          {error ? (
            <p role="alert" className="text-xs text-rose-200">
              {error}
            </p>
          ) : null}
        </>
      ) : null}

      <CommandTester />

      <div className="flex items-start gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
        <ShieldOff className="mt-0.5 size-3.5 shrink-0 text-slate-500" />
        <p className="text-xs leading-snug text-slate-500">
          Jamais : publier sur GitHub (git push, npm publish, package:win:publish), supprimer en
          masse, toucher au système ou aux secrets, télécharger un modèle sans ton clic. Les outils
          de lecture ne voient ni .git/, ni node_modules, ni les fichiers de clés.
        </p>
      </div>
    </div>
  );
}

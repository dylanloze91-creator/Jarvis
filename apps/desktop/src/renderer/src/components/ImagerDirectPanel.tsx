import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, Loader2, Square } from 'lucide-react';
import type { ImageFormat, ImageProject } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/field';
import type { ImagerDirectCatalog, ImagerDirectFile, ImagerDirectResult } from '../../../shared/ipc';

/**
 * Panneau « Imager direct » : la consigne part à Forge telle qu'elle est écrite, sans passer
 * par le modèle de langage (ni reformulation, ni règles d'Imager). Le panneau ouvert est signalé
 * au processus principal (`directPanel`) pour l'option « garder Forge chargé ».
 */
interface Draft {
  prompt: string;
  negative: string;
  project: ImageProject;
  checkpoint: string;
  loras: { name: string; weight: number }[];
  format: ImageFormat;
  count: number;
  seed: string;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  faces: boolean;
  hands: boolean;
  keepTxt: boolean;
  /** Imager complète la consigne avec ses règles (sans modèle). */
  improve: boolean;
}

const DEFAULT_PROJECT: ImageProject = 'perso';

function draftFor(catalog: ImagerDirectCatalog, project: ImageProject, previous?: Draft): Draft {
  const defaults = catalog.projects[project];
  return {
    prompt: previous?.prompt ?? '',
    negative: defaults.negative,
    project,
    checkpoint: previous?.checkpoint ?? catalog.checkpoints[0]?.file ?? '',
    loras: previous?.loras ?? [],
    format: defaults.format,
    count: previous?.count ?? 1,
    seed: previous?.seed ?? '-1',
    steps: defaults.steps,
    cfg: defaults.cfg,
    sampler: defaults.sampler,
    scheduler: defaults.scheduler,
    faces: previous?.faces ?? catalog.adetailerInstalled,
    hands: previous?.hands ?? false,
    keepTxt: project === 'perso' ? catalog.keepTxtPerso : true,
    improve: previous?.improve ?? catalog.improve,
  };
}

export function ImagerDirectPanel({ compact = false }: { compact?: boolean }) {
  const [catalog, setCatalog] = useState<ImagerDirectCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ value: number; message: string } | null>(null);
  const [result, setResult] = useState<ImagerDirectResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void window.jarvis.images.directPanel(true);
    void window.jarvis.images
      .directCatalog()
      .then((loaded) => {
        if (!mounted.current) return;
        setCatalog(loaded);
        setDraft((current) => current ?? draftFor(loaded, DEFAULT_PROJECT));
      })
      .catch((reason: unknown) => setLoadError(reason instanceof Error ? reason.message : String(reason)));
    const off = window.jarvis.images.onDirectEvent((event) => {
      if (event.type === 'progress') setProgress({ value: event.value, message: event.message });
      else if (event.type === 'error') setError(event.message);
    });
    return () => {
      mounted.current = false;
      off();
      // Fermeture du panneau : Forge est libéré et le modèle de langage rechargé si l'option le gardait.
      void window.jarvis.images.directPanel(false);
    };
  }, []);

  const update = (patch: Partial<Draft>): void => setDraft((current) => (current ? { ...current, ...patch } : current));

  const setProject = (project: ImageProject): void => {
    if (!catalog || !draft) return;
    setDraft(draftFor(catalog, project, draft));
  };

  const toggleLora = (name: string): void => {
    if (!draft) return;
    const present = draft.loras.find((lora) => lora.name === name);
    update({ loras: present ? draft.loras.filter((lora) => lora.name !== name) : [...draft.loras, { name, weight: 0.8 }] });
  };

  const generate = async (): Promise<void> => {
    if (!draft || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress({ value: 0, message: 'Préparation…' });
    try {
      const outcome = await window.jarvis.images.directGenerate({
        prompt: draft.prompt,
        negative: draft.negative,
        project: draft.project,
        checkpoint: draft.checkpoint,
        loras: draft.loras,
        format: draft.format,
        count: draft.count,
        seed: draft.seed.trim() === '' ? -1 : Number(draft.seed),
        steps: draft.steps,
        cfg: draft.cfg,
        sampler: draft.sampler,
        scheduler: draft.scheduler,
        adetailer: { faces: draft.faces, hands: draft.hands },
        keepTxt: draft.keepTxt,
        improve: draft.improve,
      });
      if (!mounted.current) return;
      if (outcome.ok) setResult(outcome);
      else setError(outcome.error);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mounted.current) {
        setRunning(false);
        setProgress(null);
      }
    }
  };

  const cancel = (): void => {
    void window.jarvis.images.directCancel();
  };

  const formats = useMemo(() => catalog?.formats ?? [], [catalog]);

  if (loadError) return <p className="p-4 text-sm text-rose-300">Imager direct indisponible : {loadError}</p>;
  if (!catalog || !draft) {
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-slate-400">
        <Loader2 className="size-4 animate-spin" /> Lecture des modèles de Forge…
      </p>
    );
  }
  if (!catalog.enabled) {
    return (
      <p className="p-4 text-sm text-slate-300">
        Jarvis Imager est coupé. Active-le dans Réglages → Services → Jarvis Imager, puis reviens ici.
      </p>
    );
  }

  const columns = compact ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3" data-ui-panel="imager-direct">
      <div>
        <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Imager direct</p>
        <p className="mt-1 text-xs leading-snug text-slate-500">
          Ta consigne part à Forge <strong>telle que tu l’écris</strong> : le modèle de langage ne la lit pas, ne la réécrit pas et ne la juge pas.
          Les images vont dans <code>{catalog.outputRoot}\{draft.project}\&lt;date&gt;</code>. Rien ne sort de ce PC.
          Dans la discussion, <code>/image ta consigne</code> fait la même chose avec les réglages du projet perso.
        </p>
      </div>

      <div className={`grid gap-3 ${columns}`}>
        <div className="flex flex-col gap-3">
          <Field label="Consigne (envoyée telle quelle)">
            <Textarea rows={5} value={draft.prompt} placeholder="a red fox in the snow, soft light…" onChange={(event) => update({ prompt: event.target.value })} />
          </Field>
          <Field label="Prompt négatif" hint="Pré-rempli avec les défauts du projet et de l’anatomie. Modifie-le librement.">
            <Textarea rows={3} value={draft.negative} onChange={(event) => update({ negative: event.target.value })} />
          </Field>
          <Toggle
            label="Améliorer mon prompt (règles d’Imager, sans modèle)"
            hint="Imager ajoute ce qui aide Stable Diffusion : traduction en anglais par dictionnaire local, qualité, style du projet, taille native selon le sujet, défauts à éviter. Le contenu de ta demande n’est ni jugé ni filtré. Décoché : la consigne part mot pour mot."
            checked={draft.improve}
            onChange={(checked) => update({ improve: checked })}
          />
          <Field label="Projet de rangement">
            <Select value={draft.project} onChange={(event) => setProject(event.target.value as ImageProject)}>
              {(Object.keys(catalog.projects) as ImageProject[]).map((id) => (
                <option key={id} value={id}>
                  {catalog.projects[id].label} ({id})
                </option>
              ))}
            </Select>
          </Field>
          {draft.project === 'perso' ? (
            <Toggle
              label="Garder le fichier texte du prompt"
              hint="Décoché : seule l’image est enregistrée, sans .txt des réglages (projet perso)."
              checked={draft.keepTxt}
              onChange={(checked) => update({ keepTxt: checked })}
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Modèle" hint="Fichiers présents dans le dossier des modèles de Forge.">
            <Select value={draft.checkpoint} onChange={(event) => update({ checkpoint: event.target.value })}>
              <option value="">Modèle courant de Forge</option>
              {catalog.checkpoints.map((checkpoint) => (
                <option key={checkpoint.file} value={checkpoint.file}>
                  {checkpoint.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="LoRA" hint={catalog.loras.length ? 'Coche ceux à ajouter et règle leur force.' : 'Aucun LoRA dans models\\Lora.'}>
            <div className="flex flex-col gap-1">
              {catalog.loras.map((name) => {
                const chosen = draft.loras.find((lora) => lora.name === name);
                return (
                  <label key={name} className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={Boolean(chosen)} onChange={() => toggleLora(name)} />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    {chosen ? (
                      <input
                        type="number"
                        min={0.1}
                        max={1.5}
                        step={0.1}
                        value={chosen.weight}
                        className="w-16 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-right"
                        onChange={(event) =>
                          update({ loras: draft.loras.map((lora) => (lora.name === name ? { ...lora, weight: Number(event.target.value) } : lora)) })
                        }
                      />
                    ) : null}
                  </label>
                );
              })}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Taille (natives SDXL)">
              <Select value={draft.format} onChange={(event) => update({ format: event.target.value as ImageFormat })}>
                {formats.map((format) => (
                  <option key={format.id} value={format.id}>
                    {format.id} · {format.width}×{format.height}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nombre d’images">
              <Input type="number" min={1} max={4} value={draft.count} onChange={(event) => update({ count: Number(event.target.value) })} />
            </Field>
            <Field label="Graine (-1 = hasard)">
              <Input value={draft.seed} onChange={(event) => update({ seed: event.target.value })} />
            </Field>
            <Field label="Étapes">
              <Input type="number" min={1} max={80} value={draft.steps} onChange={(event) => update({ steps: Number(event.target.value) })} />
            </Field>
            <Field label="CFG">
              <Input type="number" min={1} max={20} step={0.5} value={draft.cfg} onChange={(event) => update({ cfg: Number(event.target.value) })} />
            </Field>
            <Field label="Échantillonneur">
              <Select value={draft.sampler} onChange={(event) => update({ sampler: event.target.value })}>
                {catalog.samplers.map((sampler) => (
                  <option key={sampler} value={sampler}>
                    {sampler}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Planificateur">
              <Select value={draft.scheduler} onChange={(event) => update({ scheduler: event.target.value })}>
                {catalog.schedulers.map((scheduler) => (
                  <option key={scheduler} value={scheduler}>
                    {scheduler}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Toggle
            label="Retoucher les visages (ADetailer)"
            hint={catalog.adetailerInstalled ? 'Seconde passe sur chaque visage.' : 'ADetailer n’est pas installé dans Forge.'}
            checked={draft.faces}
            onChange={(checked) => update({ faces: checked })}
          />
          <Toggle label="Retoucher les mains (ADetailer)" checked={draft.hands} onChange={(checked) => update({ hands: checked })} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void generate()} disabled={running || !draft.prompt.trim()}>
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
          Générer
        </Button>
        {running ? (
          <Button size="sm" variant="subtle" onClick={cancel}>
            <Square className="size-3.5" /> Arrêter
          </Button>
        ) : null}
        {catalog.holdForge ? <span className="text-xs text-slate-500">Forge reste chargé tant que ce panneau est ouvert.</span> : null}
      </div>

      {progress ? (
        <div className="flex flex-col gap-1" aria-live="polite">
          <div className="h-1.5 w-full overflow-hidden rounded bg-white/10">
            <div className="h-full rounded bg-cyan-400 transition-[width]" style={{ width: `${Math.round(Math.min(1, Math.max(0, progress.value)) * 100)}%` }} />
          </div>
          <p className="text-xs text-slate-400">{progress.message}</p>
        </div>
      ) : null}

      {error ? <p className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{error}</p> : null}

      {result?.ok ? <ResultView result={result} /> : null}
    </div>
  );
}

function ResultView({ result }: { result: Extract<ImagerDirectResult, { ok: true }> }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-slate-300">
        {result.files.length > 1 ? `${result.files.length} images` : 'Image'} {result.width}×{result.height} en {Math.round(result.durationMs / 1000)} s ·{' '}
        {result.forgeHeld ? 'Forge gardé chargé' : result.brainReloaded ? `${result.brainReloaded} rechargé` : 'modèle de langage non rechargé'}.
      </p>
      <p className="text-xs text-slate-400">
        <span className="text-slate-500">{result.improved ? 'Consigne complétée par Imager : ' : 'Consigne envoyée telle quelle : '}</span>
        {result.finalPrompt}
      </p>
      {result.warnings.map((warning) => (
        <p key={warning} className="text-xs text-amber-200">
          {warning}
        </p>
      ))}
      <div className="grid grid-cols-2 gap-2">
        {result.files.map((file) => (
          <FileCard key={file.png} file={file} />
        ))}
      </div>
    </div>
  );
}

function FileCard({ file }: { file: ImagerDirectFile }) {
  return (
    <figure className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/5 p-2">
      <button type="button" className="overflow-hidden rounded" onClick={() => void window.jarvis.images.open(file.png)} title="Ouvrir dans la visionneuse">
        <img src={file.preview} alt="" className="block w-full object-contain" />
      </button>
      <figcaption className="truncate text-[11px] text-slate-400" title={file.png}>
        graine {file.seed} · {file.png}
      </figcaption>
    </figure>
  );
}

import { useEffect, useState } from 'react';
import { CheckCircle2, CircleSlash, Loader2 } from 'lucide-react';
import type { Settings } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { Field, Input, Toggle } from '@/components/ui/field';
import type { ImagesStatusInfo } from '../../../shared/ipc';

type ImagesSettingsValue = NonNullable<Settings['images']>;

interface ImagesSettingsSectionProps {
  value: ImagesSettingsValue | undefined;
  onChange: (value: ImagesSettingsValue) => void;
}

const DEFAULT_FORGE_DIR = 'C:\\dev\\Forge';
const DEFAULT_OUTPUT_ROOT = 'C:\\dev\\Jarvis_images';
const DEFAULT_FORGE_URL = 'http://127.0.0.1:7860';

/**
 * Réglages du module images : Forge (Stable Diffusion, modèle SDXL) installé hors du dépôt,
 * lancé par Jarvis au besoin. Coupé : aucun outil d'image, aucune équipe « Images ».
 * « Tester » sonde Forge avec les valeurs du formulaire, avant « Enregistrer ».
 */
export function ImagesSettingsSection({ value, onChange }: ImagesSettingsSectionProps) {
  const [status, setStatus] = useState<ImagesStatusInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const enabled = value?.enabled === true;
  const forgeDir = value?.forgeDir ?? '';
  const outputRoot = value?.outputRoot ?? '';
  const forgeUrl = value?.forgeUrl ?? '';

  const update = (patch: Partial<ImagesSettingsValue>): void => {
    const next: ImagesSettingsValue = { enabled, ...(value ?? {}), ...patch };
    // Un champ vidé reprend la valeur par défaut : on n'enregistre pas une chaîne vide.
    for (const key of ['forgeDir', 'outputRoot', 'forgeUrl'] as const) {
      if (next[key] !== undefined && !next[key]?.trim()) delete next[key];
    }
    onChange(next);
  };

  const refresh = (): void => {
    setLoading(true);
    void window.jarvis.settings
      .imagesStatus({ forgeDir, forgeUrl, outputRoot })
      .then(setStatus)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setStatus(null);
  }, [forgeDir, forgeUrl, outputRoot]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Jarvis Imager (Forge + SDXL, en local)</p>
        <p className="mt-1 text-xs leading-snug text-slate-500">
          « Jarvis, génère une image d’un renard en sticker » : le cerveau confie la demande à Jarvis Imager, qui
          écrit la consigne Stable Diffusion, choisit le modèle (RealVisXL, Juggernaut ou SDXL de base), une taille
          native et les retouches visages et mains, décharge le modèle de langage, allume Forge, fabrique l’image,
          range le fichier avec un petit texte des réglages, puis recharge le modèle. Une à trois minutes par image.
          Projets : jarvis, vx, drivers-ink, perso (<code>images_presets.yaml</code>) ; règles d’Imager dans
          <code> imager_rules.yaml</code>, tous deux dans le dossier des images.
        </p>
      </div>

      <Toggle
        label="Activer Jarvis Imager"
        hint="Ajoute l’outil generer_image et l’équipe « Jarvis Imager » du chef d’orchestre. Coupé : rien ne change dans Jarvis."
        checked={enabled}
        onChange={(checked) => update({ enabled: checked })}
      />

      <Field label="Dossier de Forge" hint={`Contient lancer_forge.bat. Par défaut : ${DEFAULT_FORGE_DIR}.`}>
        <Input value={forgeDir} placeholder={DEFAULT_FORGE_DIR} onChange={(event) => update({ forgeDir: event.target.value })} />
      </Field>

      <Field label="Dossier des images" hint={`Une sous-dossier par projet puis par date. Par défaut : ${DEFAULT_OUTPUT_ROOT}.`}>
        <Input value={outputRoot} placeholder={DEFAULT_OUTPUT_ROOT} onChange={(event) => update({ outputRoot: event.target.value })} />
      </Field>

      <Field label="Adresse de l’API de Forge" hint={`Sur ce PC seulement. Par défaut : ${DEFAULT_FORGE_URL}.`}>
        <Input value={forgeUrl} placeholder={DEFAULT_FORGE_URL} onChange={(event) => update({ forgeUrl: event.target.value })} />
      </Field>

      <Toggle
        label="Reformuler la demande pour Stable Diffusion"
        hint="Avant de générer, le cerveau réécrit la demande en consigne SDXL (anglais structuré : sujet, style, lumière, cadrage, défauts à éviter). Si la réécriture échoue ou semble douteuse, la demande part telle quelle. La consigne envoyée est montrée dans la réponse et gardée dans le fichier .txt."
        checked={value?.refinePrompts !== false}
        onChange={(checked) => update({ refinePrompts: checked })}
      />

      <Toggle
        label="Ouvrir l’image dès qu’elle est prête"
        hint="La première image de chaque demande s’ouvre dans la visionneuse Windows. Le chemin reste cliquable dans la discussion."
        checked={value?.openAfterGeneration !== false}
        onChange={(checked) => update({ openAfterGeneration: checked })}
      />

      <Toggle
        label="Laisser Forge allumé après une image"
        hint="Plus rapide pour enchaîner des images, mais Forge garde de la mémoire vidéo : le modèle de langage peut tourner plus lentement. Par défaut, Forge est arrêté après chaque image."
        checked={value?.keepForgeRunning === true}
        onChange={(checked) => update({ keepForgeRunning: checked })}
      />

      <div className="mt-1">
        <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Imager direct (sans le cerveau)</p>
        <p className="mt-1 text-xs leading-snug text-slate-500">
          Le panneau « Imager direct » (barre de gauche) et la commande <code>/image ta consigne</code> envoient ta demande à Forge sans passer par le modèle de
          langage. Les débuts de phrase qui y vont automatiquement (« Imager, … », « génère une image… ») sont dans <code>imager_rules.yaml</code>, section <code>direct</code>.
        </p>
      </div>

      <Toggle
        label="Garder Forge chargé tant que le panneau Imager direct est ouvert"
        hint="Pour enchaîner plusieurs images sans attendre le redémarrage de Forge. Le modèle de langage est rechargé quand tu fermes le panneau."
        checked={value?.directHoldForge === true}
        onChange={(checked) => update({ directHoldForge: checked })}
      />

      <Toggle
        label="Projet perso : ne pas garder le fichier texte du prompt"
        hint="Seule l’image est enregistrée (pas de .txt des réglages) pour le projet perso. Les autres projets gardent leur .txt."
        checked={value?.directNoTxtPerso === true}
        onChange={(checked) => update({ directNoTxtPerso: checked })}
      />

      <StatusBadge status={status} loading={loading} />

      <Button size="sm" variant="subtle" onClick={refresh} disabled={loading}>
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Tester Forge
      </Button>
    </div>
  );
}

function StatusBadge({ status, loading }: { status: ImagesStatusInfo | null; loading: boolean }) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="size-3.5 animate-spin" /> Recherche de Forge…
      </p>
    );
  }
  if (!status) return null;
  const ready = status.launcherFound && status.checkpointFound && !status.error;
  const lines = [
    status.launcherFound ? `Forge installé dans ${status.forgeDir}.` : `lancer_forge.bat introuvable dans ${status.forgeDir}.`,
    status.checkpoints.length
      ? `Modèles : ${status.checkpoints.map((c) => c.label).join(', ')} ; actif : ${status.activeCheckpoint ?? 'aucun'}.`
      : 'Aucun modèle SDXL dans models\\Stable-diffusion (RealVisXL_V5.0_fp16.safetensors ou sd_xl_base_1.0.safetensors).',
    status.adetailerInstalled ? 'Retouche visages et mains (ADetailer) installée.' : 'ADetailer absent : pas de retouche des visages et des mains.',
    status.forgeRunning ? `Forge est allumé${status.loras.length ? ` ; LoRA : ${status.loras.join(', ')}` : ''}.` : 'Forge est éteint : Jarvis le lancera au besoin.',
    `Images dans ${status.outputRoot}.`,
  ];
  if (status.error) lines.push(status.error);
  const tone = ready
    ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100'
    : 'border-amber-400/25 bg-amber-400/10 text-amber-100';
  return (
    <p className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${tone}`}>
      {ready ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <CircleSlash className="mt-0.5 size-3.5 shrink-0" />}
      <span>{lines.join(' ')}</span>
    </p>
  );
}

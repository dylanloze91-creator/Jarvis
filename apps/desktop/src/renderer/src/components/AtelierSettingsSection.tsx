import type { Settings } from '@jarvis/core';

/** Adresse proposée quand rien n'est réglé : le nom par défaut d'une imprimante sous MainsailOS. */
export const ADRESSE_IMPRIMANTE_PAR_DEFAUT = 'http://mainsailos.local';

/**
 * Réglages → Ce que Jarvis sait faire → Atelier 3D. Rien d'obligatoire : sans réglage, l'atelier
 * dessine les pièces, prépare le fichier avec OrcaSlicer et joint l'imprimante à son adresse par
 * défaut. Rien ne part à l'imprimante sans la carte de confirmation.
 */
export function AtelierSettingsSection({
  value,
  onChange,
}: {
  value: Settings['printer'];
  onChange: (next: Settings['printer']) => void;
}) {
  const printer = value ?? {};
  const patch = (part: Partial<NonNullable<Settings['printer']>>): void => {
    onChange({ ...printer, ...part });
  };
  return (
    <div className="flex flex-col gap-2 text-xs text-slate-200">
      <p className="text-slate-400">
        Dis « fais-moi une boîte de 80 par 50 par 30 » : Jarvis dessine la pièce (OpenSCAD), te la montre en 3D, puis
        la prépare (OrcaSlicer) quand tu dis « imprime-la ». Les deux programmes sont trouvés tout seuls s'ils sont
        installés. Les pièces sont rangées dans <span className="select-text">C:\dev\jarvis-data\atelier</span>.
      </p>
      <label className="flex items-center gap-2" data-settings-highlight="printer-enabled">
        <input
          type="checkbox"
          checked={printer.enabled !== false}
          onChange={(event) => patch({ enabled: event.target.checked })}
        />
        Envoyer les pièces à mon imprimante 3D
      </label>
      <p className="text-slate-400">
        Chaque envoi demande ta confirmation et rappelle de vérifier le plateau. Une enceinte ne lance jamais
        d'impression. Décoché : le fichier est préparé, rien n'est envoyé.
      </p>
      <label className="flex flex-col gap-1" data-settings-highlight="printer-url">
        Adresse de l'imprimante (Moonraker, réseau local)
        <input
          className="rounded border border-white/10 bg-transparent px-1"
          value={printer.baseUrl ?? ''}
          placeholder={ADRESSE_IMPRIMANTE_PAR_DEFAUT}
          onChange={(event) => patch({ baseUrl: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1" data-settings-highlight="printer-key">
        Clé API, facultative
        <input
          className="rounded border border-white/10 bg-transparent px-1"
          type="password"
          value={printer.apiKey ?? ''}
          onChange={(event) => patch({ apiKey: event.target.value })}
        />
      </label>
      <label className="flex items-center gap-2" data-settings-highlight="printer-phone-start">
        <input
          type="checkbox"
          checked={printer.phoneStart !== false}
          onChange={(event) => patch({ phoneStart: event.target.checked })}
        />
        Le téléphone peut lancer une impression (après la carte)
      </label>
    </div>
  );
}

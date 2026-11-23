import { useMemo } from 'react';
import { etatVersion, raisonPasImprimable, type VersionAtelier } from './atelierEtat';
import { Vue3D } from './Vue3D';

export type { VersionAtelier } from './atelierEtat';

export interface AtelierEcranProps {
  nomPiece: string;
  versions: VersionAtelier[];
  versionChoisie: number;
  onChoisirVersion: (numero: number) => void;
  /** Absent : bouton masqué. Ouvre la carte de confirmation, jamais une impression directe. */
  onImprimer?: (numero: number) => void;
  onOuvrirDossier?: (numero: number) => void;
  /** Message d'état : « OpenSCAD rend la pièce… », « Tranchage en cours… ». */
  message?: string | null;
  /** Plateau dessiné (mm) : le même que la limite de l'atelier. */
  plateau?: { x: number; y: number };
}

/** L'écran « Atelier » : la pièce en 3D, ses mesures, ses versions, et l'impression (avec carte). */
export function AtelierEcran({ nomPiece, versions, versionChoisie, onChoisirVersion, onImprimer, onOuvrirDossier, message, plateau }: AtelierEcranProps) {
  const version = versions.find((v) => v.numero === versionChoisie) ?? versions[versions.length - 1];
  const etat = useMemo(() => etatVersion(version), [version]);
  const bloque = raisonPasImprimable(version, etat);

  return (
    <section className="flex w-full flex-col gap-3 text-sm text-slate-100 lg:flex-row">
      <div className="min-w-0 flex-1">
        <Vue3D maillage={etat.maillage} className="h-[460px]" plateau={plateau} />
        {message ? <p className="mt-2 text-xs text-cyan-200">{message}</p> : null}
      </div>

      <aside className="flex w-full flex-col gap-3 lg:w-72">
        <header>
          <p className="text-xs uppercase tracking-wide text-slate-400">Atelier 3D</p>
          <h2 className="text-base font-semibold">{nomPiece}</h2>
          {version ? <p className="text-slate-300">{version.fiche}</p> : null}
        </header>

        {version?.mesures.length ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-lg border border-white/10 p-3 text-xs">
            {version.mesures.map((mesure) => (
              <div key={mesure.nom} className="contents">
                <dt className="text-slate-400">{mesure.nom}</dt>
                <dd className="text-right">{mesure.valeur}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="rounded-lg border border-white/10 p-3 text-xs">
          <p className="mb-1 font-medium">Contrôle</p>
          {!version?.stl ? <p className="text-slate-400">En attente du rendu de la pièce…</p> : null}
          {etat.erreur ? <p className="text-red-300">Illisible : {etat.erreur}</p> : null}
          {etat.controle ? (
            etat.controle.ok ? (
              <p className="text-emerald-300">Pièce fermée et aux bonnes mesures : prête à trancher.</p>
            ) : (
              <ul className="list-disc pl-4 text-amber-200">
                {etat.controle.problemes.map((probleme) => (
                  <li key={probleme}>{probleme}</li>
                ))}
              </ul>
            )
          ) : null}
          {version?.temps || version?.filament ? (
            <p className="mt-1 text-slate-300">
              {version.temps ? `Impression : ${version.temps}` : ''}
              {version.temps && version.filament ? ' · ' : ''}
              {version.filament ? `Filament : ${version.filament}` : ''}
            </p>
          ) : null}
        </div>

        {versions.length > 1 ? (
          <div>
            <p className="mb-1 text-xs text-slate-400">Versions</p>
            <ol className="flex flex-col gap-1">
              {versions.map((v) => (
                <li key={v.numero}>
                  <button
                    type="button"
                    className={`w-full rounded-md border px-2 py-1 text-left text-xs ${
                      v.numero === version?.numero ? 'border-cyan-400/60 bg-cyan-400/10' : 'border-white/10 hover:border-white/30'
                    }`}
                    onClick={() => onChoisirVersion(v.numero)}
                    aria-pressed={v.numero === version?.numero}
                  >
                    Version {v.numero}
                    {v.changement ? <span className="text-slate-400"> · {v.changement}</span> : null}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          {onImprimer ? (
            <button
              type="button"
              className="rounded-md border border-white/15 bg-slate-900/70 px-2.5 py-1.5 text-xs text-slate-100 hover:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-40 text-center"
              disabled={bloque !== null}
              title={bloque ?? 'Jarvis te demandera de confirmer, plateau vide.'}
              onClick={() => version && onImprimer(version.numero)}
            >
              Imprimer cette version…
            </button>
          ) : null}
          {bloque && onImprimer ? <p className="text-[11px] text-slate-400">{bloque}</p> : null}
          {onOuvrirDossier && version ? (
            <button type="button" className="rounded-md border border-white/15 bg-slate-900/70 px-2.5 py-1.5 text-xs text-slate-100 hover:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-40 text-center" onClick={() => onOuvrirDossier(version.numero)}>
              Ouvrir le dossier de la pièce
            </button>
          ) : null}
          <p className="text-[11px] text-slate-400">Pour changer la pièce, dis-le simplement : « plus haute », « trou plus gros », « parois de 3 mm ».</p>
        </div>
      </aside>
    </section>
  );
}

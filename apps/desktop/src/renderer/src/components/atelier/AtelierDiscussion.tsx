import { useEffect, useState } from 'react';
import type { AtelierEtat } from '@jarvis/core';
import { AtelierEcran, type VersionAtelier } from './AtelierEcran';

type EtatPiece = Extract<AtelierEtat, { etape: 'piece' }>;

/**
 * L'écran 3D de l'atelier dans la discussion : les STL des versions arrivent du processus
 * principal (`window.jarvis.atelier.fichier`). « Imprimer » ne lance rien : il envoie
 * « Imprime la version N » dans la discussion, qui tranche puis ouvre la carte de confirmation.
 */
export function AtelierDiscussion({ etat, onSend }: { etat: EtatPiece; onSend?: (text: string) => void }) {
  const [choisie, setChoisie] = useState(etat.versionChoisie);
  const [fichiers, setFichiers] = useState<Record<string, Uint8Array | null>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const api = window.jarvis.atelier;

  useEffect(() => {
    if (!api) return;
    let fini = false;
    for (const version of etat.versions) {
      for (const nom of [version.stl, version.eclate]) {
        if (!nom) continue;
        void api.fichier(etat.dossier, nom).then((r) => {
          if (fini) return;
          if (r.ok) setFichiers((avant) => ({ ...avant, [nom]: r.data }));
          else setErreur(`Fichier ${nom} : ${r.error}`);
        });
      }
    }
    return () => {
      fini = true;
    };
  }, [api, etat]);

  const versions: VersionAtelier[] = etat.versions.map((v) => ({
    numero: v.numero,
    fiche: v.fiche,
    mesures: v.mesures,
    stl: (v.stl ? fichiers[v.stl] : null) ?? null,
    tailleAttendue: v.taille,
    ...(v.eclate ? { eclate: fichiers[v.eclate] ?? null } : {}),
    ...(v.pieces ? { pieces: v.pieces.map((p) => ({ titre: p.titre, nombre: p.nombre, sens: p.sens, ...(p.temps ? { temps: p.temps } : {}), ...(p.filament ? { filament: p.filament } : {}) })) } : {}),
    ...(v.controles ? { controles: v.controles } : {}),
    ...(v.temps ? { temps: v.temps } : {}),
    ...(v.filament ? { filament: v.filament } : {}),
    ...(v.changement ? { changement: v.changement } : {}),
  }));

  return (
    <div className="my-2 w-full rounded-xl border border-white/10 bg-black/30 p-3">
      <AtelierEcran
        nomPiece={etat.nom[0]!.toUpperCase() + etat.nom.slice(1)}
        versions={versions}
        versionChoisie={choisie}
        onChoisirVersion={setChoisie}
        {...(onSend ? { onImprimer: (numero: number) => onSend(`Imprime la version ${numero}`), onImprimerPiece: (titre: string) => onSend(`Imprime ${titre.startsWith('retenue') || titre.startsWith('façade') ? 'la' : 'le'} ${titre}`) } : {})}
        {...(api ? { onOuvrirDossier: () => void api.ouvrirDossier(etat.dossier) } : {})}
        message={api ? erreur : 'Aperçu : les fichiers de la pièce ne se lisent que dans Jarvis.'}
        plateau={etat.plateau}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { heurePhoto, imageFigee } from '@jarvis/core';
import type { VueOeilYeux } from '../../../../shared/ipc';
import { Rafraichisseur } from './rafraichir';

function enDataUrl(type: string, data: Uint8Array): string {
  let binaire = '';
  const pas = 0x8000;
  for (let i = 0; i < data.length; i += pas) binaire += String.fromCharCode(...data.subarray(i, i + pas));
  return `data:${type};base64,${btoa(binaire)}`;
}

/** Image affichée : on garde la dernière bonne, mais son heure reste visible (bandeau « figée »). */
interface Affiche {
  src: string;
  photoId: string;
  prisA: number;
  camera: string;
}

/**
 * Écran « Yeux » (Jarvis Test) : une carte par œil. Aujourd'hui l'imprimante ; le robot s'y
 * ajoutera avec le même contrat (nom, image, état). LECTURE SEULE : aucun bouton n'agit sur
 * l'imprimante. L'image n'est demandée que pendant que l'écran est ouvert et la fenêtre visible.
 */
export function YeuxEcran({ onSend }: { onSend?: (text: string) => void }) {
  const [oeil, setOeil] = useState<VueOeilYeux | null>(null);
  const [affiche, setAffiche] = useState<Affiche | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const api = window.jarvis.yeux;
  const rafraichisseur = useRef<Rafraichisseur | null>(null);

  useEffect(() => {
    if (!api) {
      setErreur('Écran visible seulement dans Jarvis.');
      return;
    }
    const r = new Rafraichisseur(async () => {
      const vue = await api.vue();
      if (!vue.ok) {
        setErreur(vue.error);
        return;
      }
      setErreur(null);
      setOeil(vue.oeil);
      const photo = vue.oeil.photo;
      if (photo) setAffiche({ src: enDataUrl(photo.type, photo.data), photoId: photo.photoId, prisA: photo.prisA, camera: photo.camera });
    });
    rafraichisseur.current = r;
    const visibilite = () => r.voir(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', visibilite);
    visibilite();
    r.ouvrir(true);
    const horloge = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => {
      r.ouvrir(false);
      document.removeEventListener('visibilitychange', visibilite);
      clearInterval(horloge);
    };
  }, [api]);

  const figee = imageFigee(affiche?.prisA ?? null, maintenant);
  const etat = oeil?.etat ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Yeux</h2>
        <p className="text-xs text-slate-400">
          Ce que Jarvis voit. Lecture seule : Jarvis regarde, il ne commande rien. Les images restent en mémoire.
        </p>
      </div>
      {erreur ? <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{erreur}</p> : null}
      <section className="grid gap-4 rounded-2xl border border-cyan-400/20 bg-black/30 p-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-100">{oeil?.nom ?? 'Imprimante'}</h3>
          <figure className="relative overflow-hidden rounded-xl border border-white/10 bg-black/50">
            {affiche ? (
              <img src={affiche.src} alt={`Caméra ${affiche.camera}`} className="block w-full" />
            ) : (
              <div className="flex aspect-video items-center justify-center text-sm text-slate-400">
                {oeil?.raisonPhoto ?? 'Chargement de l’image…'}
              </div>
            )}
            {affiche && figee ? (
              <div className="absolute inset-x-0 top-0 bg-amber-500/85 px-3 py-1 text-xs font-semibold text-black">
                Image figée : pas de nouvelle image depuis {Math.round((maintenant - affiche.prisA) / 1000)} s
                {oeil?.raisonPhoto ? ` (${oeil.raisonPhoto.replace(/\.$/, '')})` : ''}
              </div>
            ) : null}
            {affiche ? (
              <figcaption className="px-3 py-1.5 text-xs text-slate-400">
                Caméra « {affiche.camera} » · image de {heurePhoto(affiche.prisA)}
              </figcaption>
            ) : null}
          </figure>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="quick-btn"
              disabled={!onSend}
              onClick={() => onSend?.("Montre-moi l'impression")}
            >
              Photo dans la discussion
            </button>
            <button
              type="button"
              className="quick-btn"
              disabled={!affiche || !api}
              onClick={() => {
                if (!affiche || !api) return;
                void api.garder(affiche.photoId).then((r) => setMessage(r.ok ? `Photo gardée : ${r.chemin}` : r.error));
              }}
            >
              Garder cette photo
            </button>
          </div>
          {message ? <p className="text-xs text-slate-300">{message}</p> : null}
        </div>
        <div className="flex flex-col gap-3 text-sm text-slate-200">
          {etat ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-slate-400">État</dt>
              <dd className="font-semibold">{etat.etat}</dd>
              {etat.pourcent !== null ? (
                <>
                  <dt className="text-slate-400">Avancement</dt>
                  <dd>
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded bg-white/10">
                        <div className="h-full bg-cyan-400" style={{ width: `${etat.pourcent}%` }} />
                      </div>
                      <span>{etat.pourcent} %</span>
                    </div>
                  </dd>
                </>
              ) : null}
              {etat.reste ? (
                <>
                  <dt className="text-slate-400">Reste</dt>
                  <dd>{etat.reste}</dd>
                </>
              ) : null}
              {etat.couche ? (
                <>
                  <dt className="text-slate-400">Couche</dt>
                  <dd>{etat.couche}</dd>
                </>
              ) : null}
              <dt className="text-slate-400">Buse</dt>
              <dd>{etat.buse}</dd>
              <dt className="text-slate-400">Plateau</dt>
              <dd>{etat.plateau}</dd>
              {etat.fichier ? (
                <>
                  <dt className="text-slate-400">Fichier</dt>
                  <dd className="break-all">{etat.fichier}</dd>
                </>
              ) : null}
            </dl>
          ) : (
            <p className="text-slate-400">{oeil?.raisonEtat ?? 'Lecture de l’état…'}</p>
          )}
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">File d’attente</h4>
            {oeil && oeil.file.length > 0 ? (
              <ol className="list-decimal pl-5 text-xs">
                {oeil.file.map((fichier, i) => (
                  <li key={`${i}-${fichier}`} className="break-all">
                    {fichier}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-slate-400">Vide.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

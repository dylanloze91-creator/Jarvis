import { useEffect, useMemo, useState } from 'react';
import { heurePhoto, imageFigee, OEIL_GENRE_LABELS, type Oeil } from '@jarvis/core';
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
}

/** Le témoin : l'écran ne demande des images qu'ouvert et visible ; c'est ce qu'il dit. */
function useVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const suivre = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', suivre);
    return () => document.removeEventListener('visibilitychange', suivre);
  }, []);
  return visible;
}

/**
 * Écran « Yeux » (Jarvis Test) : une carte par œil (imprimante, webcam, iPhone, rover, hub…).
 * Jarvis REGARDE seulement : aucun bouton n'agit sur un appareil. Les images ne sont demandées que
 * pendant que l'écran est ouvert et la fenêtre visible, et seulement pour les yeux allumés.
 */
export function YeuxEcran({ onSend }: { onSend?: (text: string) => void }) {
  const [yeux, setYeux] = useState<Oeil[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const api = window.jarvis.yeux;

  const recharger = () => {
    if (!api) return;
    void api.liste().then(setYeux, () => setErreur('Je n’ai pas pu lire la liste des yeux.'));
  };
  useEffect(() => {
    if (!api) setErreur('Écran visible seulement dans Jarvis.');
    else recharger();
  }, [api]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Yeux</h2>
        <p className="text-xs text-slate-400">
          Ce que Jarvis voit. Il regarde seulement : il ne commande rien. Les images restent en mémoire ; rien n’est enregistré
          sans « Garder cette photo ». Jamais de caméra dans une chambre.
        </p>
      </div>
      {erreur ? <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{erreur}</p> : null}
      {yeux?.length === 0 ? <p className="text-sm text-slate-400">Aucun œil pour l’instant.</p> : null}
      {yeux?.map((oeil) => (
        <CarteOeil key={oeil.id} oeil={oeil} onChange={recharger} {...(onSend ? { onSend } : {})} />
      ))}
    </div>
  );
}

function phraseMontrer(oeil: Oeil): string {
  if (oeil.genre === 'klipper') return "Montre-moi l'impression";
  return `Montre-moi la caméra ${/^[aeiouyh]/i.test(oeil.nom) ? "de l'" : 'du '}${oeil.nom}`;
}

function CarteOeil({ oeil, onSend, onChange }: { oeil: Oeil; onSend?: (text: string) => void; onChange: () => void }) {
  const [vue, setVue] = useState<VueOeilYeux | null>(null);
  const [affiche, setAffiche] = useState<Affiche | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const [adresse, setAdresse] = useState(oeil.adresse ?? '');
  const [jeton, setJeton] = useState('');
  const visible = useVisible();
  const api = window.jarvis.yeux;
  const pasBranche = oeil.genre === 'reseau' && !oeil.adresse;
  const regarde = Boolean(api) && oeil.allume && !pasBranche && visible;

  const rafraichisseur = useMemo(
    () =>
      api
        ? new Rafraichisseur(async () => {
            const r = await api.vue(oeil.id);
            if (!r.ok) {
              setMessage(r.error);
              return;
            }
            setVue(r.vue);
            const photo = r.vue.photo;
            if (photo) setAffiche({ src: enDataUrl(photo.type, photo.data), photoId: photo.photoId, prisA: photo.prisA });
          })
        : null,
    [api, oeil.id],
  );

  useEffect(() => {
    if (!rafraichisseur) return;
    rafraichisseur.voir(visible);
  }, [rafraichisseur, visible]);
  useEffect(() => {
    if (!rafraichisseur) return;
    rafraichisseur.ouvrir(oeil.allume && !pasBranche);
    return () => rafraichisseur.ouvrir(false);
  }, [rafraichisseur, oeil.allume, pasBranche]);
  useEffect(() => {
    const horloge = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(horloge);
  }, []);
  // Coupé : plus jamais l'ancienne image à l'écran.
  useEffect(() => {
    if (!oeil.allume) setAffiche(null);
  }, [oeil.allume]);

  const figee = imageFigee(affiche?.prisA ?? null, maintenant);
  const etat = vue?.etat ?? null;

  return (
    <section className="grid gap-4 rounded-2xl border border-cyan-400/20 bg-black/30 p-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-oeil={oeil.id}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">{oeil.nom}</h3>
            <p className="text-xs text-slate-400">
              {OEIL_GENRE_LABELS[oeil.genre]} · {oeil.piece}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {regarde ? (
              <span className="flex items-center gap-1.5 text-xs text-red-300">
                <span className="size-2 animate-pulse rounded-full bg-red-500" aria-hidden /> regarde
              </span>
            ) : null}
            <label className="flex items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={oeil.allume}
                disabled={!api || pasBranche}
                onChange={(event) => {
                  void api?.allumer(oeil.id, event.target.checked).then((r) => {
                    if (!r.ok) setMessage(r.error);
                    onChange();
                  });
                }}
              />
              {pasBranche ? 'Pas branché' : oeil.allume ? 'Allumée' : 'Coupée'}
            </label>
          </div>
        </div>
        <figure className="relative overflow-hidden rounded-xl border border-white/10 bg-black/50">
          {oeil.allume && affiche ? (
            <img src={affiche.src} alt={`Caméra ${oeil.nom}`} className="block w-full" />
          ) : (
            <div className="flex aspect-video items-center justify-center px-4 text-center text-sm text-slate-400">
              {pasBranche
                ? 'Pas encore branché.'
                : !oeil.allume
                  ? 'La caméra est coupée.'
                  : (vue?.raisonPhoto ?? 'Chargement de l’image…')}
            </div>
          )}
          {oeil.allume && affiche && figee ? (
            <div className="absolute inset-x-0 top-0 bg-amber-500/85 px-3 py-1 text-xs font-semibold text-black">
              Image figée : pas de nouvelle image depuis {Math.round((maintenant - affiche.prisA) / 1000)} s
              {vue?.raisonPhoto ? ` (${vue.raisonPhoto.replace(/\.$/, '')})` : ''}
            </div>
          ) : null}
          {oeil.allume && affiche ? (
            <figcaption className="px-3 py-1.5 text-xs text-slate-400">Image de {heurePhoto(affiche.prisA)}</figcaption>
          ) : null}
        </figure>
        {pasBranche ? (
          <div className="flex flex-col gap-2 text-xs text-slate-200">
            <p className="text-slate-400">Adresse de sa caméra sur le réseau local (contrat des yeux : /api/oeil/hello et /api/oeil/photo).</p>
            <input
              className="rounded border border-white/10 bg-transparent px-2 py-1"
              placeholder="http://192.168.1.50:8770"
              value={adresse}
              onChange={(e) => setAdresse(e.target.value)}
            />
            <input
              className="rounded border border-white/10 bg-transparent px-2 py-1"
              type="password"
              placeholder="Jeton"
              value={jeton}
              onChange={(e) => setJeton(e.target.value)}
            />
            <button
              type="button"
              className="quick-btn w-fit"
              disabled={!api || !adresse.trim()}
              onClick={() => {
                void api?.brancher(oeil.id, adresse, jeton).then((r) => {
                  setMessage(r.ok ? 'Branché.' : r.error);
                  if (r.ok) onChange();
                });
              }}
            >
              Brancher
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="quick-btn" disabled={!onSend || !oeil.allume} onClick={() => onSend?.(phraseMontrer(oeil))}>
              Photo dans la discussion
            </button>
            <button
              type="button"
              className="quick-btn"
              disabled={!affiche || !api || !oeil.allume}
              onClick={() => {
                if (!affiche || !api) return;
                void api.garder(affiche.photoId).then((r) => setMessage(r.ok ? `Photo gardée : ${r.chemin}` : r.error));
              }}
            >
              Garder cette photo
            </button>
          </div>
        )}
        {message ? <p className="text-xs text-slate-300">{message}</p> : null}
      </div>
      {oeil.genre === 'klipper' ? (
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
            <p className="text-slate-400">{vue?.raisonEtat ?? (oeil.allume ? 'Lecture de l’état…' : 'Caméra coupée : état non lu.')}</p>
          )}
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">File d’attente</h4>
            {vue && vue.file.length > 0 ? (
              <ol className="list-decimal pl-5 text-xs">
                {vue.file.map((fichier, i) => (
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
      ) : null}
    </section>
  );
}

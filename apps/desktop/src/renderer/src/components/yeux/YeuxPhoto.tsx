import { useEffect, useState } from 'react';
import type { PhotoDiscussion } from '@jarvis/core';
import { heurePhoto } from '@jarvis/core';

function enDataUrl(type: string, data: Uint8Array): string {
  let binaire = '';
  const pas = 0x8000;
  for (let i = 0; i < data.length; i += pas) binaire += String.fromCharCode(...data.subarray(i, i + pas));
  return `data:${type};base64,${btoa(binaire)}`;
}

/**
 * Photo de la caméra de l'imprimante sous la réponse de Jarvis. L'image est demandée au
 * processus principal par sa référence : elle n'existe qu'en mémoire (30 minutes). L'heure de
 * la prise est toujours affichée, pour ne jamais confondre une vieille image avec l'actuelle.
 */
export function YeuxPhoto({ photo }: { photo: PhotoDiscussion }) {
  const [src, setSrc] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const api = window.jarvis.yeux;

  useEffect(() => {
    if (!api) {
      setErreur('Photo visible seulement dans Jarvis.');
      return;
    }
    let fini = false;
    void api.photo(photo.photoId).then((r) => {
      if (fini) return;
      if (r.ok) setSrc(enDataUrl(r.type, r.data));
      else setErreur(r.error);
    });
    return () => {
      fini = true;
    };
  }, [api, photo.photoId]);

  return (
    <div className="assistant-row">
      <div className="assistant-avatar">J</div>
      <div className="assistant-copy max-w-[640px]">
        <figure className="overflow-hidden rounded-xl border border-cyan-400/25 bg-black/40">
          {src ? (
            <img src={src} alt={`Caméra ${photo.camera}`} className="block w-full" />
          ) : (
            <div className="px-4 py-6 text-sm text-slate-300">{erreur ?? 'Chargement de la photo…'}</div>
          )}
          <figcaption className="px-3 py-1.5 text-xs text-slate-400">
            Caméra « {photo.camera} » · photo prise à {heurePhoto(photo.prisA)}
          </figcaption>
        </figure>
      </div>
    </div>
  );
}

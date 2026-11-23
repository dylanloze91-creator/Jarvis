import { useEffect, useMemo, useRef, useState } from 'react';
import { lireStl, type Maillage } from '@jarvis/core';
import { Visionneuse, type CoteEcran } from './visionneuse';

export interface Vue3DProps {
  /** Le fichier STL rendu par OpenSCAD (octets), ou un maillage déjà lu. */
  stl?: ArrayBuffer | Uint8Array | null;
  maillage?: Maillage | null;
  /** Classe de hauteur Tailwind (défaut : h-[420px]). */
  className?: string;
  /** Taille du plateau dessiné, en mm (défaut : volume de l'Ender 3 S1 Plus du cœur). Lue à la création. */
  plateau?: { x: number; y: number };
}

/** Vue 3D d'une pièce sur le plateau : tourner, zoomer, cotes en millimètres. */
export function Vue3D({ stl, maillage, className, plateau }: Vue3DProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visionneuseRef = useRef<Visionneuse | null>(null);
  const [disponible, setDisponible] = useState(true);
  const [cotesEcran, setCotesEcran] = useState<CoteEcran[]>([]);

  const lu = useMemo<{ maillage: Maillage | null; erreur: string | null }>(() => {
    if (maillage) return { maillage, erreur: null };
    if (!stl) return { maillage: null, erreur: null };
    try {
      return { maillage: lireStl(stl), erreur: null };
    } catch (error) {
      return { maillage: null, erreur: error instanceof Error ? error.message : String(error) };
    }
  }, [stl, maillage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const visionneuse = new Visionneuse(canvas, { onCotes: setCotesEcran, plateau });
    visionneuseRef.current = visionneuse;
    setDisponible(visionneuse.disponible);
    return () => {
      visionneuse.detruire();
      visionneuseRef.current = null;
    };
    // Le plateau ne change pas pendant que l'écran est ouvert : la visionneuse est créée une fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    visionneuseRef.current?.afficher(lu.maillage);
  }, [lu.maillage]);

  return (
    <div className={`relative w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950/60 ${className ?? 'h-[420px]'}`}>
      <canvas ref={canvasRef} className="block h-full w-full cursor-grab active:cursor-grabbing" aria-label="Vue 3D de la pièce" />
      {cotesEcran.map((cote) =>
        cote.x === null || cote.y === null ? null : (
          <span
            key={cote.nom}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded bg-slate-900/80 px-1.5 py-0.5 text-[11px] text-cyan-100"
            style={{ left: cote.x, top: cote.y }}
            title={cote.nom}
          >
            {cote.texte}
          </span>
        ),
      )}
      {!disponible ? (
        <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-slate-300">
          Aperçu 3D indisponible sur cet écran (WebGL coupé). Le fichier de la pièce est quand même prêt.
        </p>
      ) : null}
      {lu.erreur ? (
        <p className="absolute inset-x-0 bottom-0 bg-red-950/80 p-2 text-center text-xs text-red-100">Fichier de la pièce illisible : {lu.erreur}</p>
      ) : null}
      {disponible && !lu.erreur ? (
        <div className="absolute right-2 top-2 flex gap-1">
          <button type="button" className="rounded-md border border-white/15 bg-slate-900/70 px-2.5 py-1.5 text-xs text-slate-100 hover:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => visionneuseRef.current?.quartDeTour()} title="Tourner d’un quart de tour">
            ↻
          </button>
          <button type="button" className="rounded-md border border-white/15 bg-slate-900/70 px-2.5 py-1.5 text-xs text-slate-100 hover:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => visionneuseRef.current?.recadrer()} title="Revenir à la vue de départ">
            Recadrer
          </button>
        </div>
      ) : null}
      {disponible ? (
        <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-slate-400">
          Glisse pour tourner · molette ou deux doigts pour zoomer · double-clic pour recadrer
        </p>
      ) : null}
    </div>
  );
}

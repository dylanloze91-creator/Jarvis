/**
 * Contrôle du plateau AVANT l'impression : chaque objet est-il bien placé ? Pur, sans modèle.
 *
 * Entrées : la lecture du G-code (`gcode.ts`) — ou, à défaut, les polygones des objets donnés
 * par Klipper — la feuille (sa position mesurée par la caméra si elle est décalée), le volume
 * de l'imprimante et, s'il existe, la zone palpée par le capteur (maillage du plateau).
 *
 * Verdict par objet :
 * - « bloquant » : il imprimerait en partie dans le vide (hors de la feuille, îlot sans appui,
 *   objet qui ne touche pas le plateau) ou hors du volume. Jarvis déconseille de lancer et dit
 *   pourquoi ; lancer reste ta décision, sur le PC ou le téléphone, jamais depuis une enceinte.
 * - « à vérifier » : trop près du bord, collé à un autre objet, hors de la zone palpée, ou
 *   haut et étroit (risque de basculer).
 */
import type { AnalyseGcode, VolumeImprimante } from './gcode.js';
import { VOLUME_ENDER3_S1_PLUS } from './gcode.js';
import type { Point2 } from './camera3d.js';
import type { Feuille } from './vision.js';
import { objetDit } from './objets.js';

export type VerdictPlateau = 'ok' | 'a_verifier' | 'bloquant';

export interface RemarquePlateau {
  objet: string;
  niveau: 'a_verifier' | 'bloquant';
  code: 'hors_volume' | 'hors_feuille' | 'ilot_vide' | 'ne_touche_pas' | 'bord' | 'colle' | 'hors_maillage' | 'bascule';
  texte: string;
}

export interface ControlePlateau {
  verdict: VerdictPlateau;
  remarques: RemarquePlateau[];
  /** Phrase courte à dire ou afficher. */
  resume: string;
}

export interface ReglagesPlateau {
  volume: VolumeImprimante;
  /** Feuille amovible, aux coordonnées où elle DOIT être. */
  feuille: Feuille;
  /** Décalage mesuré par la caméra (mm), 0 si inconnu. */
  decalage: { dx: number; dy: number };
  /** Distance minimale au bord de la feuille (mm). */
  marge: number;
  /** Zone palpée (`bed_mesh` de Klipper : mesh_min, mesh_max), si connue. */
  maillage: Feuille | null;
  /** Hauteur / largeur de la base au-delà de laquelle un objet risque de basculer. */
  elancementMax: number;
}

export const PLATEAU_DEFAUT: ReglagesPlateau = {
  volume: VOLUME_ENDER3_S1_PLUS,
  feuille: { minX: 0, maxX: 300, minY: 0, maxY: 300 },
  decalage: { dx: 0, dy: 0 },
  marge: 3,
  maillage: null,
  elancementMax: 6,
};

function cote(p: Point2, f: Feuille): string {
  const d = [
    ['à gauche', f.minX - p[0]],
    ['à droite', p[0] - f.maxX],
    ['devant', f.minY - p[1]],
    ['derrière', p[1] - f.maxY],
  ] as const;
  return [...d].sort((a, b) => b[1] - a[1])[0]![0];
}

function mm(v: number): string {
  return v.toFixed(1).replace('.', ',');
}

function rond(v: number): string {
  return String(Math.max(1, Math.round(v)));
}

/** Contrôle à partir d'un G-code lu. */
export function controlerPlateau(analyse: AnalyseGcode, reglages: Partial<ReglagesPlateau> = {}): ControlePlateau {
  const r: ReglagesPlateau = { ...PLATEAU_DEFAUT, ...reglages };
  const feuille: Feuille = {
    minX: r.feuille.minX + r.decalage.dx,
    maxX: r.feuille.maxX + r.decalage.dx,
    minY: r.feuille.minY + r.decalage.dy,
    maxY: r.feuille.maxY + r.decalage.dy,
  };
  const remarques: RemarquePlateau[] = [];
  const decale = Math.abs(r.decalage.dx) >= 1 || Math.abs(r.decalage.dy) >= 1;
  const reels = analyse.objets.filter((o) => o.nom !== 'impression' || analyse.objets.length === 1);

  for (const h of analyse.horsVolume) {
    if (h.objet === 'impression' && reels.every((o) => o.nom !== 'impression')) {
      remarques.push({ objet: h.objet, niveau: 'bloquant', code: 'hors_volume', texte: "Le fichier dépose de la matière hors du volume de l'imprimante (ligne de purge ou jupe)." });
      continue;
    }
    const v = r.volume;
    const ou = h.z > v.maxZ ? 'en haut' : h.x < v.minX ? 'à gauche' : h.x > v.maxX ? 'à droite' : h.y < v.minY ? 'devant' : 'derrière';
    remarques.push({ objet: h.objet, niveau: 'bloquant', code: 'hors_volume', texte: `${objetDit(h.objet)} sort du volume de l'imprimante (${ou}) : Klipper arrêterait l'impression en cours de route.` });
  }

  for (const o of reels) {
    const nom = objetDit(o.nom);
    if (!o.emprise) {
      if (o.zFin > 0) remarques.push({ objet: o.nom, niveau: 'bloquant', code: 'ne_touche_pas', texte: `${nom} ne touche pas le plateau : il commencerait à ${mm(o.zDebut)} mm, dans le vide.` });
      continue;
    }
    // Hors de la feuille : cases de la première couche qui tombent à côté (déjà dit si hors du volume).
    const horsVolume = analyse.horsVolume.some((h) => h.objet === o.nom);
    const dehors = horsVolume ? [] : o.casesSol.filter((p) => p[0] < feuille.minX || p[0] > feuille.maxX || p[1] < feuille.minY || p[1] > feuille.maxY);
    if (horsVolume) {
      // Déjà dit.
    } else if (dehors.length > 0) {
      const part = Math.round((dehors.length / Math.max(1, o.casesSol.length)) * 100);
      const ou = cote(dehors[0]!, feuille);
      remarques.push({
        objet: o.nom,
        niveau: 'bloquant',
        code: 'hors_feuille',
        texte: `${nom} dépasse de la feuille ${ou} (${part} % de sa base${decale ? ', feuille décalée' : ''}) : il imprimerait en partie dans le vide.`,
      });
    } else {
      const e = o.emprise;
      const ecart = Math.min(e.minX - feuille.minX, feuille.maxX - e.maxX, e.minY - feuille.minY, feuille.maxY - e.maxY);
      if (ecart < r.marge) {
        remarques.push({ objet: o.nom, niveau: 'a_verifier', code: 'bord', texte: `${nom} est à ${ecart < 0.5 ? 'moins d’un' : rond(ecart)} mm du bord de la feuille.` });
      }
    }
    if (r.maillage) {
      const m = r.maillage;
      const e = o.emprise;
      if (e.minX < m.minX - 1 || e.maxX > m.maxX + 1 || e.minY < m.minY - 1 || e.maxY > m.maxY + 1) {
        remarques.push({ objet: o.nom, niveau: 'a_verifier', code: 'hors_maillage', texte: `${nom} sort de la zone palpée du plateau : la première couche y sera moins sûre.` });
      }
    }
    const base = Math.sqrt(Math.max(1, o.aireSol));
    const hauteur = o.zFin;
    if (hauteur >= 15 && hauteur / base > r.elancementMax) {
      remarques.push({ objet: o.nom, niveau: 'a_verifier', code: 'bascule', texte: `${nom} est haut (${Math.round(hauteur)} mm) sur une petite base : il risque de se décoller ou de basculer. Une bordure (brim) aiderait.` });
    }
  }

  // Objets collés : cases de première couche partagées ou voisines.
  for (let i = 0; i < reels.length; i++)
    for (let k = i + 1; k < reels.length; k++) {
      const a = reels[i]!;
      const b = reels[k]!;
      if (!a.emprise || !b.emprise) continue;
      if (a.emprise.maxX + 1 < b.emprise.minX || b.emprise.maxX + 1 < a.emprise.minX || a.emprise.maxY + 1 < b.emprise.minY || b.emprise.maxY + 1 < a.emprise.minY) continue;
      const casesA = new Set(a.casesSol.map((p) => `${Math.floor(p[0])},${Math.floor(p[1])}`));
      const touche = b.casesSol.some((p) => {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (casesA.has(`${Math.floor(p[0]) + dx},${Math.floor(p[1]) + dy}`)) return true;
        return false;
      });
      if (touche) remarques.push({ objet: a.nom, niveau: 'a_verifier', code: 'colle', texte: `${objetDit(a.nom)} et ${objetDit(b.nom, false)} se touchent : si l’un rate, il emporte l’autre.` });
    }

  // Îlots dans le vide (un message par objet, le plus bas).
  const parObjet = new Map<string, { z: number; aire: number; n: number }>();
  for (const il of analyse.ilots) {
    const cur = parObjet.get(il.objet);
    if (!cur) parObjet.set(il.objet, { z: il.z, aire: il.aire, n: 1 });
    else {
      cur.n++;
      cur.aire += il.aire;
    }
  }
  for (const [objet, il] of parObjet) {
    if (remarques.some((m) => m.objet === objet && m.code === 'ne_touche_pas')) continue;
    remarques.push({
      objet,
      niveau: 'bloquant',
      code: 'ilot_vide',
      texte: `${objetDit(objet)} a une partie posée sur rien à ${mm(il.z)} mm (${Math.round(il.aire)} mm²${il.n > 1 ? `, ${il.n} endroits` : ''}) : elle serait imprimée dans le vide. Il manque des supports, ou la pièce est mal orientée.`,
    });
  }

  const bloquants = remarques.filter((m) => m.niveau === 'bloquant');
  const verdict: VerdictPlateau = bloquants.length > 0 ? 'bloquant' : remarques.length > 0 ? 'a_verifier' : 'ok';
  const resume =
    verdict === 'ok'
      ? `Plateau vérifié : ${reels.length === 1 ? 'l’objet est bien placé' : `les ${reels.length} objets sont bien placés`}.`
      : verdict === 'bloquant'
        ? `Je te déconseille de lancer. ${bloquants[0]!.texte}${bloquants.length > 1 ? ` (et ${bloquants.length - 1} autre${bloquants.length > 2 ? 's' : ''} problème${bloquants.length > 2 ? 's' : ''})` : ''}`
        : `À vérifier avant de lancer. ${remarques[0]!.texte}${remarques.length > 1 ? ` (et ${remarques.length - 1} autre${remarques.length > 2 ? 's' : ''} remarque${remarques.length > 2 ? 's' : ''})` : ''}`;
  return { verdict, remarques, resume };
}

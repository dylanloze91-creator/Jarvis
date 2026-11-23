/**
 * « Montre-moi l'impression » : règle express, sans modèle. Et la phrase d'état qui accompagne
 * la photo, lue dans Moonraker.
 */
import { formatPrintDuration } from '../quotidien/moonraker.js';
import type { EtatYeux } from './imprimante.js';

export type IntentionYeux = { kind: 'montrer'; avecEtat: boolean };

function plier(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['’`-]/g, ' ')
    .replace(/[?.!,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const AMORCE = /^(?:(?:hey|eh|ok|bon|dis|alors)\s+)?(?:jarvis\s+)?(?:(?:est ce que\s+)?(?:tu\s+)?(?:peux|pourrais|veux)\s+(?:tu\s+)?)?/;
const POLITESSE = /\s+(?:s il te plait|s il vous plait|stp|svp|merci|jarvis)$/;

const MONTRER =
  /^(?:montre|montres|montrez|fais voir|fait voir|faire voir|me montrer|montrer|affiche)(?:\s+moi)?\s+(?:l |la |le )?(?:impression|imprimante|camera de l imprimante|camera de l impression|impression en cours)$/;
const OU_EN_EST = /^ou en est l impression(?: en cours)?$/;

/** `null` : la phrase n'est pas pour les yeux, le tour continue. */
export function intentionYeux(texte: string): IntentionYeux | null {
  let n = plier(texte).replace(AMORCE, '');
  for (let i = 0; i < 2; i += 1) n = n.replace(POLITESSE, '').trim();
  if (!n) return null;
  if (OU_EN_EST.test(n)) return { kind: 'montrer', avecEtat: true };
  if (MONTRER.test(n)) return { kind: 'montrer', avecEtat: true };
  return null;
}

const ETATS: Record<string, string> = {
  printing: 'en cours',
  paused: 'en pause',
  complete: 'terminée',
  completed: 'terminée',
  cancelled: 'annulée',
  standby: 'en attente',
  error: 'en erreur',
};

export function etatEnMots(state: string): string {
  return ETATS[state] ?? state;
}

function resteEnMots(etat: EtatYeux): string | null {
  const { progress, printDuration } = etat.status;
  if (progress <= 0.005 || progress >= 1 || printDuration <= 0) return null;
  return formatPrintDuration(printDuration * ((1 - progress) / progress));
}

function temperatures(etat: EtatYeux): string {
  const s = etat.status;
  return `buse ${Math.round(s.extruder)} °C, plateau ${Math.round(s.bed)} °C`;
}

/** Phrase de la fenêtre et du téléphone : « 42 %, il reste 1 h 10, buse 215 °C, plateau 60 °C. » */
export function phraseEtat(etat: EtatYeux): string {
  if (etat.klippy === 'shutdown' || etat.klippy === 'error') return "L'imprimante est en erreur (Klipper arrêté).";
  if (etat.klippy === 'startup') return "L'imprimante démarre.";
  const s = etat.status;
  const pourcent = Math.floor(s.progress * 100);
  if (s.state === 'printing' || s.state === 'paused') {
    const reste = resteEnMots(etat);
    const pause = s.state === 'paused' ? 'En pause à ' : '';
    const couche = etat.couche !== null && etat.couches ? `, couche ${etat.couche} sur ${etat.couches}` : '';
    return `${pause}${pourcent} %${reste ? `, il reste ${reste}` : ''}${couche}, ${temperatures(etat)}.`;
  }
  if (s.state === 'complete' || s.state === 'completed') return `Impression terminée, ${temperatures(etat)}.`;
  if (s.state === 'standby') return `Aucune impression en cours, ${temperatures(etat)}.`;
  return `Impression ${etatEnMots(s.state)}, ${temperatures(etat)}.`;
}

/** Phrase de l'enceinte : courte, et la photo est sur le PC. */
export function phraseEnceinte(etat: EtatYeux | null, photo: boolean): string {
  const suite = photo ? ' La photo est sur le PC.' : '';
  if (!etat) return `L'imprimante ne répond pas.${suite}`;
  const s = etat.status;
  if (etat.klippy === 'shutdown' || etat.klippy === 'error') return `L'imprimante est en erreur.${suite}`;
  if (s.state === 'printing' || s.state === 'paused') {
    const reste = resteEnMots(etat);
    const pause = s.state === 'paused' ? 'En pause à ' : '';
    return `${pause}${Math.floor(s.progress * 100)} %${reste ? `, il reste ${reste}` : ''}.${suite}`;
  }
  if (s.state === 'complete' || s.state === 'completed') return `Impression terminée.${suite}`;
  return `Aucune impression en cours.${suite}`;
}

/** Heure de la prise, affichée sous l'image : « photo prise à 21 h 14 min 05 s ». */
export function heurePhoto(prisA: number): string {
  const d = new Date(prisA);
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${d.getHours()} h ${deux(d.getMinutes())} min ${deux(d.getSeconds())} s`;
}

/** Ce que la carte d'un œil affiche (écran « Yeux »). Valeurs déjà en mots, rien à calculer à l'écran. */
export interface EtatCarte {
  etat: 'en cours' | 'en pause' | 'terminé' | 'en attente' | 'en erreur' | 'annulé' | 'inconnu';
  pourcent: number | null;
  reste: string | null;
  couche: string | null;
  buse: string;
  plateau: string;
  fichier: string | null;
}

/** Une image plus vieille que ça est « figée » à l'écran. */
export const IMAGE_FIGEE_MS = 10_000;

export function etatCarte(etat: EtatYeux): EtatCarte {
  const s = etat.status;
  const temp = (mesure: number, consigne: number) =>
    consigne > 0 ? `${Math.round(mesure)} °C (consigne ${Math.round(consigne)} °C)` : `${Math.round(mesure)} °C`;
  let libelle: EtatCarte['etat'];
  if (etat.klippy === 'shutdown' || etat.klippy === 'error' || s.state === 'error') libelle = 'en erreur';
  else if (s.state === 'printing') libelle = 'en cours';
  else if (s.state === 'paused') libelle = 'en pause';
  else if (s.state === 'complete' || s.state === 'completed') libelle = 'terminé';
  else if (s.state === 'cancelled') libelle = 'annulé';
  else if (s.state === 'standby') libelle = 'en attente';
  else libelle = 'inconnu';
  const actif = libelle === 'en cours' || libelle === 'en pause';
  return {
    etat: libelle,
    pourcent: actif ? Math.floor(s.progress * 100) : null,
    reste: actif ? resteEnMots(etat) : null,
    couche: actif && etat.couche !== null && etat.couches ? `${etat.couche} sur ${etat.couches}` : null,
    buse: temp(s.extruder, s.extruderTarget),
    plateau: temp(s.bed, s.bedTarget),
    fichier: s.filename || null,
  };
}

/** Image figée : plus de 10 s sans nouvelle image. */
export function imageFigee(prisA: number | null, maintenant: number): boolean {
  return prisA === null || maintenant - prisA > IMAGE_FIGEE_MS;
}

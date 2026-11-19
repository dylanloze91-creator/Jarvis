/**
 * Où va chaque phrase de la surveillance d'impression : enceinte (voix ou écran seul)
 * et téléphone (notification qui sonne, silencieuse, ou rien).
 *
 * Pur : aucune connexion ici. Le PC appelle `annoncer` pour chaque `say` rendu par
 * `stepSurveillance`, puis envoie le résultat à l'enceinte et au téléphone.
 *
 * Règles :
 * - une alerte (pause, coupure, Klipper en erreur) est toujours dite et sonne, même la nuit ;
 * - un doute ou un point d'avancement est dit le jour, affiché seulement la nuit
 *   (heures calmes), et arrive sur le téléphone sans sonner la nuit ;
 * - une simple information (« je surveille… ») s'affiche et arrive sans sonner.
 */
import type { SurveillanceLevel } from './surveillance.js';

export interface AnnoncesReglages {
  /** Envoyer à l'enceinte. */
  enceinte: boolean;
  /** Envoyer au téléphone. */
  telephone: boolean;
  /** Heures calmes, de `calmeDebut` h à `calmeFin` h (heure locale). Égales = jamais calme. */
  calmeDebut: number;
  calmeFin: number;
}

export const ANNONCES_DEFAUT: AnnoncesReglages = { enceinte: true, telephone: true, calmeDebut: 23, calmeFin: 7 };

export type NotificationTelephone = 'sonne' | 'silencieuse' | 'aucune';

export interface EcranEnceinte {
  titre: string;
  ligne: string;
  /** Durée d'affichage ; 0 = reste jusqu'à ce qu'on touche l'écran. */
  secondes: number;
}

export interface Annonce {
  niveau: SurveillanceLevel;
  /** Ce que l'enceinte dit à voix haute ; `null` = rien à dire (écran seul ou enceinte coupée). */
  voix: string | null;
  /** Ce que l'écran de l'enceinte affiche ; `null` = enceinte coupée. */
  ecran: EcranEnceinte | null;
  telephone: NotificationTelephone;
  /** Titre et texte de la notification du téléphone. */
  titre: string;
  texte: string;
  /** Joindre une photo de la caméra (si elle répond). */
  photo: boolean;
}

export interface PhraseSurveillance {
  level: SurveillanceLevel;
  text: string;
  photo: boolean;
}

const TITRES: Record<SurveillanceLevel, string> = {
  info: 'Imprimante',
  etape: 'Imprimante — avancement',
  doute: 'Imprimante — à vérifier',
  alerte: 'Imprimante — ALERTE',
};

const ECRAN_MAX = 60;

/** Vrai pendant les heures calmes (ex. 23 h → 7 h, en passant minuit). */
export function heuresCalmes(heure: number, reglages: AnnoncesReglages): boolean {
  const { calmeDebut: d, calmeFin: f } = reglages;
  if (d === f) return false;
  return d < f ? heure >= d && heure < f : heure >= d || heure < f;
}

/** Ligne courte pour le petit écran : « cube : 50 % · Tout va bien. » */
export function ligneEcran(texte: string): string {
  let ligne = texte
    .replace(/^Impression de /, '')
    .replace(/ Reste environ [^.]+\./, '')
    .replace(/\s+/g, ' ')
    .trim();
  ligne = ligne.replace(/^(.+?) : (\d+ %)\. /, '$1 : $2 · ');
  return ligne.length > ECRAN_MAX ? `${ligne.slice(0, ECRAN_MAX - 1).trimEnd()}…` : ligne;
}

/** Décide où va une phrase de la surveillance. `quand` est lu en heure locale. */
export function annoncer(phrase: PhraseSurveillance, quand: Date, reglages: AnnoncesReglages = ANNONCES_DEFAUT): Annonce {
  const calme = heuresCalmes(quand.getHours(), reglages);
  const alerte = phrase.level === 'alerte';
  const parle = alerte || (!calme && (phrase.level === 'etape' || phrase.level === 'doute'));

  let telephone: NotificationTelephone = 'aucune';
  if (reglages.telephone) telephone = alerte || (!calme && phrase.level !== 'info') ? 'sonne' : 'silencieuse';

  return {
    niveau: phrase.level,
    voix: reglages.enceinte && parle ? phrase.text : null,
    ecran: reglages.enceinte
      ? { titre: TITRES[phrase.level], ligne: ligneEcran(phrase.text), secondes: alerte ? 0 : phrase.level === 'info' ? 15 : 60 }
      : null,
    telephone,
    titre: TITRES[phrase.level],
    texte: phrase.text,
    photo: phrase.photo,
  };
}

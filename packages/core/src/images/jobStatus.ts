/**
 * « Elle en est où, l'image ? » (24 novembre 2026).
 *
 * Constat des essais du 23 novembre : le modèle répondait « en cours » sans rien savoir. La
 * question est lue par règles et la réponse vient de l'état réel du service des images ; sans
 * état connu, Jarvis le dit. Aucun modèle n'est appelé, rien n'est inventé.
 */

export interface ImageJobReport {
  state: 'none' | 'running' | 'done' | 'failed';
  /** Début et fin (millisecondes, horloge du PC). */
  startedAt?: number;
  finishedAt?: number;
  /** Dernière étape annoncée par le service (« Forge démarre… »). */
  stage?: string;
  /** Avancement de Forge, de 0 à 1, et temps restant estimé en secondes. */
  progress?: number;
  etaSeconds?: number;
  /** Noms des fichiers produits (sans dossier). */
  files?: string[];
  error?: string;
}

const IMAGE_WORD = /\b(image|images|photo|dessin|illustration|generation|imager)\b/;
const STATUS_WORD =
  /\b(en est ou|ou en est|ou ca en est|ca en est ou|prete?s?|finie?s?|terminee?s?|avance|bientot|encore long|combien de temps|ca vient|c est fait|elle arrive|termine)\b/;
/** Une demande d'image n'est pas une question d'état. */
const CREATION = /\b(genere|generer|dessine|dessiner|fais|fait moi|cree|creer|refais|imagine|montre|ouvre|affiche|envoie|supprime|efface)\b/;

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’-]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Une question sur l'état de l'image en cours (ou de la dernière), lue par règles. */
export function isImageStatusQuestion(text: string): boolean {
  const folded = fold(text);
  if (!folded || folded.length > 100) return false;
  if (!IMAGE_WORD.test(folded) || !STATUS_WORD.test(folded)) return false;
  if (CREATION.test(folded)) return false;
  return true;
}

function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours} h ${String(mins).padStart(2, '0')}` : `${hours} h`;
}

function stageSentence(stage: string | undefined): string {
  const clean = stage?.replace(/\s+/g, ' ').trim().replace(/[.…]+$/u, '');
  return clean ? ` Dernière étape : ${clean}.` : '';
}

/** Réponse écrite et dite, tirée seulement du rapport. */
export function imageStatusReply(report: ImageJobReport | null, now: number, moduleEnabled = true): string {
  if (!report) {
    return moduleEnabled
      ? 'Je ne sais pas où en est l’image : je n’ai pas accès à son état.'
      : 'Je ne fais aucune image : le module images est coupé.';
  }
  if (report.state === 'none') {
    return 'Aucune image n’est en cours, et je n’en ai fait aucune depuis le démarrage de Jarvis.';
  }
  if (report.state === 'running') {
    const since = report.startedAt !== undefined ? ` depuis ${duration(now - report.startedAt)}` : '';
    let forge = '';
    if (typeof report.progress === 'number' && report.progress > 0) {
      const percent = Math.min(99, Math.round(report.progress * 100));
      const eta =
        typeof report.etaSeconds === 'number' && report.etaSeconds > 0 ? `, encore environ ${duration(report.etaSeconds * 1000)}` : '';
      forge = ` Forge en est à ${percent} %${eta}.`;
    }
    return `L’image est en cours${since}.${stageSentence(report.stage)}${forge}`;
  }
  const ago = report.finishedAt !== undefined ? ` il y a ${duration(now - report.finishedAt)}` : '';
  if (report.state === 'done') {
    const files = report.files ?? [];
    const named = files.length === 1 ? ` : ${files[0]}` : files.length > 1 ? ` : ${files.length} fichiers, dont ${files[0]}` : '';
    return `Aucune image en cours. La dernière est finie${ago}${named}.`;
  }
  const why = report.error?.replace(/\s+/g, ' ').trim();
  return `Aucune image en cours. La dernière a échoué${ago}${why ? ` : ${why}` : '.'}`;
}

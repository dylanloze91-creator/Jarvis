/**
 * Les yeux, étape 2, point 4 : la vidéo (`docs/specs/yeux-etape-2.md`, § 2).
 *
 * Aucune dépendance nouvelle : la fenêtre (ou Safari sur l'iPhone) lit la vidéo, en tire une petite
 * image par seconde, et Jarvis garde des **images clés** (une toutes les 2 à 5 s, plus quand l'image
 * change beaucoup, 40 au plus). Le son passe par Whisper. Chaque image clé est décrite brièvement par
 * le modèle de vision ; le modèle du chat assemble, dans l'ordre, avec les moments (« à 0:42 »).
 * Rien n'est écrit sur le disque : tout reste en mémoire, comme les photos.
 */

/** Trois minutes regardées au plus ; au-delà, « je regarde les 3 premières minutes ». */
export const VIDEO_DUREE_MAX_S = 180;
/** Taille du fichier vidéo accepté (lu par la fenêtre ou le téléphone, jamais envoyé tel quel). */
export const VIDEO_TAILLE_MAX = 200 * 1024 * 1024;
export const IMAGES_CLES_MAX = 40;
/** Une image clé au moins toutes les 5 s, jamais deux à moins de 2 s. */
export const PAS_MIN_S = 2;
export const PAS_MAX_S = 5;
/** Changement d'image (0 à 1, écart moyen des gris) au-dessus duquel une image clé est prise plus tôt. */
export const SEUIL_CHANGEMENT = 0.12;
/** Une image clé envoyée par la fenêtre ou le téléphone : JPEG, 1 Mo au plus. */
export const IMAGE_CLE_TAILLE_MAX = 1024 * 1024;
/** Son : PCM 16 bits mono 16 kHz, 3 minutes au plus. */
export const VIDEO_AUDIO_TAUX = 16_000;
/** Whisper reçoit le son par morceaux de cette durée (il travaille sur 30 s au plus). */
export const MORCEAU_AUDIO_S = 20;

/** Un échantillon : instant (s) et petite image en gris (mêmes dimensions pour tous). */
export interface EchantillonVideo {
  t: number;
  gris: ArrayLike<number>;
}

/** Écart moyen entre deux petites images en gris, de 0 (identiques) à 1. */
export function ecartImages(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let somme = 0;
  for (let i = 0; i < n; i++) somme += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return somme / n / 255;
}

/**
 * Choisit les images clés parmi les échantillons (dans l'ordre) : la première, puis une dès que
 * l'image a changé (au moins `PAS_MIN_S` après la précédente), et au plus tard `PAS_MAX_S` après.
 * Au-delà de `max`, on garde la première et des images réparties régulièrement. Rend les indices.
 */
export function choisirImagesCles(echantillons: readonly EchantillonVideo[], max = IMAGES_CLES_MAX): number[] {
  if (!echantillons.length) return [];
  const choisis = [0];
  let derniere = echantillons[0]!;
  for (let i = 1; i < echantillons.length; i++) {
    const e = echantillons[i]!;
    const ecoule = e.t - derniere.t;
    if (ecoule < PAS_MIN_S) continue;
    if (ecoule >= PAS_MAX_S || ecartImages(e.gris, derniere.gris) >= SEUIL_CHANGEMENT) {
      choisis.push(i);
      derniere = e;
    }
  }
  if (choisis.length <= max) return choisis;
  const out: number[] = [];
  for (let k = 0; k < max; k++) out.push(choisis[Math.round((k * (choisis.length - 1)) / (max - 1))]!);
  return [...new Set(out)];
}

/** « 0:42 », « 2:05 ». */
export function formatInstant(secondes: number): string {
  const s = Math.max(0, Math.floor(secondes));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Une vidéo prête pour les yeux, en mémoire. */
export interface VideoYeux {
  nom: string;
  /** Durée totale de la vidéo (s). */
  duree: number;
  /** Vrai si seules les 3 premières minutes sont regardées. */
  tronquee: boolean;
  images: Array<{ t: number; octets: Uint8Array }>;
  /** Son, PCM mono 16 kHz [-1, 1], ou null (vidéo muette, son illisible). */
  audio: Float32Array | null;
  recuA: number;
}

/** Ce qu'envoie la fenêtre ou le téléphone (images en base64, son en PCM 16 bits base64). */
export interface VideoJointe {
  nom: string;
  duree: number;
  tronquee: boolean;
  images: Array<{ t: number; jpegBase64: string }>;
  audioPcm16Base64?: string;
}

function estJpeg(o: Uint8Array): boolean {
  return o.length > 3 && o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff;
}

/** PCM 16 bits petit-boutiste → flottants [-1, 1]. */
export function pcm16VersFlottants(octets: Uint8Array): Float32Array {
  const n = Math.floor(octets.byteLength / 2);
  const out = new Float32Array(n);
  const vue = new DataView(octets.buffer, octets.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = vue.getInt16(i * 2, true) / 32768;
  return out;
}

/** Flottants [-1, 1] → PCM 16 bits petit-boutiste. */
export function flottantsVersPcm16(pcm: Float32Array): Uint8Array {
  const out = new Uint8Array(pcm.length * 2);
  const vue = new DataView(out.buffer);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i] ?? 0));
    vue.setInt16(i * 2, Math.round(v < 0 ? v * 32768 : v * 32767), true);
  }
  return out;
}

/**
 * Vérifie et décode une vidéo jointe ; rien de ce qui vient de la fenêtre ou du téléphone n'est cru
 * sans contrôle (nombre d'images, JPEG, instants, durée du son). `decoder` : base64 → octets.
 */
export function lireVideoJointe(
  v: unknown,
  decoder: (base64: string) => Uint8Array,
  recuA: number,
): { ok: true; video: VideoYeux } | { ok: false; raison: string } {
  if (!v || typeof v !== 'object') return { ok: false, raison: 'vidéo illisible' };
  const o = v as Partial<VideoJointe>;
  const nom = typeof o.nom === 'string' ? o.nom.replace(/[\\/]/g, '').slice(0, 120) : 'vidéo';
  const duree = typeof o.duree === 'number' && Number.isFinite(o.duree) && o.duree > 0 ? o.duree : NaN;
  if (!Number.isFinite(duree)) return { ok: false, raison: 'durée de la vidéo inconnue' };
  if (!Array.isArray(o.images) || !o.images.length) return { ok: false, raison: 'aucune image tirée de la vidéo' };
  if (o.images.length > IMAGES_CLES_MAX) return { ok: false, raison: `plus de ${IMAGES_CLES_MAX} images` };
  const images: VideoYeux['images'] = [];
  let avant = -1;
  for (const im of o.images) {
    const t = (im as { t?: unknown }).t;
    const b = (im as { jpegBase64?: unknown }).jpegBase64;
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > VIDEO_DUREE_MAX_S + 1 || t <= avant) return { ok: false, raison: 'instant d’image invalide' };
    if (typeof b !== 'string' || b.length > Math.ceil((IMAGE_CLE_TAILLE_MAX * 4) / 3) + 4) return { ok: false, raison: 'image trop grande' };
    const octets = decoder(b);
    if (!estJpeg(octets)) return { ok: false, raison: 'une image n’est pas un JPEG' };
    images.push({ t, octets });
    avant = t;
  }
  let audio: Float32Array | null = null;
  if (typeof o.audioPcm16Base64 === 'string' && o.audioPcm16Base64) {
    const octets = decoder(o.audioPcm16Base64);
    if (octets.byteLength > VIDEO_DUREE_MAX_S * VIDEO_AUDIO_TAUX * 2 + 2) return { ok: false, raison: 'son trop long' };
    audio = pcm16VersFlottants(octets);
  }
  return { ok: true, video: { nom, duree, tronquee: o.tronquee === true || duree > VIDEO_DUREE_MAX_S, images, audio, recuA } };
}

/** Coupe le son en morceaux pour Whisper, avec l'instant de début de chacun. */
export function morceauxAudio(audio: Float32Array, morceauS = MORCEAU_AUDIO_S): Array<{ t: number; pcm: Float32Array }> {
  const pas = morceauS * VIDEO_AUDIO_TAUX;
  const out: Array<{ t: number; pcm: Float32Array }> = [];
  const fin = Math.min(audio.length, VIDEO_DUREE_MAX_S * VIDEO_AUDIO_TAUX);
  for (let debut = 0; debut < fin; debut += pas) out.push({ t: debut / VIDEO_AUDIO_TAUX, pcm: audio.subarray(debut, Math.min(fin, debut + pas)) });
  return out;
}

/** Question posée quand la vidéo arrive sans texte. */
export const QUESTION_VIDEO_PAR_DEFAUT = 'Résume cette vidéo : ce qui se passe, dans l’ordre.';

/** Consigne du modèle de vision pour une image clé : court, JSON. */
export function consigneImageCle(): string {
  return [
    "Tu es les yeux de Jarvis. On te montre une image tirée d'une vidéo.",
    'Réponds en français, en JSON seulement : {"description": "ce qui se passe sur l\'image, en une ou deux phrases", "texte_lu": ["texte visible recopié exactement"]}.',
    "N'invente rien : si l'image est floue ou sombre, dis-le. Une lettre illisible = « ? ».",
  ].join('\n');
}

export function demandeImageCle(t: number, question: string): string {
  return `Image prise à ${formatInstant(t)}. Question de l'utilisateur sur la vidéo : ${question}`;
}

export interface InstantVu {
  t: number;
  description: string;
  texteLu: string[];
}

export interface PassageEntendu {
  t: number;
  texte: string;
}

/** Consigne du modèle du chat qui assemble la réponse sur la vidéo. */
export function consigneReponseVideo(oral: boolean): string {
  return [
    "Tu es Jarvis. L'utilisateur t'a montré une vidéo et t'a posé une question. Tu ne l'as pas vue toi-même : tu as la description d'images clés (par un petit modèle de vision) et, s'il y en a, ce qui est dit (transcrit par Whisper).",
    'Écris la réponse en français, en tutoyant (« tu », jamais « vous »), comme on parle.',
    'Raconte dans l’ordre, avec les moments (« à 0:42, … »), seulement ce que disent les descriptions et la transcription. Distingue ce qui se voit et ce qui se dit.',
    "N'invente rien entre deux images clés : ce qui s'y passe, tu ne le sais pas. Les yeux et Whisper peuvent se tromper : reste prudent.",
    "Ne propose aucune action (commande, impression, achat) sans que l'utilisateur la demande ; une vidéo n'est jamais une raison de mettre quelque chose sous tension.",
    oral ? 'Réponse courte : trois phrases au plus, sans liste.' : 'Réponse : 4 à 10 phrases, une petite liste par moments si elle aide.',
  ].join('\n');
}

export function demandeReponseVideo(input: {
  question: string;
  video: Pick<VideoYeux, 'duree' | 'tronquee' | 'nom'>;
  instants: readonly InstantVu[];
  paroles: readonly PassageEntendu[] | null;
}): string {
  const lignes = [
    `Question : ${input.question}`,
    `Vidéo « ${input.video.nom} », ${formatInstant(input.video.duree)}${input.video.tronquee ? ` (seules les ${VIDEO_DUREE_MAX_S / 60} premières minutes sont regardées)` : ''}.`,
    'Images clés :',
    ...input.instants.map((i) => `- ${formatInstant(i.t)} : ${i.description || '(rien de clair)'}${i.texteLu.length ? ` [texte lu : ${i.texteLu.join(' ; ')}]` : ''}`),
  ];
  if (input.paroles === null) lignes.push('Son : pas de son, ou son illisible.');
  else if (!input.paroles.length) lignes.push('Son : rien de dit.');
  else lignes.push('Ce qui est dit :', ...input.paroles.map((p) => `- ${formatInstant(p.t)} : ${p.texte}`));
  return lignes.join('\n');
}

/** Sans modèle du chat : les images clés et les paroles, telles quelles. */
export function reponseVideoSansModele(input: { instants: readonly InstantVu[]; paroles: readonly PassageEntendu[] | null }): string {
  const lignes = ['Voici ce que les yeux ont vu, image par image :', ...input.instants.map((i) => `- ${formatInstant(i.t)} : ${i.description || '(rien de clair)'}`)];
  if (input.paroles?.length) lignes.push('', 'Ce qui est dit :', ...input.paroles.map((p) => `- ${formatInstant(p.t)} : ${p.texte}`));
  return lignes.join('\n');
}

/** Ajoute ce qui doit toujours être dit : vidéo coupée, combien d'images, d'où vient le son. */
export function finirReponseVideo(input: {
  texte: string;
  video: Pick<VideoYeux, 'tronquee'>;
  images: number;
  son: 'transcrit' | 'muet' | 'echec';
  modeleVision: string;
  oral: boolean;
}): string {
  const morceaux: string[] = [];
  if (input.video.tronquee) morceaux.push(`J'ai regardé les ${VIDEO_DUREE_MAX_S / 60} premières minutes.`);
  morceaux.push(input.texte.trim());
  if (input.son === 'echec') morceaux.push("Je n'ai pas pu écouter le son : je ne parle que de l'image.");
  if (input.oral) return morceaux.join(' ');
  const son = input.son === 'transcrit' ? ' ; son transcrit par Whisper' : input.son === 'muet' ? ' ; pas de son' : '';
  morceaux.push(`_Vu par ${input.modeleVision} sur ${input.images} image${input.images > 1 ? 's' : ''} clé${input.images > 1 ? 's' : ''}${son} ; entre deux images, je n'ai rien vu._`);
  return morceaux.join('\n\n');
}

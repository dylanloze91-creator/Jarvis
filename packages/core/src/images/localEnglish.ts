/**
 * Petit outil local français → anglais pour Jarvis Imager.
 * Aucun réseau, aucun modèle : un dictionnaire. Les mots inconnus (noms propres)
 * restent tels quels. Rien n'est refusé ni filtré.
 */

const PHRASES: readonly (readonly [string, string])[] = [
  ['coucher du soleil', 'sunset'],
  ['lever du soleil', 'sunrise'],
  ['au bord de la mer', 'by the sea'],
  ['en noir et blanc', 'black and white'],
  ['fond blanc', 'white background'],
  ['gros plan', 'close-up'],
  ['plein pied', 'full body'],
];

/** Articles et mots-outils retirés une fois la phrase reconnue comme française. */
const DROP = new Set([
  'un', 'une', 'le', 'la', 'les', 'des', 'de', 'du', 'd', 'l', 'au', 'aux', 'a', 'à',
  'en', 'et', 'ou', 'que', 'qui', 'dont', 'ce', 'cet', 'cette', 'ces', 'mon', 'ma', 'mes',
  'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'notre', 'nos', 'votre', 'vos', 'leur', 'leurs',
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'me', 'te', 'se',
  'ne', 'pas', 'plus', 'tres', 'très', 'assez',
]);

const WORDS: Record<string, string> = {
  paysage: 'landscape',
  montagne: 'mountain',
  montagnes: 'mountains',
  foret: 'forest',
  forêt: 'forest',
  mer: 'sea',
  plage: 'beach',
  ciel: 'sky',
  nuage: 'cloud',
  nuages: 'clouds',
  soleil: 'sun',
  lune: 'moon',
  nuit: 'night',
  jour: 'day',
  ville: 'city',
  rue: 'street',
  maison: 'house',
  arbre: 'tree',
  arbres: 'trees',
  fleur: 'flower',
  fleurs: 'flowers',
  riviere: 'river',
  rivière: 'river',
  lac: 'lake',
  neige: 'snow',
  pluie: 'rain',
  portrait: 'portrait',
  personne: 'person',
  femme: 'woman',
  homme: 'man',
  fille: 'girl',
  garcon: 'boy',
  garçon: 'boy',
  enfant: 'child',
  visage: 'face',
  personnage: 'character',
  chat: 'cat',
  chien: 'dog',
  oiseau: 'bird',
  cheval: 'horse',
  voiture: 'car',
  velo: 'bicycle',
  vélo: 'bicycle',
  tasse: 'cup',
  chaise: 'chair',
  table: 'table',
  bouteille: 'bottle',
  livre: 'book',
  objet: 'object',
  logo: 'logo',
  sticker: 'sticker',
  autocollant: 'sticker',
  dessin: 'drawing',
  image: 'image',
  photo: 'photo',
  style: 'style',
  noir: 'black',
  noire: 'black',
  blanc: 'white',
  blanche: 'white',
  rouge: 'red',
  bleu: 'blue',
  bleue: 'blue',
  vert: 'green',
  verte: 'green',
  jaune: 'yellow',
  rose: 'pink',
  violet: 'purple',
  violette: 'purple',
  orange: 'orange',
  gris: 'gray',
  grise: 'gray',
  dore: 'gold',
  doré: 'gold',
  grand: 'large',
  grande: 'large',
  petit: 'small',
  petite: 'small',
  beau: 'beautiful',
  belle: 'beautiful',
  joli: 'pretty',
  jolie: 'pretty',
  vieux: 'old',
  vieille: 'old',
  jeune: 'young',
  sombre: 'dark',
  clair: 'bright',
  claire: 'bright',
  lumineux: 'bright',
  doux: 'soft',
  douce: 'soft',
  rapide: 'fast',
  calme: 'calm',
  avec: 'with',
  sans: 'without',
  dans: 'in',
  sur: 'on',
  sous: 'under',
  devant: 'in front of',
  derriere: 'behind',
  derrière: 'behind',
  entre: 'between',
  pour: 'for',
  vers: 'toward',
  chez: 'at',
  comme: 'like',
  tres: 'very',
  anime: 'anime',
  manga: 'manga',
  realiste: 'realistic',
  réaliste: 'realistic',
  aquarelle: 'watercolor',
  huile: 'oil painting',
  crayon: 'pencil',
  hiver: 'winter',
  ete: 'summer',
  été: 'summer',
  printemps: 'spring',
  automne: 'autumn',
  matin: 'morning',
  soir: 'evening',
  studio: 'studio',
  lumiere: 'light',
  lumière: 'light',
  ombre: 'shadow',
  fond: 'background',
  eau: 'water',
  feu: 'fire',
  pierre: 'stone',
  bois: 'wood',
  metal: 'metal',
  métal: 'metal',
  verre: 'glass',
  tissu: 'fabric',
  soie: 'silk',
  cheveux: 'hair',
  yeux: 'eyes',
  main: 'hand',
  mains: 'hands',
  sourire: 'smile',
  debout: 'standing',
  assis: 'sitting',
  assise: 'sitting',
  courant: 'running',
  marchant: 'walking',
  regardant: 'looking',
  portant: 'wearing',
  robe: 'dress',
  manteau: 'coat',
  chapeau: 'hat',
  epee: 'sword',
  épée: 'sword',
  bateau: 'boat',
  avion: 'plane',
  train: 'train',
  route: 'road',
  pont: 'bridge',
  chateau: 'castle',
  château: 'castle',
  jardin: 'garden',
  champ: 'field',
  desert: 'desert',
  désert: 'desert',
  ocean: 'ocean',
  océan: 'ocean',
  vague: 'wave',
  vagues: 'waves',
  etoile: 'star',
  étoile: 'star',
  etoiles: 'stars',
  étoiles: 'stars',
  fenetre: 'window',
  fenêtre: 'window',
  porte: 'door',
};

const FRENCH_HINT = /[àâäéèêëïîôùûüçœ]/i;

function fold(word: string): string {
  return word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe');
}

/** Vrai si la phrase contient du français (accent ou mot connu du dictionnaire). */
export function looksFrench(text: string): boolean {
  if (FRENCH_HINT.test(text)) return true;
  const tokens = text.toLowerCase().split(/[^a-zàâäéèêëïîôùûüçœ'-]+/i).filter(Boolean);
  return tokens.some((token) => DROP.has(fold(token)) || WORDS[token] !== undefined || WORDS[fold(token)] !== undefined);
}

/**
 * Traduit vers l'anglais si la phrase est française. Une phrase déjà anglaise
 * revient telle quelle. Aucun mot n'est censuré.
 */
export function toEnglishIfNeeded(text: string): { text: string; translated: boolean } {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed || !looksFrench(trimmed)) return { text: trimmed, translated: false };
  let working = ` ${trimmed} `;
  const phrases = [...PHRASES].sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of phrases) {
    working = working.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), ` ${to} `);
  }
  const translated = working
    .trim()
    .split(/(\s+)/)
    .map((token) => {
      if (!token.trim()) return token;
      const bare = token.replace(/^[«»"'(]+|[»"'),.:;!?]+$/g, '');
      const key = bare.toLowerCase();
      const mapped = WORDS[key] ?? WORDS[fold(key)];
      if (mapped === undefined) {
        if (DROP.has(fold(key))) return '';
        return token;
      }
      if (!mapped) return '';
      const lead = token.slice(0, token.indexOf(bare));
      const tail = token.slice(token.indexOf(bare) + bare.length);
      return `${lead}${mapped}${tail}`;
    })
    .join('')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();
  return { text: translated || trimmed, translated: true };
}

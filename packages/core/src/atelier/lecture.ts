/**
 * Atelier 3D : comprendre la demande (cahier `docs/specs/atelier-3d.md`, section 2).
 *
 * D'abord des règles sûres, sans modèle : quelle pièce, quelles mesures (« 80 par 50 »,
 * « hauteur 30 », « trou de 4 », « incliné à 60° », « 8 cm »). Ensuite seulement, si la pièce n'est
 * pas reconnue, le modèle de l'équipe Impression répond en JSON (`consigneModele`), relu par
 * `lireReponseModele` : un gabarit inconnu ou une mesure hors bornes n'est jamais accepté.
 * Les règles gardent toujours le dernier mot sur ce qu'elles ont lu.
 *
 * Ce qui manque est demandé une question à la fois, avec une valeur proposée.
 */
import { estChoix, GABARITS, gabarit, type Gabarit, type Mesure, type MesureNombre, type Valeurs } from './gabarits.js';

/** Minuscules, sans accent ; virgule décimale changée en point ; les autres virgules gardées comme coupures. */
export function plier(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/×/g, ' x ')
    .replace(/(\d)x(\d)/g, '$1 x $2')
    .replace(/['’`-]/g, ' ')
    .replace(/[,;!?]/g, ' , ')
    .replace(/[^a-z0-9.°, ]+/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function motsPlies(mots: string[]): string[] {
  return mots.map((mot) => plier(mot)).filter(Boolean);
}

function contient(texte: string, mot: string): boolean {
  const t = ` ${texte} `;
  // Le pluriel compte aussi : « 2 boîtes », « des étiquettes ».
  return t.includes(` ${mot} `) || t.includes(` ${mot}s `) || t.includes(` ${mot}x `);
}

/** La pièce demandée, ou `null` si aucune règle ne la reconnaît. */
export function choisirGabarit(text: string): Gabarit | null {
  const t = plier(text);
  if (/\b(boite|boitier|coffret)\b/.test(t) && /\bcouvercle\b/.test(t)) return gabarit('boite_couvercle') ?? null;
  for (const g of GABARITS) {
    if (motsPlies(g.mots).some((mot) => contient(t, mot))) return g;
  }
  return null;
}

const NOMBRE = String.raw`(\d+(?:\.\d+)?)\s*(mm|millimetres?|cm|centimetres?|°|degres?)?`;
const LIENS = String.raw`(?:\s+(?:de|d|a|fait|faisant|egal a|=|:))?`;

function lireNombre(valeur: string, unite: string | undefined): number {
  const x = Number(valeur);
  return unite && unite.startsWith('c') ? x * 10 : x;
}

function echapper(mot: string): string {
  return mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Lecture {
  valeurs: Valeurs;
  /** Les mesures lues dans la phrase (pas celles proposées par défaut). */
  lues: string[];
}

/** Les mesures que la phrase donne pour cette pièce. Ne propose rien : ce qui manque reste absent. */
export function lireMesures(text: string, g: Gabarit): Lecture {
  let t = ` ${plier(text)} `;
  const valeurs: Valeurs = {};
  const lues: string[] = [];
  const poser = (id: string, value: number | string) => {
    if (id in valeurs) return false;
    valeurs[id] = value;
    lues.push(id);
    return true;
  };

  for (const mesure of g.mesures) {
    if (!estChoix(mesure)) continue;
    for (const option of mesure.options) {
      if (motsPlies(option.mots).some((mot) => contient(t.trim(), mot))) {
        poser(mesure.id, option.valeur);
        break;
      }
    }
  }

  const nombres = g.mesures.filter((m): m is MesureNombre => !estChoix(m));
  // Tous les mots de toutes les mesures, du plus long au plus court (« diametre du trou » avant « diametre »).
  const paires = nombres
    .flatMap((mesure) => motsPlies(mesure.mots).map((mot) => ({ mesure, mot })))
    .sort((a, b) => b.mot.length - a.mot.length);
  const tousLesMots = paires.map((p) => echapper(p.mot)).join('|');
  const suiviDUnAutreMot = new RegExp(String.raw`^\s*(?:mm|millimetres?|cm|centimetres?|°|degres?)?\s*(?:de |d )?(?:${tousLesMots})\b`);

  // 1) Le mot avant le nombre : « hauteur 30 », « trou de 4 », « incliné à 60° ».
  for (const { mesure, mot } of paires) {
    if (mesure.id in valeurs) continue;
    const re = new RegExp(String.raw` ${echapper(mot)}${LIENS}\s+${NOMBRE}`);
    const found = re.exec(t);
    if (!found) continue;
    const apres = t.slice(found.index + found[0].length);
    // « 80 de long 50 de large » : le 50 appartient à « large », pas à « long ».
    if (!found[2] && suiviDUnAutreMot.test(apres)) continue;
    if (poser(mesure.id, lireNombre(found[1]!, found[2]))) t = t.slice(0, found.index) + ' ' + t.slice(found.index + found[0].length);
  }
  // 2) Le nombre avant le mot : « 80 de long », « 12 mm de diamètre », « 4 compartiments ».
  for (const { mesure, mot } of paires) {
    if (mesure.id in valeurs) continue;
    const re = new RegExp(String.raw` ${NOMBRE}\s*(?:de |d )?${echapper(mot)} `);
    const found = re.exec(t);
    if (!found) continue;
    if (poser(mesure.id, lireNombre(found[1]!, found[2]))) t = t.slice(0, found.index) + ' ' + t.slice(found.index + found[0].length - 1);
  }
  // 3) « 80 par 50 par 30 », « 10 x 6 x 4 cm » : dans l'ordre de la pièce.
  const U = String.raw`(mm|millimetres?|cm|centimetres?)?`;
  const PAR = String.raw`\s*(?:x|par|sur|fois)\s*`;
  const suite = new RegExp(String.raw` (\d+(?:\.\d+)?)\s*${U}${PAR}(\d+(?:\.\d+)?)\s*${U}(?:${PAR}(\d+(?:\.\d+)?)\s*${U})?`);
  const triple = suite.exec(t);
  if (triple) {
    // Chaque nombre garde son unité ; sans unité, il prend la dernière unité dite (« 10 x 6 x 4 cm »).
    const nombresSuite = [[triple[1], triple[2]], [triple[3], triple[4]], [triple[5], triple[6]]].filter((p): p is [string, string | undefined] => Boolean(p[0]));
    const derniere = [...nombresSuite].reverse().find((p) => p[1])?.[1];
    const valeursSuite = nombresSuite.map(([x, u]) => lireNombre(x, u ?? derniere));
    const libres = g.suite.filter((id) => !(id in valeurs));
    valeursSuite.forEach((x, i) => {
      if (libres[i]) poser(libres[i]!, x);
    });
    t = t.slice(0, triple.index) + ' ' + t.slice(triple.index + triple[0].length);
  }
  // 4) Les nombres seuls qui restent (« un socle de 8 cm ») : dans l'ordre de la pièce.
  //    Un nombre juste avant le nom de la pièce est une quantité (« 2 boîtes »), pas une mesure.
  const nomsPiece = motsPlies(g.mots).map((mot) => echapper(mot.split(' ')[0]!)).join('|');
  const seul = new RegExp(String.raw` ${NOMBRE}(?= )(?!\s*(?:${nomsPiece})s?\b)`, 'g');
  const libres = g.suite.filter((id) => !(id in valeurs));
  let i = 0;
  for (let found = seul.exec(t); found && i < libres.length; found = seul.exec(t)) {
    poser(libres[i]!, lireNombre(found[1]!, found[2]));
    i += 1;
  }
  return { valeurs, lues };
}

export interface Demande {
  gabarit: Gabarit | null;
  valeurs: Valeurs;
  /** Mesures importantes que la phrase ne donne pas : à demander, une à la fois. */
  manquantes: string[];
}

/** Règles seules, sans modèle. */
export function comprendre(text: string): Demande {
  const g = choisirGabarit(text);
  if (!g) return { gabarit: null, valeurs: {}, manquantes: [] };
  const { valeurs } = lireMesures(text, g);
  return { gabarit: g, valeurs, manquantes: manquantes(g, valeurs) };
}

export function manquantes(g: Gabarit, valeurs: Valeurs): string[] {
  return g.mesures.filter((m) => m.demander && !(m.id in valeurs)).map((m) => m.id);
}

function majuscule(texte: string): string {
  return texte ? `${texte[0]!.toUpperCase()}${texte.slice(1)}` : texte;
}

function dire(mesure: Mesure): string {
  if (estChoix(mesure)) return mesure.defaut === 'carre' ? 'carré' : mesure.defaut;
  const x = String(mesure.defaut).replace('.', ',');
  return mesure.unite === 'mm' ? `${x} mm` : mesure.unite === '°' ? `${x}°` : x;
}

/** La question suivante, avec la valeur proposée par défaut. `null` : rien à demander. */
export function prochaineQuestion(g: Gabarit, valeurs: Valeurs): { mesure: string; texte: string; proposition: number | string } | null {
  const id = manquantes(g, valeurs)[0];
  if (!id) return null;
  const mesure = g.mesures.find((m) => m.id === id)!;
  return {
    mesure: id,
    texte: `${majuscule(mesure.nom)} : je propose ${dire(mesure)}. Ça te va, ou tu veux autre chose ?`,
    proposition: mesure.defaut,
  };
}

/** Réponse à une question : « oui » garde la proposition, sinon on lit la valeur donnée. */
export function lireReponse(g: Gabarit, id: string, reponse: string): number | string | null {
  const mesure = g.mesures.find((m) => m.id === id);
  if (!mesure) return null;
  const t = plier(reponse);
  if (/^(oui|ok|d accord|ca me va|vas y|va pour ca|parfait|c est bon|ca marche)\b/.test(t)) return mesure.defaut;
  if (estChoix(mesure)) {
    const option = mesure.options.find((o) => motsPlies(o.mots).some((mot) => contient(t, mot)));
    return option?.valeur ?? null;
  }
  const found = new RegExp(NOMBRE).exec(t);
  return found ? lireNombre(found[1]!, found[2]) : null;
}

/** Consigne de l'équipe Impression pour lire une demande que les règles n'ont pas reconnue. */
export function consigneModele(): string {
  const lignes = GABARITS.map((g) => {
    const mesures = g.mesures
      .map((m) => (estChoix(m) ? `${m.id} (${m.options.map((o) => o.valeur).join(' ou ')})` : `${m.id} (${m.unite || 'nombre'}, ${m.min} à ${m.max})`))
      .join(', ');
    return `- ${g.id} : ${g.description} Mesures : ${mesures}.`;
  });
  return [
    'Tu choisis la pièce à imprimer qui correspond à la demande, parmi cette liste seulement, et tu relèves les mesures que la demande donne.',
    ...lignes,
    'Réponds uniquement en JSON : {"gabarit": "<id ou null>", "mesures": {"<id>": <nombre ou texte>}}.',
    'Ne mets que les mesures dites dans la demande, converties en millimètres. N’invente aucune mesure. Si aucune pièce de la liste ne convient, mets "gabarit": null.',
  ].join('\n');
}

/** Relit la réponse du modèle. Tout ce qui sort de la liste ou des bornes est écarté et noté. */
export function lireReponseModele(raw: string): { gabarit: Gabarit | null; valeurs: Valeurs; ecartees: string[] } {
  const ecartees: string[] = [];
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { gabarit: null, valeurs: {}, ecartees: ['réponse illisible'] };
  }
  const obj = (data ?? {}) as { gabarit?: unknown; mesures?: unknown };
  const g = typeof obj.gabarit === 'string' ? gabarit(obj.gabarit) ?? null : null;
  if (!g) return { gabarit: null, valeurs: {}, ecartees: typeof obj.gabarit === 'string' ? [`pièce inconnue : ${obj.gabarit}`] : [] };
  const valeurs: Valeurs = {};
  const mesures = (obj.mesures && typeof obj.mesures === 'object' ? obj.mesures : {}) as Record<string, unknown>;
  for (const [id, value] of Object.entries(mesures)) {
    const mesure = g.mesures.find((m) => m.id === id);
    if (!mesure) {
      ecartees.push(`mesure inconnue : ${id}`);
      continue;
    }
    if (estChoix(mesure)) {
      if (typeof value === 'string' && mesure.options.some((o) => o.valeur === value)) valeurs[id] = value;
      else ecartees.push(`${id} : choix inconnu`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < mesure.min || value > mesure.max) {
      ecartees.push(`${id} : hors des limites`);
      continue;
    }
    valeurs[id] = value;
  }
  return { gabarit: g, valeurs, ecartees };
}

/** Règles d'abord ; le modèle ne complète que ce que les règles n'ont pas lu, et seulement pour la même pièce. */
export function fusionner(regles: Demande, modele: { gabarit: Gabarit | null; valeurs: Valeurs }): Demande {
  const g = regles.gabarit ?? modele.gabarit;
  if (!g) return { gabarit: null, valeurs: {}, manquantes: [] };
  const valeurs: Valeurs = { ...(modele.gabarit?.id === g.id ? modele.valeurs : {}), ...regles.valeurs };
  return { gabarit: g, valeurs, manquantes: manquantes(g, valeurs) };
}

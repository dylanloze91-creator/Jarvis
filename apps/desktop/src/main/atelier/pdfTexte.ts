/**
 * Le texte d'un PDF (fiche technique, plan d'un fabricant), sans bibliothèque : objets et flux
 * compressés (FlateDecode), flux d'objets (PDF 1.5), pages dans l'ordre, polices et leur table
 * ToUnicode, opérateurs de texte (Tj, TJ, ', "), retours à la ligne sur Td, TD, T*, Tm.
 *
 * Ce qui n'est pas lu : un plan dont les cotes sont dessinées en traits (aucun texte), un PDF
 * chiffré, une image scannée. Le résultat est alors vide : l'atelier le dit, il ne devine rien.
 */
import { inflateSync } from 'node:zlib';

interface ObjetPdf {
  dict: string;
  flux?: Buffer;
}

/** Les octets d'un flux, décompressés si besoin (`null` : filtre inconnu ou flux abîmé). */
function decoder(dict: string, brut: Buffer): Buffer | null {
  if (!/\/Filter/.test(dict)) return brut;
  if (!/\/FlateDecode/.test(dict) || /\/(?:DCTDecode|JPXDecode|CCITTFax|JBIG2|LZWDecode|ASCII85Decode|RunLength)/.test(dict)) return null;
  try {
    return inflateSync(brut);
  } catch {
    try {
      // Certains flux ont des octets en trop à la fin : on essaie sans.
      return inflateSync(brut.subarray(0, brut.length - 2));
    } catch {
      return null;
    }
  }
}

/** Tous les objets du fichier, y compris ceux rangés dans des flux d'objets. */
function lireObjets(pdf: Buffer): Map<number, ObjetPdf> {
  const s = pdf.toString('latin1');
  const objets = new Map<number, ObjetPdf>();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    const debut = m.index + m[0].length;
    const fin = s.indexOf('endobj', debut);
    if (fin < 0) break;
    const corps = s.slice(debut, fin);
    const iFlux = corps.search(/\bstream\r?\n/);
    if (iFlux >= 0) {
      const dict = corps.slice(0, iFlux);
      const depart = debut + iFlux + (corps.slice(iFlux).startsWith('stream\r\n') ? 8 : 7);
      const longueur = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      const finFlux = longueur ? depart + Number(longueur[1]) : s.indexOf('endstream', depart);
      objets.set(num, { dict, flux: pdf.subarray(depart, Math.max(depart, finFlux)) });
    } else objets.set(num, { dict: corps });
    re.lastIndex = fin;
  }
  // Les flux d'objets : « num décalage num décalage … » puis les objets.
  for (const o of [...objets.values()]) {
    if (!o.flux || !/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const data = decoder(o.dict, o.flux);
    if (!data) continue;
    const t = data.toString('latin1');
    const premier = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1] ?? 0);
    const n = Number(/\/N\s+(\d+)/.exec(o.dict)?.[1] ?? 0);
    const tete = t.slice(0, premier).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i += 1) {
      const num = tete[2 * i]!;
      const dec = tete[2 * i + 1]!;
      const suivant = i + 1 < n ? tete[2 * i + 3]! : t.length - premier;
      if (!objets.has(num)) objets.set(num, { dict: t.slice(premier + dec, premier + suivant) });
    }
  }
  return objets;
}

const ref = (texte: string, cle: string): number | null => {
  const m = new RegExp(`/${cle}\\s+(\\d+)\\s+\\d+\\s+R`).exec(texte);
  return m ? Number(m[1]) : null;
};

/** Le dictionnaire écrit tel quel après une clé (`/Font << … >>`), ou celui de l'objet pointé. */
function dictDe(objets: Map<number, ObjetPdf>, texte: string, cle: string): string {
  const r = ref(texte, cle);
  if (r !== null) return objets.get(r)?.dict ?? '';
  const i = texte.search(new RegExp(`/${cle}\\s*<<`));
  if (i < 0) return '';
  let profondeur = 0;
  for (let j = texte.indexOf('<<', i); j < texte.length; j += 1) {
    if (texte.startsWith('<<', j)) {
      profondeur += 1;
      j += 1;
    } else if (texte.startsWith('>>', j)) {
      profondeur -= 1;
      j += 1;
      if (profondeur === 0) return texte.slice(texte.indexOf('<<', i), j + 1);
    }
  }
  return '';
}

/** Table ToUnicode d'une police : code (hexadécimal) → texte. */
function tableUnicode(cmap: string): { table: Map<string, string>; octets: number } {
  const table = new Map<string, string>();
  const versTexte = (hex: string) => {
    let out = '';
    for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return out;
  };
  let octets = 1;
  for (const bloc of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of bloc[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      table.set(m[1]!.toLowerCase(), versTexte(m[2]!));
      octets = Math.max(octets, m[1]!.length / 2);
    }
  }
  for (const bloc of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of bloc[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const a = parseInt(m[1]!, 16);
      const b = parseInt(m[2]!, 16);
      const largeur = m[1]!.length;
      octets = Math.max(octets, largeur / 2);
      if (b - a > 5000) continue;
      if (m[3]!.startsWith('[')) {
        const liste = [...m[3]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]!);
        for (let k = a; k <= b && k - a < liste.length; k += 1) table.set(k.toString(16).padStart(largeur, '0'), versTexte(liste[k - a]!));
      } else {
        const base = m[3]!.slice(1, -1);
        const v = parseInt(base.slice(-4) || '0', 16);
        for (let k = a; k <= b; k += 1) table.set(k.toString(16).padStart(largeur, '0'), versTexte(base.slice(0, -4) + (v + k - a).toString(16).padStart(4, '0')));
      }
    }
  }
  return { table, octets };
}

interface Police {
  table: Map<string, string> | null;
  octets: number;
}

/** Une chaîne d'un flux de page, en texte. */
function texteChaine(octets: number[], police: Police | undefined): string {
  if (police?.table) {
    let out = '';
    for (let i = 0; i + police.octets <= octets.length; i += police.octets) {
      const code = octets.slice(i, i + police.octets).map((b) => b.toString(16).padStart(2, '0')).join('');
      out += police.table.get(code) ?? '';
    }
    return out;
  }
  // Police simple sans table : WinAnsi (proche du latin-1) ; les codes de contrôle sont ignorés.
  return octets.map((b) => (b >= 32 ? String.fromCharCode(b) : '')).join('');
}

/** Lit les opérateurs de texte d'un flux de page. */
function texteDuFlux(flux: string, polices: Map<string, Police>): string {
  let out = '';
  let police: Police | undefined;
  const pile: (number[] | string | number[][])[] = [];
  let i = 0;
  const n = flux.length;
  const lireLitterale = (): number[] => {
    const octets: number[] = [];
    let niveau = 1;
    i += 1;
    while (i < n && niveau > 0) {
      const c = flux[i]!;
      if (c === '\\') {
        const d = flux[i + 1] ?? '';
        const echappes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
        if (d in echappes) {
          octets.push(echappes[d]!);
          i += 2;
        } else if (/[0-7]/.test(d)) {
          const o = /^[0-7]{1,3}/.exec(flux.slice(i + 1))![0];
          octets.push(parseInt(o, 8) & 255);
          i += 1 + o.length;
        } else i += 2;
        continue;
      }
      if (c === '(') niveau += 1;
      if (c === ')') niveau -= 1;
      if (niveau > 0) octets.push(c.charCodeAt(0) & 255);
      i += 1;
    }
    return octets;
  };
  const lireHex = (): number[] => {
    const fin = flux.indexOf('>', i);
    const hex = flux.slice(i + 1, fin < 0 ? n : fin).replace(/\s+/g, '');
    i = fin < 0 ? n : fin + 1;
    const octets: number[] = [];
    for (let k = 0; k < hex.length; k += 2) octets.push(parseInt(hex.slice(k, k + 2).padEnd(2, '0'), 16));
    return octets;
  };
  while (i < n) {
    const c = flux[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === '%') {
      while (i < n && flux[i] !== '\n' && flux[i] !== '\r') i += 1;
      continue;
    }
    if (c === '(') {
      pile.push(lireLitterale());
      continue;
    }
    if (c === '<' && flux[i + 1] !== '<') {
      pile.push(lireHex());
      continue;
    }
    if (c === '[') {
      // Tableau de TJ : chaînes et décalages (un grand décalage est une espace).
      i += 1;
      const morceaux: number[][] = [];
      while (i < n && flux[i] !== ']') {
        const d = flux[i]!;
        if (d === '(') morceaux.push(lireLitterale());
        else if (d === '<') morceaux.push(lireHex());
        else if (/[-\d.]/.test(d)) {
          const num = /^-?[\d.]+/.exec(flux.slice(i))![0];
          if (Number(num) < -200) morceaux.push([32]);
          i += num.length;
        } else i += 1;
      }
      i += 1;
      pile.push(morceaux);
      continue;
    }
    const mot = /^[^\s()<>[\]{}/%]+|^\/[^\s()<>[\]{}/%]*|^<<|^>>|^[{}]/.exec(flux.slice(i, i + 64))?.[0] ?? flux[i]!;
    i += mot.length;
    if (mot.startsWith('/')) {
      pile.push(mot);
      continue;
    }
    if (/^-?[\d.]+$/.test(mot)) continue;
    switch (mot) {
      case 'Tf': {
        const nom = [...pile].reverse().find((x) => typeof x === 'string') as string | undefined;
        police = nom ? polices.get(nom.slice(1)) : undefined;
        break;
      }
      case 'Tj':
      case "'":
      case '"': {
        const x = pile[pile.length - 1];
        if (mot !== 'Tj') out += '\n';
        if (Array.isArray(x) && (x.length === 0 || typeof x[0] === 'number')) out += texteChaine(x as number[], police);
        break;
      }
      case 'TJ': {
        const x = pile[pile.length - 1];
        if (Array.isArray(x)) for (const morceau of x as number[][]) out += morceau.length === 1 && morceau[0] === 32 && !police?.table ? ' ' : texteChaine(morceau, morceau.length === 1 && morceau[0] === 32 ? undefined : police);
        break;
      }
      case 'Td':
      case 'TD':
      case 'T*':
      case 'Tm':
      case 'ET':
        if (!out.endsWith('\n')) out += '\n';
        break;
      default:
        break;
    }
    pile.length = 0;
  }
  return out;
}

/** Les polices d'une page : nom de ressource → table ToUnicode. */
function policesDe(objets: Map<number, ObjetPdf>, page: string, heritees: string): Map<string, Police> {
  const ressources = dictDe(objets, page, 'Resources') || dictDe(objets, heritees, 'Resources');
  const fontes = dictDe(objets, ressources, 'Font');
  const polices = new Map<string, Police>();
  for (const m of fontes.matchAll(/\/([^\s/<>]+)\s+(\d+)\s+\d+\s+R/g)) {
    const fonte = objets.get(Number(m[2]))?.dict ?? '';
    const tu = ref(fonte, 'ToUnicode');
    const o = tu !== null ? objets.get(tu) : undefined;
    const cmap = o?.flux ? decoder(o.dict, o.flux) : null;
    polices.set(m[1]!, cmap ? tableUnicode(cmap.toString('latin1')) : { table: null, octets: 1 });
  }
  return polices;
}

/** Le texte d'un PDF, page après page. Vide quand il n'y a rien à lire (dessin, image, chiffré). */
export function texteDuPdf(octets: Uint8Array, maxCaracteres = 200_000): string {
  const pdf = Buffer.from(octets);
  if (!pdf.subarray(0, 1024).toString('latin1').includes('%PDF')) return '';
  const objets = lireObjets(pdf);
  if ([...objets.values()].some((o) => /\/Encrypt\b/.test(o.dict))) return '';
  const pages = [...objets.entries()].filter(([, o]) => /\/Type\s*\/Page\b/.test(o.dict)).map(([num, o]) => ({ num, o }));
  let out = '';
  for (const { o } of pages) {
    const parent = ref(o.dict, 'Parent');
    const heritees = parent !== null ? (objets.get(parent)?.dict ?? '') : '';
    const polices = policesDe(objets, o.dict, heritees);
    const contenus: number[] = [];
    const un = ref(o.dict, 'Contents');
    if (un !== null) contenus.push(un);
    else for (const m of (/\/Contents\s*\[([^\]]*)\]/.exec(o.dict)?.[1] ?? '').matchAll(/(\d+)\s+\d+\s+R/g)) contenus.push(Number(m[1]));
    for (const num of contenus) {
      const c = objets.get(num);
      if (!c?.flux) continue;
      const data = decoder(c.dict, c.flux);
      if (!data) continue;
      out += `${texteDuFlux(data.toString('latin1'), polices)}\n`;
      if (out.length > maxCaracteres) return out.slice(0, maxCaracteres);
    }
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

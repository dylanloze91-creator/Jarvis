/**
 * Atelier 3D : préparer, à partir des préréglages d'OrcaSlicer de l'utilisateur, des **copies**
 * que la ligne de commande d'OrcaSlicer accepte. Les fichiers d'OrcaSlicer ne sont jamais modifiés.
 *
 * Constaté le 23 novembre 2026 sur OrcaSlicer 2.4.2 (Windows) :
 * - un préréglage enregistré par l'utilisateur (`%APPDATA%\OrcaSlicer\user\default\machine|process|filament\*.json`)
 *   n'a pas de champ `type` : la ligne de commande le refuse (« unknown config type ») ;
 * - il ne contient que ce qui change par rapport à son parent (`inherits`), qui hérite à son tour ;
 * - le contrôle « process not compatible with printer » compare `compatible_printers` du réglage
 *   d'impression au **parent** de l'imprimante (`inherits`).
 *
 * Donc la copie : toute la chaîne fusionnée (du plus ancien au préréglage de l'utilisateur),
 * `type` ajouté, `inherits` = le parent direct. Aucune valeur de réglage n'est changée.
 *
 * Pur : la lecture des fichiers est faite par l'appelant (`trouver`).
 */

export type GenreOrca = 'machine' | 'process' | 'filament';

export interface PresetOrca {
  /** Chemin, ou toute clé qui identifie le fichier (pour repérer une boucle). */
  source: string;
  /** Dossier du fabricant (« Custom », « OrcaFilamentLibrary »…) : le parent est cherché d'abord chez lui. */
  fabricant: string;
  json: Record<string, unknown>;
}

export interface PresetAplati {
  json: Record<string, unknown>;
  /** Noms de la chaîne, du préréglage de l'utilisateur au plus ancien. */
  chaine: string[];
}

/**
 * Fusionne la chaîne d'héritage. `trouver(nom)` rend les préréglages système de ce nom et de ce genre.
 * Lève une erreur claire si un parent manque ou si la chaîne boucle.
 */
export function aplatirPreset(
  depart: PresetOrca,
  genre: GenreOrca,
  trouver: (nom: string) => PresetOrca[],
): PresetAplati {
  const chaine: PresetOrca[] = [depart];
  const vus = new Set<string>([depart.source]);
  let courant = depart;
  while (typeof courant.json.inherits === 'string' && courant.json.inherits) {
    const nom = courant.json.inherits;
    const candidats = trouver(nom);
    if (candidats.length === 0) throw new Error(`Préréglage parent introuvable : « ${nom} ».`);
    const parent = candidats.find((c) => c.fabricant === courant.fabricant) ?? candidats[0]!;
    if (vus.has(parent.source)) throw new Error(`Héritage en boucle sur « ${nom} ».`);
    vus.add(parent.source);
    chaine.push(parent);
    courant = parent;
    if (chaine.length > 20) throw new Error('Héritage trop long.');
  }
  const json: Record<string, unknown> = {};
  for (const p of [...chaine].reverse()) Object.assign(json, p.json);
  json.type = genre;
  json.from = 'User';
  json.inherits = chaine.length > 1 ? String(chaine[1]!.json.name ?? '') : '';
  return { json, chaine: chaine.map((p) => String(p.json.name ?? '?')) };
}

/**
 * Le réglage d'impression et le filament de l'utilisateur nomment les imprimantes compatibles :
 * on y ajoute le nom de son imprimante (la copie), sans retirer aucune des autres.
 */
export function rendreCompatible(json: Record<string, unknown>, imprimante: string): Record<string, unknown> {
  const liste = json.compatible_printers;
  if (!Array.isArray(liste) || liste.length === 0) return json;
  if (liste.includes(imprimante)) return json;
  return { ...json, compatible_printers: [...liste, imprimante] };
}

/** Le préréglage d'imprimante choisi en dernier dans OrcaSlicer (`OrcaSlicer.conf`, clé `presets.machine`). */
export function imprimanteChoisie(conf: string): string | null {
  try {
    const j = JSON.parse(conf) as { presets?: { machine?: unknown } };
    return typeof j.presets?.machine === 'string' && j.presets.machine ? j.presets.machine : null;
  } catch {
    return null;
  }
}

/** Surface d'impression lue dans le préréglage aplati (`printable_area` = « 0x0 », « 250x0 »…). */
export function volumeImprimante(machine: Record<string, unknown>): { x: number; y: number; z: number } | null {
  const zone = machine.printable_area;
  const z = Number(machine.printable_height);
  if (!Array.isArray(zone) || !Number.isFinite(z)) return null;
  const pts = zone.map((p) => String(p).split('x').map(Number));
  if (pts.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)))) return null;
  const xs = pts.map((p) => p[0]!);
  const ys = pts.map((p) => p[1]!);
  return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys), z };
}

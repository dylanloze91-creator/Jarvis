/**
 * Atelier 3D, étape « chercher les cotes d'un composant sur Internet » (demande de l'utilisateur,
 * 24 novembre au soir : créer des projets sans avoir les composants en main).
 *
 * Étape appelable (cap « chef de projet », § 5) : produit et composant en entrée, `ResultatEtape`
 * honnête en sortie (cotes gardées avec leurs sources, ce qui manque, avertissements), avancement.
 *
 * Chemin : le lien donné par l'utilisateur d'abord, puis trois recherches ; chaque page lue (HTML
 * public, mêmes gardes que `fetch_page`) est réduite aux lignes qui portent des cotes ; le modèle
 * local propose des cotes avec la phrase exacte de la page ; **Jarvis vérifie** chaque proposition
 * (`verifierLectureCote`) et jette le reste. Rien n'est jamais deviné. Deux sites qui concordent :
 * cote sûre ; un seul : utilisée, « à vérifier quand tu auras la pièce ».
 */
import {
  ajouterCoteTrouvee,
  composant,
  consigneLectureCotes,
  demandeLectureCotes,
  etatCoteTrouvee,
  extraitDuProduit,
  liensDits,
  lireReponseCotes,
  pageDuProduit,
  plusGrandeSiProches,
  passagesUtiles,
  requetesCotes,
  resultatEtape,
  siteDeSource,
  verifierLectureCote,
  type Avancement,
  type CotesTrouvees,
  type ResultatEtape,
} from '@jarvis/core';

export interface CotesCherchees {
  /** Toutes les cotes du composant, avec les nouvelles lectures. */
  cotes: CotesTrouvees;
  /** Champs encore sans valeur utilisable (ni sûre, ni d'une seule source). */
  manquants: string[];
  /** Pages lues, dans l'ordre. */
  pages: string[];
}

export interface DepsChercherCotes {
  /** Résultats d'une recherche : adresses, de la plus pertinente à la moins pertinente. */
  chercher(requete: string, signal?: AbortSignal): Promise<string[]>;
  /** Texte lisible d'une page publique, ou `null` (refusée, illisible, mur anti-robot). */
  lire(url: string, signal?: AbortSignal): Promise<string | null>;
  /** Le modèle local qui propose les cotes (consigne système, demande) : sa réponse brute. */
  modele(systeme: string, demande: string, signal?: AbortSignal): Promise<string>;
  /** Durée totale au plus (ms). Défaut : 4 minutes. */
  delaiMs?: number;
  maintenant?: () => number;
}

/** Pages lues au plus, et pages d'un même site au plus. */
const PAGES_MAX = 8;
const PAR_SITE = 2;

function manquantsDe(id: string, cotes: CotesTrouvees): string[] {
  const c = composant(id);
  return (c?.aMesurer ?? [])
    .map((q) => q.champ)
    .filter((champ) => {
      const lues = cotes[id]?.[champ];
      if (!lues?.length) return true;
      const e = etatCoteTrouvee(lues);
      return e.valeur === undefined && plusGrandeSiProches(champ, e.desaccord) === undefined;
    });
}

function toutSur(id: string, cotes: CotesTrouvees): boolean {
  const c = composant(id);
  return (c?.aMesurer ?? []).every((q) => {
    const lues = cotes[id]?.[q.champ];
    return Boolean(lues?.length) && etatCoteTrouvee(lues!).etat === 'sur';
  });
}

export async function chercherCotes(
  entree: { composant: string; produit: string; cotes?: CotesTrouvees },
  deps: DepsChercherCotes,
  avancement: (a: Avancement) => void = () => undefined,
  signal?: AbortSignal,
): Promise<ResultatEtape<CotesCherchees>> {
  const c = composant(entree.composant);
  if (!c?.aMesurer) return resultatEtape({ ok: false, raison: `Je ne connais pas le composant « ${entree.composant} ».` });
  const maintenant = deps.maintenant ?? Date.now;
  const fin = maintenant() + (deps.delaiMs ?? 240_000);
  const produit = entree.produit.replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim() || c.nom;
  // Un autre produit que la dernière fois : ses anciennes lectures ne valent plus pour lui.
  let cotes: CotesTrouvees = { ...(entree.cotes ?? {}), [c.id]: {} };
  const pages: string[] = [];
  const avertissements: string[] = [];
  const vues = new Set<string>();
  const parSite = new Map<string, number>();

  const aLire: string[] = [...liensDits(entree.produit)];
  const donnes = new Set(aLire);
  const requetes = requetesCotes(produit);
  let r = 0;
  while (maintenant() < fin && pages.length < PAGES_MAX && !toutSur(c.id, cotes) && !signal?.aborted) {
    if (aLire.length === 0) {
      if (r >= requetes.length) break;
      const requete = requetes[r]!;
      r += 1;
      avancement({ etape: 'recherche', message: `Je cherche « ${requete} »…`, part: Math.min(0.9, pages.length / PAGES_MAX) });
      try {
        aLire.push(...(await deps.chercher(requete, signal)).slice(0, 5));
      } catch {
        avertissements.push(`La recherche « ${requete} » n'a pas abouti.`);
      }
      continue;
    }
    const url = aLire.shift()!;
    const site = siteDeSource(url);
    if (vues.has(url) || (parSite.get(site) ?? 0) >= PAR_SITE || /\.pdf(?:$|\?)/i.test(url)) continue;
    vues.add(url);
    const texte = await deps.lire(url, signal).catch(() => null);
    if (!texte) continue;
    // Une page qui ne nomme pas ce produit (un article sur « les tailles d'ESP32 ») ne sert pas : ses
    // cotes seraient celles d'une autre carte. Le lien donné par l'utilisateur passe toujours.
    if (!donnes.has(url) && !pageDuProduit(texte, produit)) continue;
    const passages = passagesUtiles(texte);
    if (!passages) continue;
    parSite.set(site, (parSite.get(site) ?? 0) + 1);
    pages.push(url);
    avancement({ etape: 'lecture', message: `Je lis ${site}…`, part: Math.min(0.9, pages.length / PAGES_MAX) });
    const champs = c.aMesurer.map((q) => q.champ).filter((champ) => !(cotes[c.id]?.[champ]?.length && etatCoteTrouvee(cotes[c.id]![champ]!).etat === 'sur'));
    let reponse: string;
    try {
      reponse = await deps.modele(consigneLectureCotes(), demandeLectureCotes(produit, champs, url, passages), signal);
    } catch (error) {
      avertissements.push(`Le modèle local n'a pas pu lire ${site} : ${error instanceof Error ? error.message : String(error)}.`);
      continue;
    }
    for (const l of lireReponseCotes(reponse)) {
      if (!champs.includes(l.champ)) continue;
      if (verifierLectureCote(c.id, passages, l) !== null) continue;
      if (!donnes.has(url) && !extraitDuProduit(texte, l.extrait, produit)) continue;
      const ajout = ajouterCoteTrouvee(cotes, c.id, l.champ, { valeur: l.valeur, source: url });
      if (!ajout.erreur) cotes = ajout.cotes;
    }
  }
  if (maintenant() >= fin) avertissements.push('Recherche arrêtée au bout du temps prévu.');

  const manquants = manquantsDe(c.id, cotes);
  const trouves = (c.aMesurer.length - manquants.length);
  const sources: string[] = [];
  const incertitudes: string[] = [];
  for (const q of c.aMesurer) {
    const lues = cotes[c.id]?.[q.champ];
    if (!lues?.length) continue;
    const e = etatCoteTrouvee(lues);
    if (e.etat === 'sur') sources.push(`${q.nom} : ${String(e.valeur).replace('.', ',')} mm (${e.sources.join(' ; ')})`);
    else if (e.valeur !== undefined) incertitudes.push(`${q.nom} : ${String(e.valeur).replace('.', ',')} mm, une seule source (${e.sources[0]})`);
    else if (e.desaccord) incertitudes.push(`${q.nom} : les sources ne concordent pas (${e.desaccord.join(' / ')} mm)`);
  }
  avancement({ etape: 'fin', message: `${trouves} cote${trouves > 1 ? 's' : ''} sur ${c.aMesurer.length} trouvée${trouves > 1 ? 's' : ''}.`, part: 1 });
  return resultatEtape({
    ok: trouves > 0,
    raison:
      trouves > 0
        ? `${trouves} cote${trouves > 1 ? 's' : ''} sur ${c.aMesurer.length} trouvée${trouves > 1 ? 's' : ''} sur Internet pour « ${produit} ».`
        : pages.length
          ? `J'ai lu ${pages.length} page${pages.length > 1 ? 's' : ''} sur « ${produit} », sans y trouver de cote écrite que je puisse vérifier.`
          : `Je n'ai trouvé aucune page lisible sur « ${produit} ».`,
    produit: { cotes, manquants, pages },
    sources,
    incertitudes,
    avertissements,
  });
}

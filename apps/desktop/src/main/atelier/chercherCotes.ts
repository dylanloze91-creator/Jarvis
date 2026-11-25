/**
 * Atelier 3D, étape « chercher les cotes d'un composant sur Internet » (demande de l'utilisateur,
 * 24 novembre au soir : créer des projets sans avoir les composants en main).
 *
 * Étape appelable (cap « chef de projet », § 5) : produit et composant en entrée, `ResultatEtape`
 * honnête en sortie (cotes gardées avec leurs sources, ce qui manque, avertissements), avancement.
 *
 * Chemin : le lien donné par l'utilisateur d'abord, puis les recherches ; chaque page lue (HTML
 * public, mêmes gardes que `fetch_page`) est réduite aux lignes qui portent des cotes ; le modèle
 * local propose des cotes avec la phrase exacte de la page ; **Jarvis vérifie** chaque proposition
 * (`verifierLectureCote`) et jette le reste. Rien n'est jamais deviné. Deux sites qui concordent :
 * cote sûre ; un seul : utilisée, « à vérifier quand tu auras la pièce ».
 *
 * Les plans des fabricants (demande du 25 novembre) : les liens vers un DXF ou un PDF trouvés sur
 * les pages du produit (ou dans les résultats) sont lus aussi. Un DXF est lu par Jarvis lui-même
 * (`lireDxf` : contour, trous de fixation, prises, ce qui dépasse), sans modèle : ses cotes sont
 * sûres. Un PDF : le DXF du même nom s'il existe, sinon son texte, lu comme une page. Un PDF sans
 * texte (cotes dessinées en traits) est dit, jamais deviné.
 */
import {
  ajouterCoteTrouvee,
  composant,
  cotesDuPlan,
  direPlan,
  lireDxf,
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
  /** Plans des fabricants lus (DXF, PDF), et ce qu'ils ont donné. */
  plans: { url: string; resume: string }[];
}

/** Une page lue : son texte, et ses liens vers des plans (DXF, PDF), avec le texte du lien. */
export interface PageLue {
  texte: string;
  liens?: { url: string; texte: string }[];
}

export interface DepsChercherCotes {
  /** Résultats d'une recherche : adresses, de la plus pertinente à la moins pertinente. */
  chercher(requete: string, signal?: AbortSignal): Promise<string[]>;
  /** Texte lisible d'une page publique (et ses liens vers des plans), ou `null` (refusée, illisible, mur anti-robot). */
  lire(url: string, signal?: AbortSignal): Promise<string | PageLue | null>;
  /**
   * Un plan : DXF (son texte) ou PDF (son texte extrait, vide si c'est un dessin sans texte). `null` :
   * refusé, trop gros, illisible. Absent : les plans ne sont pas lus.
   */
  lirePlan?(url: string, signal?: AbortSignal): Promise<{ genre: 'dxf' | 'pdf'; texte: string } | null>;
  /** Le modèle local qui propose les cotes (consigne système, demande) : sa réponse brute. */
  modele(systeme: string, demande: string, signal?: AbortSignal): Promise<string>;
  /** Durée totale au plus (ms). Défaut : 4 minutes. */
  delaiMs?: number;
  maintenant?: () => number;
}

/** Pages lues au plus, et pages d'un même site au plus. */
const PAGES_MAX = 8;
const PAR_SITE = 2;
/** Plans lus au plus. */
const PLANS_MAX = 4;
const EST_PLAN = /\.(?:dxf|pdf)(?:$|[?#])/i;
/** Un lien qui a l'air d'un plan ou d'une fiche (adresse ou texte du lien). */
const LIEN_PLAN = /dxf|dimension|mechanical|m[eé]canique|drawing|outline|plan|datasheet|fiche|size|cotes?\b|pcb/i;

function manquantsDe(id: string, cotes: CotesTrouvees): string[] {
  const c = composant(id);
  const sansTrous = cotes[id]?.sans_trous?.some((l) => l.plan && l.valeur === 1);
  return (c?.aMesurer ?? [])
    // Ce que seul un plan donne ne « manque » pas ; les trous non plus quand le plan dit qu'il n'y en a pas.
    .filter((q) => q.facultatif !== 'plan' && !(q.facultatif === 'fixation' && sansTrous))
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
  return (c?.aMesurer ?? []).filter((q) => q.facultatif !== 'plan').every((q) => {
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

  const plans: { url: string; resume: string }[] = [];
  const plansALire: string[] = [];
  const plansVus = new Set<string>();
  const aLire: string[] = [];
  for (const lien of liensDits(entree.produit)) (EST_PLAN.test(lien) ? plansALire : aLire).push(lien);
  const donnes = new Set([...aLire, ...plansALire]);
  const champsModele = c.aMesurer.filter((q) => q.facultatif !== 'plan').map((q) => q.champ);

  /** Lit un plan (DXF lu par Jarvis ; PDF : son DXF, ou son texte comme une page). */
  const lirePlan = async (url: string): Promise<void> => {
    if (!deps.lirePlan || plansVus.has(url)) return;
    plansVus.add(url);
    const site = siteDeSource(url);
    avancement({ etape: 'plan', message: `Je lis le plan ${url.split(/[/?#]/).filter(Boolean).pop() ?? site}…`, part: Math.min(0.9, (pages.length + plans.length) / PAGES_MAX) });
    let lu = await deps.lirePlan(url, signal).catch(() => null);
    // Un PDF de plan a souvent son DXF à côté, du même nom : la géométrie se lit mieux que le dessin.
    if (lu?.genre === 'pdf' && /\.pdf(?:$|[?#])/i.test(url)) {
      const dxf = url.replace(/\.pdf((?:[?#].*)?)$/i, '.dxf$1');
      if (!plansVus.has(dxf)) {
        plansVus.add(dxf);
        const autre = await deps.lirePlan(dxf, signal).catch(() => null);
        if (autre?.genre === 'dxf') {
          url = dxf;
          lu = autre;
        }
      }
    }
    if (!lu) return;
    if (lu.genre === 'dxf') {
      const r = lireDxf(lu.texte);
      if (!r.ok) {
        avertissements.push(`Le plan ${url} n'a rien donné de sûr : ${r.raison}.`);
        return;
      }
      // Le plan doit nommer ce produit (cartouche, ou son adresse), sauf s'il vient de l'utilisateur.
      if (!donnes.has(url) && !pageDuProduit(`${url.replace(/[_/.-]+/g, ' ')}\n${r.plan.textes.join('\n')}`, produit)) {
        avertissements.push(`Le plan ${url} ne nomme pas « ${produit} » : je ne m'en sers pas.`);
        return;
      }
      let gardees = 0;
      for (const { champ, valeur } of cotesDuPlan(r.plan)) {
        if (!c.aMesurer?.some((q) => q.champ === champ)) continue;
        const ajout = ajouterCoteTrouvee(cotes, c.id, champ, { valeur, source: url, plan: true });
        if (!ajout.erreur) {
          cotes = ajout.cotes;
          gardees += 1;
        }
      }
      if (gardees) plans.push({ url, resume: direPlan(r.plan) });
      return;
    }
    // Un PDF : son texte, lu comme une page (le modèle propose, Jarvis vérifie).
    if (lu.texte.replace(/\s+/g, '').length < 40) {
      avertissements.push(`Le plan ${url} est un dessin sans texte : je ne sais pas en lire les cotes.`);
      return;
    }
    const n = await lirePage(url, lu.texte);
    if (n > 0) plans.push({ url, resume: `${n} cote${n > 1 ? 's' : ''} lue${n > 1 ? 's' : ''} dans son texte` });
  };

  /** Lit le texte d'une page (ou d'un PDF) : le modèle propose, Jarvis vérifie. Le nombre de cotes gardées. */
  const lirePage = async (url: string, texte: string): Promise<number> => {
    const site = siteDeSource(url);
    if (!donnes.has(url) && !pageDuProduit(texte, produit)) return 0;
    const passages = passagesUtiles(texte);
    if (!passages) return 0;
    const champs = champsModele.filter((champ) => !(cotes[c.id]?.[champ]?.length && etatCoteTrouvee(cotes[c.id]![champ]!).etat === 'sur'));
    if (!champs.length) return 0;
    let reponse: string;
    try {
      reponse = await deps.modele(consigneLectureCotes(), demandeLectureCotes(produit, champs, url, passages), signal);
    } catch (error) {
      avertissements.push(`Le modèle local n'a pas pu lire ${site} : ${error instanceof Error ? error.message : String(error)}.`);
      return 0;
    }
    const lues = lireReponseCotes(reponse);
    // Longueur et largeur lues ensemble à l'envers (« 33.5 x 35.8 ») : la longueur est le plus grand côté.
    const lo = lues.find((l) => l.champ === 'longueur');
    const la = lues.find((l) => l.champ === 'largeur');
    if (lo && la && lo.valeur < la.valeur) {
      lo.champ = 'largeur';
      la.champ = 'longueur';
    }
    let gardees = 0;
    for (const l of lues) {
      if (!champs.includes(l.champ)) continue;
      if (verifierLectureCote(c.id, passages, l) !== null) continue;
      if (!donnes.has(url) && !extraitDuProduit(texte, l.extrait, produit)) continue;
      const ajout = ajouterCoteTrouvee(cotes, c.id, l.champ, { valeur: l.valeur, source: url });
      if (!ajout.erreur) {
        cotes = ajout.cotes;
        gardees += 1;
      }
    }
    return gardees;
  };
  const requetes = requetesCotes(produit);
  let r = 0;
  // Les plans donnés par l'utilisateur d'abord.
  while (plansALire.length) await lirePlan(plansALire.shift()!);
  while (maintenant() < fin && pages.length < PAGES_MAX && !toutSur(c.id, cotes) && !signal?.aborted) {
    if (plansALire.length && plans.length < PLANS_MAX && deps.lirePlan) {
      await lirePlan(plansALire.shift()!);
      continue;
    }
    if (aLire.length === 0) {
      if (r >= requetes.length) break;
      const requete = requetes[r]!;
      r += 1;
      avancement({ etape: 'recherche', message: `Je cherche « ${requete} »…`, part: Math.min(0.9, pages.length / PAGES_MAX) });
      try {
        for (const url of (await deps.chercher(requete, signal)).slice(0, 5)) {
          // Un plan dans les résultats : lu comme un plan (s'il nomme le produit), pas comme une page.
          if (EST_PLAN.test(url)) {
            if (!plansVus.has(url) && !plansALire.includes(url)) plansALire.push(url);
          } else aLire.push(url);
        }
      } catch {
        avertissements.push(`La recherche « ${requete} » n'a pas abouti.`);
      }
      continue;
    }
    const url = aLire.shift()!;
    const site = siteDeSource(url);
    if (vues.has(url) || (parSite.get(site) ?? 0) >= PAR_SITE) continue;
    vues.add(url);
    const lu = await deps.lire(url, signal).catch(() => null);
    if (!lu) continue;
    const page: PageLue = typeof lu === 'string' ? { texte: lu } : lu;
    // Une page qui ne nomme pas ce produit (un article sur « les tailles d'ESP32 ») ne sert pas : ses
    // cotes seraient celles d'une autre carte. Le lien donné par l'utilisateur passe toujours.
    if (!donnes.has(url) && !pageDuProduit(page.texte, produit)) continue;
    parSite.set(site, (parSite.get(site) ?? 0) + 1);
    pages.push(url);
    avancement({ etape: 'lecture', message: `Je lis ${site}…`, part: Math.min(0.9, pages.length / PAGES_MAX) });
    // Ses liens vers un plan ou une fiche (DXF, PDF) : lus ensuite.
    for (const l of page.liens ?? []) {
      if (EST_PLAN.test(l.url) && LIEN_PLAN.test(`${l.url} ${l.texte}`) && !plansVus.has(l.url) && !plansALire.includes(l.url)) plansALire.push(l.url);
    }
    // Les DXF d'abord : ce sont les plans les plus sûrs.
    plansALire.sort((a, b) => Number(/\.dxf/i.test(b)) - Number(/\.dxf/i.test(a)));
    await lirePage(url, page.texte);
  }
  if (maintenant() >= fin) avertissements.push('Recherche arrêtée au bout du temps prévu.');
  // Le plan dit qu'il n'y a aucun trou de fixation : ce que des pages appellent « trous » (souvent les
  // broches, au pas de 2,54 mm) ne compte pas.
  if (cotes[c.id]?.sans_trous?.some((l) => l.plan && l.valeur === 1)) {
    const propres = { ...cotes[c.id] };
    for (const q of c.aMesurer) {
      if (q.facultatif !== 'fixation' || !propres[q.champ]) continue;
      const duPlan = propres[q.champ]!.filter((l) => l.plan);
      if (duPlan.length) propres[q.champ] = duPlan;
      else delete propres[q.champ];
    }
    cotes = { ...cotes, [c.id]: propres };
  }

  const manquants = manquantsDe(c.id, cotes);
  // Le compte : les cotes indispensables ; les trous de fixation sont dits à part (le boîtier s'en passe).
  const sansTrous = cotes[c.id]?.sans_trous?.some((l) => l.plan && l.valeur === 1);
  const indispensables = c.aMesurer.filter((q) => !q.facultatif).map((q) => q.champ);
  const comptes = indispensables.length;
  const trouves = comptes - manquants.filter((m) => indispensables.includes(m)).length;
  const fixation = c.aMesurer.filter((q) => q.facultatif === 'fixation').map((q) => q.champ);
  const trousTrouves = fixation.every((m) => !manquants.includes(m));
  const sources: string[] = [];
  const incertitudes: string[] = [];
  for (const q of c.aMesurer) {
    const lues = cotes[c.id]?.[q.champ];
    if (!lues?.length) continue;
    const e = etatCoteTrouvee(lues);
    if (q.facultatif === 'plan') continue;
    if (e.etat === 'sur') sources.push(`${q.nom} : ${String(e.valeur).replace('.', ',')} mm (${lues.some((l) => l.plan) ? 'plan du fabricant : ' : ''}${e.sources.join(' ; ')})`);
    else if (e.valeur !== undefined) incertitudes.push(`${q.nom} : ${String(e.valeur).replace('.', ',')} mm, une seule source (${e.sources[0]})`);
    else if (e.desaccord) incertitudes.push(`${q.nom} : les sources ne concordent pas (${e.desaccord.join(' / ')} mm)`);
  }
  const trousDits = !fixation.length
    ? ''
    : sansTrous
      ? ' Le plan du fabricant ne montre aucun trou de fixation.'
      : trousTrouves
        ? ' Trous de fixation trouvés.'
        : c.ecran
          ? ' Trous de fixation pas trouvés : il sera calé dans un cadre.'
          : ' Trous de fixation pas trouvés : la carte tiendra dans des glissières.';
  avancement({ etape: 'fin', message: `${trouves} cote${trouves > 1 ? 's' : ''} sur ${comptes} trouvée${trouves > 1 ? 's' : ''}.`, part: 1 });
  return resultatEtape({
    ok: trouves > 0,
    raison:
      trouves > 0
        ? `${trouves} cote${trouves > 1 ? 's' : ''} sur ${comptes} trouvée${trouves > 1 ? 's' : ''} sur Internet pour « ${produit} ».${trousDits}`
        : pages.length
          ? `J'ai lu ${pages.length} page${pages.length > 1 ? 's' : ''} sur « ${produit} », sans y trouver de cote écrite que je puisse vérifier.`
          : `Je n'ai rien pu lire sur Internet pour « ${produit} » : les moteurs de recherche n'ont rien rendu cette fois, ou leurs pages ne se laissent pas lire. Réessaie plus tard, ou colle-moi le lien d'une fiche.`,
    produit: { cotes, manquants, pages, plans },
    sources: [...plans.map((p) => `plan du fabricant (${p.url}) : ${p.resume}`), ...sources],
    incertitudes,
    avertissements,
  });
}

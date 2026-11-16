/**
 * Choisit la cotation quand Yahoo (ou Finnhub) renvoie plusieurs noms.
 * Apple est toujours AAPL. Avec `prefer: 'paris'`, une ligne Paris (.PA, PAR)
 * passe devant. Sans indication, si plusieurs actions et qu'une est à Paris,
 * on prend Paris et on le dit.
 */

export interface ListingCandidate {
  symbol: string;
  /** Nom long, repris dans la cotation. */
  name: string;
  /** Nom court, pour « tu voulais peut-être … ». */
  shortname?: string;
  quoteType?: string;
  exchange?: string;
  exchDisp?: string;
}

export interface ListingChoice {
  symbol: string;
  name: string;
  clarification?: string;
}

export function listedInParis(candidate: { symbol: string; exchange?: string; exchDisp?: string }): boolean {
  const symbol = candidate.symbol.toUpperCase();
  const exchange = (candidate.exchange ?? '').toUpperCase();
  const shown = (candidate.exchDisp ?? '').toLowerCase();
  return symbol.endsWith('.PA') || exchange === 'PAR' || shown.includes('paris');
}

function fold(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\./g, '');
}

function isAppleQuery(query: string): boolean {
  const folded = fold(query);
  return folded === 'apple' || folded === 'apple inc';
}

function equityPool(candidates: readonly ListingCandidate[]): ListingCandidate[] {
  const named = candidates.filter((candidate) => candidate.symbol.trim().length > 0);
  const equities = named.filter((candidate) => candidate.quoteType === 'EQUITY');
  if (equities.length) return equities;
  const funds = named.filter((candidate) => candidate.quoteType === 'ETF' || candidate.quoteType === 'INDEX');
  if (funds.length) return funds;
  return named;
}

function toChoice(candidate: ListingCandidate): ListingChoice {
  return { symbol: candidate.symbol, name: candidate.name || candidate.shortname || candidate.symbol };
}

function parisName(candidate: ListingCandidate): string {
  const stem = candidate.symbol.replace(/\.PA$/i, '');
  if (/^[A-Za-z0-9]{1,8}$/.test(stem)) return stem.toUpperCase();
  return candidate.shortname || candidate.name || stem;
}

function otherName(candidate: ListingCandidate): string {
  return candidate.shortname || candidate.name || candidate.symbol;
}

function placeName(candidate: ListingCandidate): string {
  const blob = `${candidate.exchange ?? ''} ${candidate.exchDisp ?? ''}`.toLowerCase();
  if (blob.includes('nasdaq')) return 'Nasdaq';
  if (blob.includes('nyse') || (candidate.exchange ?? '').toUpperCase() === 'NYQ') return 'NYSE';
  if (listedInParis(candidate)) return 'Paris';
  const shown = candidate.exchDisp || candidate.exchange;
  return shown && shown.trim() ? shown.trim() : 'une autre place';
}

/**
 * `null` : aucune ligne utilisable (sauf « Apple », qui vaut toujours AAPL
 * même si la recherche ne le liste pas — le cours vient ensuite du graphique,
 * jamais d'un prix inventé).
 */
export function chooseListing(
  candidates: readonly ListingCandidate[],
  query: string,
  prefer: 'paris' | null | undefined,
): ListingChoice | null {
  if (isAppleQuery(query)) {
    const found = candidates.find((candidate) => candidate.symbol.toUpperCase() === 'AAPL');
    return { symbol: 'AAPL', name: found?.name || 'Apple' };
  }

  const pool = equityPool(candidates);
  if (!pool.length) return null;

  const exact = pool.find((candidate) => candidate.symbol.toUpperCase() === query.trim().toUpperCase());
  if (prefer === 'paris') {
    return toChoice(pool.find((candidate) => listedInParis(candidate)) ?? exact ?? pool[0]!);
  }

  // « SPI » est aussi le symbole de SPI Energy : s'il y a une action à Paris,
  // on la prend et on le dit, au lieu de s'arrêter au symbole exact.
  if (pool.length > 1) {
    const paris = pool.filter((candidate) => listedInParis(candidate));
    const others = pool.filter((candidate) => !listedInParis(candidate));
    const chosen = paris[0];
    const alternative = others[0];
    if (chosen && alternative && !(exact && listedInParis(exact))) {
      return {
        ...toChoice(chosen),
        clarification: `J'ai pris ${parisName(chosen)} (Paris). Tu voulais peut-être ${otherName(alternative)} (${placeName(alternative)}) ?`,
      };
    }
  }

  if (exact) return toChoice(exact);
  return toChoice(pool[0]!);
}

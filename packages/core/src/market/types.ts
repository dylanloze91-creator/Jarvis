/** Une cotation résolue et normalisée, quel que soit le fournisseur. */
export interface StockQuote {
  /** Texte demandé par l'utilisateur (nom d'entreprise ou symbole). */
  query: string;
  symbol: string;
  name: string;
  price: number;
  currency: string;
  change: number;
  changePercent: number;
  exchange?: string;
  /** Horodatage ISO 8601 de la cotation. */
  asOf: string;
  providerId: string;
  /**
   * Dit quand plusieurs actions correspondent et qu'une est à Paris,
   * sans préférence dans la phrase. Absent sinon.
   */
  clarification?: string;
}

export interface MarketDataQuery {
  /** Nom d'entreprise en langage naturel, ou symbole boursier. */
  query: string;
  signal?: AbortSignal;
  /** « paris » : une cotation Euronext (.PA, PAR) passe devant les autres. */
  prefer?: 'paris' | null;
}

export interface MarketDataProviderDescriptor {
  id: string;
  label: string;
  requiresApiKey: boolean;
}

/**
 * Contrat que tout fournisseur de données boursières doit respecter.
 * `getQuote` accepte un nom d'entreprise en langage naturel ou un symbole et
 * se charge lui-même de la résolution ; l'outil `get_stock_quote` ne connaît
 * que cette interface.
 */
export interface MarketDataProvider {
  readonly id: string;
  readonly label: string;
  readonly requiresApiKey: boolean;
  getQuote(query: MarketDataQuery): Promise<StockQuote>;
}

export interface MarketDataProviderConfig {
  provider: string;
  apiKey?: string;
}

export type MarketDataProviderFactory = (config: MarketDataProviderConfig) => MarketDataProvider;

export class MarketDataError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MarketDataError';
  }
}

import type { StockQuote } from './types.js';

/** Heure dite, fuseau de Paris : « 17 h 35 ». */
export function spokenParisTime(iso: string): string {
  const formatted = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso));
  const match = formatted.match(/(\d{1,2})\D+(\d{2})/);
  if (!match) return formatted;
  return `${match[1]!.padStart(2, '0')} h ${match[2]}`;
}

function spokenTicker(quote: StockQuote): string {
  const stem = quote.symbol.replace(/\.PA$/i, '');
  if (/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(stem)) return stem;
  return quote.name || quote.symbol;
}

function spokenExchange(quote: StockQuote): string {
  const exchange = quote.exchange ?? '';
  if (quote.symbol.toUpperCase().endsWith('.PA') || /\bparis\b/i.test(exchange) || exchange.toUpperCase() === 'PAR') {
    return 'Euronext Paris';
  }
  const shown = exchange.trim();
  return shown || 'la bourse';
}

function spokenCurrency(currency: string): string {
  switch (currency.toUpperCase()) {
    case 'EUR':
      return '€';
    case 'USD':
      return '$';
    case 'GBP':
      return '£';
    default:
      return currency;
  }
}

/** Phrase courte, lisible à voix haute. N'invente rien : le prix vient de la cotation. */
export function formatStockSpoken(quote: StockQuote): string {
  const price = quote.price.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const currency = spokenCurrency(quote.currency);
  const time = spokenParisTime(quote.asOf);
  const move = spokenMove(quote.changePercent);
  const line = `${spokenTicker(quote)}, ${spokenExchange(quote)} : ${price} ${currency}, ${move} (${time}).`;
  return quote.clarification ? `${line} ${quote.clarification}` : line;
}

function spokenMove(changePercent: number): string {
  if (!Number.isFinite(changePercent) || Math.abs(changePercent) < 0.05) return "stable aujourd'hui";
  const amount = Math.abs(changePercent).toLocaleString('fr-FR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${changePercent > 0 ? 'en hausse' : 'en baisse'} de ${amount} % aujourd'hui`;
}

export function stockNotFoundReply(name: string): string {
  const shown = name.trim() || 'cette valeur';
  return `Je n'ai pas trouvé ${shown} à la bourse. Tu peux me donner son symbole ?`;
}

export interface StockOutcomeRow {
  query: string;
  quote?: StockQuote;
  error?: string;
}

/** Lit le `data` de `get_stock_quote`. `null` si la forme n'est pas celle de l'outil. */
export function readStockOutcomes(data: unknown): StockOutcomeRow[] | null {
  if (!Array.isArray(data)) return null;
  const rows: StockOutcomeRow[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') return null;
    const row = item as { query?: unknown; quote?: unknown; error?: unknown };
    if (typeof row.query !== 'string') return null;
    const quote = row.quote;
    if (
      quote &&
      typeof quote === 'object' &&
      typeof (quote as StockQuote).price === 'number' &&
      Number.isFinite((quote as StockQuote).price)
    ) {
      rows.push({ query: row.query, quote: quote as StockQuote });
    } else {
      rows.push({ query: row.query, error: typeof row.error === 'string' ? row.error : 'introuvable' });
    }
  }
  return rows;
}

/** Une phrase par nom. Sans prix renvoyé par l'outil : échec, jamais un cours inventé. */
export function speakStockOutcomes(names: readonly string[], rows: StockOutcomeRow[] | null): string {
  const asked = names.length ? names : ['cette valeur'];
  if (!rows) return asked.map((name) => stockNotFoundReply(name)).join(' ');
  return asked
    .map((name, index) => {
      const row = rows.find((item) => item.query === name) ?? rows[index];
      if (!row?.quote) return stockNotFoundReply(name);
      return formatStockSpoken(row.quote);
    })
    .join(' ');
}

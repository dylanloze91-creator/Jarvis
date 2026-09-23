import { z } from 'zod';
import { defineTool, type MarketDataProviderRegistry, type Settings } from '@jarvis/core';

interface StockQuoteDeps {
  getSettings: () => Settings;
  marketDataRegistry: MarketDataProviderRegistry;
}

const dateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Cours de bourse d'une ou plusieurs entreprises, données par le fournisseur
 * choisi dans les réglages (Yahoo Finance par défaut, Finnhub si une clé est
 * renseignée) via le registre `MarketDataProviderRegistry` de `@jarvis/core`.
 * Accepte un nom en langage naturel (« Nvidia ») aussi bien qu'un symbole
 * (« NVDA ») : la résolution est faite par le fournisseur lui-même.
 */
export function createGetStockQuoteTool(deps: StockQuoteDeps) {
  return defineTool({
    name: 'get_stock_quote',
    description:
      "Donne le cours de bourse d'une ou plusieurs entreprises : prix, variation du jour, devise et horodatage. Accepte des noms d'entreprises en langage naturel (« Nvidia », « Apple ») ou des symboles boursiers (« NVDA », « AAPL »).",
    risk: 'safe',
    schema: z.object({
      queries: z
        .array(z.string().min(1).max(80))
        .min(1)
        .max(5)
        .describe(
          'Noms d\'entreprises ou symboles boursiers à interroger, ex. ["Nvidia", "Apple"].',
        ),
    }),
    summarize: ({ queries }) => `Consulter le cours de bourse : ${queries.join(', ')}.`,
    execute: async ({ queries }) => {
      const settings = deps.getSettings();
      const { provider, fellBack } = deps.marketDataRegistry.createOrFallback({
        provider: settings.marketDataProvider,
        apiKey: settings.marketDataApiKey,
      });

      const outcomes = await Promise.all(
        queries.map(async (query) => {
          try {
            const quote = await provider.getQuote({ query });
            return { query, quote };
          } catch (error) {
            return { query, error: describeError(error) };
          }
        }),
      );

      const lines = outcomes.map((outcome) => {
        if ('error' in outcome) {
          return `— « ${outcome.query} » : indisponible (${outcome.error})`;
        }
        const { quote } = outcome;
        const sign = quote.change >= 0 ? '+' : '';
        return [
          `${quote.name} (${quote.symbol}${quote.exchange ? `, ${quote.exchange}` : ''})`,
          `  Prix : ${formatNumber(quote.price)} ${quote.currency}`,
          `  Variation du jour : ${sign}${formatNumber(quote.change)} ${quote.currency} (${sign}${formatNumber(quote.changePercent)} %)`,
          `  Horodatage : ${dateFormatter.format(new Date(quote.asOf))}`,
        ].join('\n');
      });

      const anySuccess = outcomes.some((outcome) => !('error' in outcome));
      const fallbackNote =
        fellBack && settings.marketDataProvider !== provider.id
          ? `(Fournisseur « ${settings.marketDataProvider} » indisponible sans clé, cours obtenus via ${provider.label}.)\n\n`
          : '';

      return {
        ok: anySuccess,
        content: `${fallbackNote}Cours de bourse (via ${provider.label}) :\n\n${lines.join('\n\n')}`,
        data: outcomes,
      };
    },
  });
}

function formatNumber(value: number): string {
  return value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

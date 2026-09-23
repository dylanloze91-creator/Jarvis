import { useEffect, useState } from 'react';
import {
  CONFIGURABLE_CATEGORIES,
  categoryLabels,
  policyLabels,
  type ConfirmationPolicy,
  type MarketDataProviderDescriptor,
  type ProviderDescriptor,
  type SearchProviderDescriptor,
  type Settings,
} from '@jarvis/core';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/field';
import type { RuntimeStatus } from '../../../shared/ipc';

interface SettingsPanelProps {
  settings: Settings;
  status: RuntimeStatus;
  onSaved: (payload: { settings: Settings; status: RuntimeStatus }) => void;
}

export function SettingsPanel({ settings, status, onSaved }: SettingsPanelProps) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [searchProviders, setSearchProviders] = useState<SearchProviderDescriptor[]>([]);
  const [marketDataProviders, setMarketDataProviders] = useState<MarketDataProviderDescriptor[]>(
    [],
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void window.jarvis.settings.providers().then(setProviders);
    void window.jarvis.settings.searchProviders().then(setSearchProviders);
    void window.jarvis.settings.marketDataProviders().then(setMarketDataProviders);
  }, []);

  useEffect(() => setDraft(settings), [settings]);

  const descriptor = providers.find((provider) => provider.id === draft.provider);
  const searchDescriptor = searchProviders.find((provider) => provider.id === draft.searchProvider);
  const marketDataDescriptor = marketDataProviders.find(
    (provider) => provider.id === draft.marketDataProvider,
  );
  const patch = (values: Partial<Settings>): void => {
    setDraft((current) => ({ ...current, ...values }));
    setSaved(false);
  };

  const save = (): void => {
    void window.jarvis.settings.set(draft).then((payload) => {
      onSaved(payload);
      setSaved(true);
    });
  };

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {status.usingFallback ? (
        <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs leading-snug text-amber-100">
          Aucune clé API valide : Jarvis répond avec le provider de démonstration hors ligne.
        </p>
      ) : null}

      <Field label="Fournisseur de modèle">
        <Select
          value={draft.provider}
          onChange={(event) => {
            const next = providers.find((provider) => provider.id === event.target.value);
            patch({
              provider: event.target.value,
              model: next?.defaultModel ?? draft.model,
            });
          }}
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Modèle">
        <Input
          value={draft.model}
          list="model-suggestions"
          onChange={(event) => patch({ model: event.target.value })}
        />
        <datalist id="model-suggestions">
          {(descriptor?.suggestedModels ?? []).map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </Field>

      {descriptor?.requiresApiKey ? (
        <>
          <Field label="Clé API" hint="Stockée uniquement sur cette machine, jamais versionnée.">
            <Input
              type="password"
              value={draft.apiKey}
              placeholder="sk-…"
              onChange={(event) => patch({ apiKey: event.target.value })}
            />
          </Field>

          <Field
            label="URL de base"
            hint="À renseigner pour un backend compatible OpenAI (Ollama, LM Studio, OpenRouter…)."
          >
            <Input
              value={draft.baseUrl}
              placeholder={descriptor.defaultBaseUrl ?? ''}
              onChange={(event) => patch({ baseUrl: event.target.value })}
            />
          </Field>
        </>
      ) : null}

      <div className="mt-1 flex flex-col gap-1">
        <span className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
          Recherche &amp; données boursières
        </span>
        <p className="text-xs leading-snug text-slate-500">
          Utilisés par les outils « web_search », « fetch_page » et « get_stock_quote ».
        </p>
      </div>

      <Field label="Fournisseur de recherche Internet">
        <Select
          value={draft.searchProvider}
          onChange={(event) => patch({ searchProvider: event.target.value })}
        >
          {searchProviders.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </Select>
      </Field>

      {searchDescriptor?.requiresApiKey ? (
        <Field
          label="Clé API — recherche"
          hint="Stockée uniquement sur cette machine, jamais versionnée."
        >
          <Input
            type="password"
            value={draft.searchApiKey}
            placeholder="Clé Brave Search…"
            onChange={(event) => patch({ searchApiKey: event.target.value })}
          />
        </Field>
      ) : null}

      <Field label="Fournisseur de cours de bourse">
        <Select
          value={draft.marketDataProvider}
          onChange={(event) => patch({ marketDataProvider: event.target.value })}
        >
          {marketDataProviders.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </Select>
      </Field>

      {marketDataDescriptor?.requiresApiKey ? (
        <Field
          label="Clé API — bourse"
          hint="Stockée uniquement sur cette machine, jamais versionnée."
        >
          <Input
            type="password"
            value={draft.marketDataApiKey}
            placeholder="Clé Finnhub…"
            onChange={(event) => patch({ marketDataApiKey: event.target.value })}
          />
        </Field>
      ) : null}

      <Field label="Raccourci global" hint="Exemples : Control+Space, Alt+J, Super+K.">
        <Input value={draft.hotkey} onChange={(event) => patch({ hotkey: event.target.value })} />
      </Field>

      <Field label="Personnalité" hint="Instructions envoyées au modèle à chaque conversation.">
        <Textarea
          rows={4}
          value={draft.systemPrompt}
          onChange={(event) => patch({ systemPrompt: event.target.value })}
        />
      </Field>

      <Toggle
        label="Masquer à la perte de focus"
        hint="Comportement de lanceur, comme la recherche Windows."
        checked={draft.hideOnBlur}
        onChange={(hideOnBlur) => patch({ hideOnBlur })}
      />

      <Toggle
        label="Lancer au démarrage de Windows"
        checked={draft.launchAtLogin}
        onChange={(launchAtLogin) => patch({ launchAtLogin })}
      />

      <div className="flex flex-col gap-3 border-t border-white/8 pt-4">
        <div>
          <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
            Permissions
          </p>
          <p className="mt-1 text-xs leading-snug text-slate-500">
            Choisis, par catégorie d’outils, si Jarvis doit te demander confirmation toujours, ou
            seulement pour les actions destructrices, ou jamais.
          </p>
        </div>

        {CONFIGURABLE_CATEGORIES.map((category) => (
          <Field key={category} label={categoryLabels[category]}>
            <Select
              value={draft.toolPolicies[category]}
              onChange={(event) =>
                patch({
                  toolPolicies: {
                    ...draft.toolPolicies,
                    [category]: event.target.value as ConfirmationPolicy,
                  },
                })
              }
            >
              {(['always', 'destructive-only', 'never'] as ConfirmationPolicy[]).map((policy) => (
                <option key={policy} value={policy}>
                  {policyLabels[policy]}
                </option>
              ))}
            </Select>
          </Field>
        ))}

        <div className="flex items-start gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-slate-500" />
          <p className="text-xs leading-snug text-slate-500">
            La suppression de fichiers, l’élévation administrateur et l’exécution de commandes (
            <code className="text-slate-400">run_command</code>) demandent toujours une
            confirmation. Ce réglage n’est pas modifiable, quelle que soit la politique choisie
            ci-dessus.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        {saved ? <span className="text-xs text-accent">Réglages enregistrés</span> : null}
        <Button variant="default" onClick={save}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
}

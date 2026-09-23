import { useEffect, useState } from 'react';
import type { ProviderDescriptor, Settings } from '@jarvis/core';
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
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void window.jarvis.settings.providers().then(setProviders);
  }, []);

  useEffect(() => setDraft(settings), [settings]);

  const descriptor = providers.find((provider) => provider.id === draft.provider);
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

      <div className="flex items-center justify-end gap-3 pt-1">
        {saved ? <span className="text-xs text-accent">Réglages enregistrés</span> : null}
        <Button variant="default" onClick={save}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
}

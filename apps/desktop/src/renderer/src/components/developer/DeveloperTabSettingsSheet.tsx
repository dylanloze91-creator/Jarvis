import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  CONFIGURABLE_CATEGORIES,
  categoryLabels,
  policyLabels,
  type ConfirmationPolicy,
  type DeveloperSettings,
  type Settings,
} from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { DeveloperSettingsSection } from './DeveloperSettings';
import type { RuntimeStatus } from '../../../shared/ipc';

/** Réglages développeur + permissions outils, sans quitter l’onglet Développeur. */
export function DeveloperTabSettingsSheet({
  settings,
  status: _status,
  onSaved,
  onClose,
}: {
  settings: Settings;
  status: RuntimeStatus;
  onSaved: (payload: { settings: Settings; status: RuntimeStatus }) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);

  const saveDeveloper = (developer: DeveloperSettings): void => {
    setDraft((current) => ({ ...current, developer }));
    void window.jarvis.settings.set({ developer }).then((payload) => onSaved(payload));
  };

  const patchPolicies = (category: keyof Settings['toolPolicies'], policy: ConfirmationPolicy): void => {
    const toolPolicies = { ...draft.toolPolicies, [category]: policy };
    setDraft((current) => ({ ...current, toolPolicies }));
    void window.jarvis.settings.set({ toolPolicies }).then((payload) => onSaved(payload));
  };

  return (
    <div
      className="developer-settings-sheet no-drag"
      role="dialog"
      aria-label="Réglages développeur"
      data-developer-settings-sheet
    >
      <header className="developer-settings-sheet-head">
        <div>
          <p className="text-sm font-semibold text-slate-100">Réglages développeur</p>
          <p className="text-[11px] text-slate-500">
            Permissions du codeur, copie de travail, modèle et environnement.
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" aria-label="Fermer" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>
      <div className="developer-settings-sheet-body">
        <section className="flex flex-col gap-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Permissions des outils
          </p>
          <p className="text-xs leading-snug text-slate-500">
            Ce que Jarvis peut faire sans te redemander (applications, fichiers, commandes…). Certaines
            actions restent toujours bloquées ou toujours confirmées.
          </p>
          {CONFIGURABLE_CATEGORIES.map((category) => (
            <Field key={category} label={categoryLabels[category]}>
              <Select
                value={draft.toolPolicies[category]}
                onChange={(event) =>
                  patchPolicies(category, event.target.value as ConfirmationPolicy)
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
        </section>
        <DeveloperSettingsSection
          developer={draft.developer}
          onSave={saveDeveloper}
          surface="advanced"
          hideInlineConfirmation
        />
      </div>
    </div>
  );
}

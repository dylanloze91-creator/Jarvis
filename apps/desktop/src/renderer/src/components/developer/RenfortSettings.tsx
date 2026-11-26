import { useEffect, useState } from 'react';
import { CLAUDE_MODELS, CLAUDE_PRICES_DATE, RENFORT_DEFAULT_CAP_EUR, SECRET_MARKER, type DeveloperSettings } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { Field, Input, Toggle } from '@/components/ui/field';
import { SecretInput } from '@/components/SecretInput';

/**
 * Jarvis Développeur facile, étape 3 : « Claude en renfort » (Jarvis Test seulement, coupé par défaut).
 * La clé Anthropic est tapée ici par l'utilisateur ; elle part dans le coffre, et la fenêtre ne
 * revoit ensuite que « clé enregistrée ». Les plafonds sont en euros.
 */
export function RenfortSettings({ developer, onSave }: { developer: DeveloperSettings; onSave: (next: DeveloperSettings) => void }) {
  const [visible, setVisible] = useState(false);
  const renfort = developer.renfort ?? {};
  const [cle, setCle] = useState(renfort.apiKey ?? '');
  const [parAppli, setParAppli] = useState(String(renfort.capPerAppEur ?? RENFORT_DEFAULT_CAP_EUR));
  const [parMois, setParMois] = useState(renfort.capPerMonthEur === undefined ? '' : String(renfort.capPerMonthEur));

  useEffect(() => {
    void window.jarvis.edition?.state().then((state) => setVisible(state.id === 'test'));
  }, []);
  useEffect(() => {
    setCle(renfort.apiKey ?? '');
  }, [renfort.apiKey]);

  if (!visible) return null;
  const save = (patch: Partial<NonNullable<DeveloperSettings['renfort']>>) => onSave({ ...developer, renfort: { ...renfort, ...patch } });
  const nombre = (texte: string): number | undefined => {
    const n = Number(texte.replace(',', '.'));
    return texte.trim() && Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const cleEnregistree = renfort.apiKey === SECRET_MARKER || Boolean(renfort.apiKey);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 px-3 py-2" data-renfort-settings>
      <Toggle
        label="Claude en renfort"
        hint="Quand une étape est trop dure pour le modèle local, Jarvis te propose de la confier à Claude, sur une carte : estimation de durée et de coût, puis ton oui ou ton non. Rien ne part sans ton clic. Payant, avec ta clé."
        checked={renfort.enabled === true}
        onChange={(enabled) => save({ enabled })}
      />
      {renfort.enabled ? (
        <>
          <Field label="Clé API Anthropic" hint="À créer sur platform.claude.com. Elle est gardée dans le coffre de Jarvis ; elle ne part que chez Anthropic.">
            <div className="flex gap-2">
              <SecretInput value={cle} onChange={setCle} placeholder="sk-ant-…" />
              <Button type="button" size="sm" variant="subtle" disabled={cle === (renfort.apiKey ?? '')} onClick={() => save({ apiKey: cle.trim() })}>
                Enregistrer la clé
              </Button>
            </div>
          </Field>
          {!cleEnregistree ? <p className="text-xs text-amber-200">Sans clé, Jarvis ne propose que le local, et te dit comment l’ajouter.</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Plafond par appli (€)" hint={`${RENFORT_DEFAULT_CAP_EUR} € si tu ne mets rien.`}>
              <Input
                inputMode="decimal"
                value={parAppli}
                onChange={(event: { target: { value: string } }) => setParAppli(event.target.value)}
                onBlur={() => save({ capPerAppEur: nombre(parAppli) ?? RENFORT_DEFAULT_CAP_EUR })}
              />
            </Field>
            <Field label="Plafond par mois (€)" hint="Vide : pas de plafond par mois.">
              <Input
                inputMode="decimal"
                value={parMois}
                onChange={(event: { target: { value: string } }) => setParMois(event.target.value)}
                onBlur={() => {
                  const n = nombre(parMois);
                  const { capPerMonthEur: _ancien, ...reste } = renfort;
                  onSave({ ...developer, renfort: n === undefined ? reste : { ...reste, capPerMonthEur: n } });
                }}
              />
            </Field>
          </div>
          <p className="text-xs leading-snug text-slate-500">
            Prix relevés chez Anthropic le {CLAUDE_PRICES_DATE.split('-').reverse().join('/')}, par million de jetons lus / écrits :{' '}
            {CLAUDE_MODELS.map((m) => `${m.nom} ${String(m.inputUsd).replace('.', ',')} $ / ${String(m.outputUsd).replace('.', ',')} $`).join(' ; ')}. Jarvis prend le plus petit
            modèle qui convient (Haiku pour une correction, Sonnet pour une étape difficile) ; Opus seulement si tu le demandes. Un dollar est compté comme un euro. Rien
            de ce que Claude écrit n’entre dans l’entraînement des modèles locaux.
          </p>
        </>
      ) : null}
    </div>
  );
}

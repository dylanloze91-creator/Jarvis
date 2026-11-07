import {
  DEFAULT_PERSONA,
  PERSONA_STYLES,
  PERSONA_STYLE_LABELS,
  personaGreeting,
  personaPrompt,
  type PersonaStyle,
  type Settings,
} from '@jarvis/core';
import { Sparkles } from 'lucide-react';
import { Disclosure } from '@/components/ui/disclosure';
import { Field, Select, Toggle } from '@/components/ui/field';

type Persona = NonNullable<Settings['persona']>;

interface PersonaSettingsProps {
  value: Settings['persona'];
  onChange: (value: Persona) => void;
  /** Prénom connu de la personnalisation, pour l'aperçu de l'accueil. */
  userName?: string | null;
  /** Le chef d'orchestre est activé dans le brouillon : sans lui, la fiche n'est envoyée à personne. */
  orchestraEnabled: boolean;
}

/**
 * Caractère de Jarvis : une personnalité bien à lui, presque humaine, honnête
 * sur ce qu'il est. Coupé = le prompt d'avant, à l'identique.
 */
export function PersonaSettingsSection({ value, onChange, userName, orchestraEnabled }: PersonaSettingsProps) {
  const persona: Persona = value ?? { ...DEFAULT_PERSONA, enabled: false };
  const patch = (values: Partial<Persona>): void => onChange({ ...persona, ...values });
  const preview = { ...persona, enabled: true };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-3.5 text-cyan-200" />
        <span className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Caractère de Jarvis</span>
      </div>
      <p className="text-xs leading-snug text-slate-500">
        Avec le caractère, Jarvis parle comme quelqu’un : des avis, des réactions, une mémoire de toi, un
        trait d’esprit de temps en temps. Il reste honnête sur ce qu’il est (un programme sur ce PC, jamais
        un humain) et les règles d’action (outils, confirmations) ne changent pas. Coupé : le ton neutre
        d’avant. La fiche s’ajoute aux consignes des équipes du <strong>chef d’orchestre</strong> ; sans
        lui, le chat garde son prompt d’origine.
      </p>
      {persona.enabled && !orchestraEnabled ? (
        <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs leading-snug text-amber-100">
          Le chef d’orchestre est coupé : active-le dans Réglages → Cerveau, sinon le caractère n’est envoyé
          à aucune réponse (seul l’accueil change).
        </p>
      ) : null}
      <Toggle
        label="Donner un caractère à Jarvis"
        hint="Ajoute sa fiche de personnage aux consignes des équipes du chef d’orchestre et change l’accueil."
        checked={persona.enabled}
        onChange={(enabled) => patch({ enabled })}
      />
      <Field label="Ton" hint={PERSONA_STYLE_LABELS[persona.style].hint}>
        <Select value={persona.style} onChange={(event) => patch({ style: event.target.value as PersonaStyle })}>
          {PERSONA_STYLES.map((style) => (
            <option key={style} value={style}>
              {PERSONA_STYLE_LABELS[style].label}
            </option>
          ))}
        </Select>
      </Field>
      <Toggle
        label="Traits d’humour"
        hint="Secs et rares, jamais sur une erreur ni un sujet grave."
        checked={persona.humour}
        onChange={(humour) => patch({ humour })}
      />
      <div className="rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-xs text-slate-300">
        <span className="text-slate-500">Accueil, en ce moment : </span>
        {personaGreeting(preview, { now: new Date(), userName: userName ?? null })}
      </div>
      <Disclosure title="La fiche de personnage" hint="Le texte exact ajouté au prompt (lecture seule).">
        <p className="text-xs leading-relaxed whitespace-pre-wrap text-slate-400">
          {personaPrompt(preview, { now: new Date(), userName: userName ?? null })}
        </p>
      </Disclosure>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CONFIGURABLE_CATEGORIES,
  categoryLabels,
  policyLabels,
  type ConfirmationPolicy,
  type DeveloperSettings,
  type MarketDataProviderDescriptor,
  type ProviderDescriptor,
  type SearchProviderDescriptor,
  type Settings,
  type SettingsCategoryId,
  type VoiceSettings,
  userFirstName,
} from '@jarvis/core';
import { Lock } from 'lucide-react';
import { AuditPanel } from '@/components/AuditPanel';
import { ReservedGate } from '@/components/ReservedGate';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirmButton';

function CopyFromLive() {
  const [visible, setVisible] = useState(false);
  const [sentence, setSentence] = useState<string | null>(null);
  const [guide, setGuide] = useState<string | null>(null);
  useEffect(() => {
    void window.jarvis.edition?.state().then((state) => setVisible(state.id === 'test'));
  }, []);
  if (!visible) return null;
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-white/10 px-3 py-2.5">
      <p className="text-sm text-slate-200">Recopier depuis Jarvis Live</p>
      <p className="text-xs leading-relaxed text-slate-400">
        Remplace les réglages de Test par ceux de Live. L’historique de Test reste ici. Live n’est pas
        modifié. Jarvis Test redémarre ensuite.
      </p>
      {sentence ? <p className="text-xs text-orange-100">{sentence}</p> : null}
      {guide ? <p className="text-xs text-slate-300">{guide}</p> : null}
      <ConfirmButton
        label="Recopier depuis Live"
        confirmLabel="Oui, recopier"
        onConfirm={() => {
          void window.jarvis.edition?.copy('yes').then((result) => {
            setSentence(result.sentence);
            setGuide(result.guide);
          });
        }}
      />
    </div>
  );
}
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/field';
import { OllamaSettingsSection } from '@/components/OllamaSettings';
import { OrchestraSettingsSection } from '@/components/OrchestraSettings';
import { PersonaSettingsSection } from '@/components/PersonaSettings';
import { SpotifySettingsSection } from '@/components/SpotifySettings';
import { GoogleSettingsSection } from '@/components/GoogleSettings';
import { SiteBlockSettingsSection } from '@/components/SiteBlockSettings';
import { RoverSettingsSection } from '@/components/RoverSettings';
import { ImagesSettingsSection } from '@/components/ImagesSettings';
import { PhoneSettingsSection } from '@/components/PhoneSettings';
import { SpeakerSettingsSection } from '@/components/SpeakerSettings';
import { PersonalizationSettingsSection } from '@/components/PersonalizationSettings';
import { HomeLocationSettingsSection } from '@/components/HomeLocationSettings';
import { KnowledgeSettingsSection } from '@/components/KnowledgeSettings';
import { UpdateSettingsSection } from '@/components/UpdateSettings';
import { VoiceSettingsSection } from '@/components/VoiceSettings';
import { DeveloperSettingsSection } from '@/components/developer/DeveloperSettings';
import { SettingsAccordion } from '@/components/settings/SettingsAccordion';
import { SettingsCategoryNav } from '@/components/settings/SettingsCategoryNav';
import { SettingsDependencyHints } from '@/components/settings/SettingsDependencyHints';
import { SettingsSearch } from '@/components/settings/SettingsSearch';
import { QuestionnaireSettingsSection } from '@/components/settings/QuestionnaireSettingsSection';
import {
  SETTINGS_DEEP_LINKS,
  type SettingsNavigationTarget,
} from '@/components/settings/settingsDeepLinks';
import type { SettingsTabId } from '@/components/SettingsTabs';
import { BackupSettingsSection } from '@/components/BackupSettingsSection';
import { HealthSettingsSection } from '@/components/HealthSettingsSection';
import { KnowSettingsSection } from '@/components/KnowSettingsSection';
import { SecretInput } from '@/components/SecretInput';
import { absorbSavedSettings, settingsPatch, type SettingsDraft } from '@/lib/settingsPatch';
import type { RuntimeStatus } from '../../../shared/ipc';

/** Catégorie rouverte à la prochaine visite des réglages (session en cours). */
let lastSettingsNavigation: SettingsNavigationTarget = SETTINGS_DEEP_LINKS.voice;

/** Prochaine ouverture des réglages (liens profonds, cartes du tableau de bord). */
export function openSettingsAt(target: SettingsNavigationTarget): void {
  lastSettingsNavigation = target;
}

/** Compatibilité 5.0.64 — anciens identifiants d’onglets. */
export function openSettingsOnTab(tab: SettingsTabId): void {
  openSettingsAt(SETTINGS_DEEP_LINKS[tab]);
}

let keptDraft: SettingsDraft | null = null;

interface SettingsPanelProps {
  settings: Settings;
  status: RuntimeStatus;
  onSaved: (payload: { settings: Settings; status: RuntimeStatus }) => void;
  requestedTab?: { tab: SettingsTabId; at: number };
  onAnalyzeMachine?: () => void;
  onRestartOnboarding?: () => void;
}

function CategoryPanel({
  id,
  active,
  children,
}: {
  id: SettingsCategoryId;
  active: SettingsCategoryId;
  children: ReactNode;
}) {
  return (
    <div role="tabpanel" hidden={id !== active} className="flex flex-col gap-3">
      {children}
    </div>
  );
}

export function SettingsPanel({
  settings,
  status,
  onSaved,
  requestedTab,
  onAnalyzeMachine,
  onRestartOnboarding,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState<Settings>(() => keptDraft?.draft ?? settings);
  const baseRef = useRef<Settings>(keptDraft?.base ?? settings);
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [searchProviders, setSearchProviders] = useState<SearchProviderDescriptor[]>([]);
  const [marketDataProviders, setMarketDataProviders] = useState<MarketDataProviderDescriptor[]>([]);
  const [saved, setSaved] = useState(false);
  const [unsaved, setUnsaved] = useState(() => keptDraft !== null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const [category, setCategory] = useState<SettingsCategoryId>(() => lastSettingsNavigation.category);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => ({
    [lastSettingsNavigation.subcategory]: true,
  }));
  const [highlight, setHighlight] = useState<string | undefined>(lastSettingsNavigation.highlight);

  const navigate = useCallback((target: SettingsNavigationTarget) => {
    lastSettingsNavigation = target;
    setCategory(target.category);
    setOpenSections((current) => ({ ...current, [target.subcategory]: true }));
    setHighlight(target.highlight ?? target.subcategory);
    window.setTimeout(() => {
      document.getElementById(`settings-section-${target.subcategory}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    window.setTimeout(() => setHighlight(undefined), 2400);
  }, []);

  useEffect(() => {
    lastSettingsNavigation = { category, subcategory: Object.keys(openSections)[0] ?? 'voice' };
  }, [category, openSections]);

  useEffect(() => {
    navigate(lastSettingsNavigation);
  }, [navigate]);

  useEffect(() => {
    const onNavigate = (event: Event): void => {
      const target = (event as CustomEvent<SettingsNavigationTarget>).detail;
      if (target?.category && target.subcategory) navigate(target);
    };
    window.addEventListener('jarvis-settings-navigate', onNavigate);
    return () => window.removeEventListener('jarvis-settings-navigate', onNavigate);
  }, [navigate]);

  useEffect(() => {
    if (requestedTab) navigate(SETTINGS_DEEP_LINKS[requestedTab.tab]);
  }, [requestedTab, navigate]);

  const toggleSection = (id: string): void => {
    setOpenSections((current) => ({ ...current, [id]: !current[id] }));
  };

  const dirty = useRef(keptDraft !== null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(
    () => () => {
      keptDraft = dirty.current ? { base: baseRef.current, draft: draftRef.current } : null;
    },
    [],
  );

  const [userName, setUserName] = useState<string | null>(null);
  useEffect(() => {
    void window.jarvis.settings
      .personalizationGet()
      .then((profile) => setUserName(userFirstName(profile.user)))
      .catch(() => setUserName(null));
  }, []);

  useEffect(() => {
    void window.jarvis.settings.providers().then(setProviders);
    void window.jarvis.settings.searchProviders().then(setSearchProviders);
    void window.jarvis.settings.marketDataProviders().then(setMarketDataProviders);
  }, []);

  useEffect(() => {
    if (!dirty.current) {
      baseRef.current = settings;
      setDraft(settings);
      return;
    }
    const next = absorbSavedSettings({ base: baseRef.current, draft: draftRef.current }, settings);
    baseRef.current = next.base;
    setDraft(next.draft);
  }, [settings]);

  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const saveDeveloper = useCallback((developer: DeveloperSettings): void => {
    setDraft((current) => ({ ...current, developer }));
    void window.jarvis.settings.set({ developer }).then((payload) => onSavedRef.current(payload));
  }, []);

  const descriptor = providers.find((provider) => provider.id === draft.provider);
  const searchDescriptor = searchProviders.find((provider) => provider.id === draft.searchProvider);
  const marketDataDescriptor = marketDataProviders.find((provider) => provider.id === draft.marketDataProvider);

  const patch = (values: Partial<Settings>): void => {
    dirty.current = true;
    setUnsaved(true);
    setDraft((current) => ({ ...current, ...values }));
    setSaved(false);
  };
  const patchVoice = (values: Partial<VoiceSettings>): void => {
    dirty.current = true;
    setUnsaved(true);
    setDraft((current) => ({ ...current, voice: { ...current.voice, ...values } }));
    setSaved(false);
  };

  const chooseMicrophone = (microphoneId: string): void => {
    setDraft((current) => ({ ...current, voice: { ...current.voice, microphoneId } }));
    void window.jarvis.settings
      .set({ voice: { ...settings.voice, microphoneId } })
      .then((payload) => onSaved(payload));
  };

  const save = (): void => {
    const wanted = { ...draft, fallbackModel: draft.fallbackModel.trim() || 'qwen2.5:3b' };
    setSaveNotice(null);
    void window.jarvis.settings
      .set(settingsPatch(baseRef.current, wanted))
      .then((payload) => {
        dirty.current = false;
        keptDraft = null;
        setUnsaved(false);
        onSaved(payload);
        setSaved(true);
        if (payload.settings.hotkey !== wanted.hotkey) {
          setSaveNotice(
            `Le raccourci « ${wanted.hotkey} » n’a pas pu être enregistré (déjà pris ou mal écrit) : « ${payload.settings.hotkey} » est conservé.`,
          );
        }
      })
      .catch((error: unknown) => {
        setSaved(false);
        setSaveNotice(
          `Les réglages n’ont pas été enregistrés : ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  };

  const orchestraEnabled = draft.provider === 'ollama' && draft.orchestra?.enabled === true;
  const brainActive = category === 'brain';

  const accordion = (id: string, title: string, hint: string | undefined, body: ReactNode) => (
    <SettingsAccordion
      id={id}
      title={title}
      hint={hint}
      open={openSections[id] === true}
      highlight={highlight === id}
      onToggle={() => toggleSection(id)}
    >
      {body}
    </SettingsAccordion>
  );

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {status.usingFallback ? (
        <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs leading-snug text-amber-100">
          Aucune clé API valide pour « {status.providerLabel} » : Jarvis répond avec le fournisseur de
          démonstration, hors ligne. Colle une clé dans Cerveau → Fournisseur, ou choisis « Ollama (local,
          gratuit) ».
        </p>
      ) : status.providerId === 'mock' ? (
        <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs leading-snug text-amber-100">
          Mode démonstration : aucun modèle n’est branché. Dans Cerveau → Fournisseur, choisis « Ollama (local,
          gratuit) », teste, puis enregistre.
        </p>
      ) : null}

      <SettingsDependencyHints settings={draft} />
      <SettingsSearch onNavigate={navigate} />
      <SettingsCategoryNav active={category} onChange={setCategory} />

      <CategoryPanel id="moi" active={category}>
        {accordion('personalization', 'Personnalisation', 'Ce que Jarvis retient de toi', <PersonalizationSettingsSection />)}
        {accordion('know', 'Ce que Jarvis sait de moi', 'Voir, exporter ou effacer', <KnowSettingsSection />)}
        {accordion(
          'persona',
          'Caractère de Jarvis',
          'Ton et accueil (avec le chef d’orchestre)',
          <PersonaSettingsSection
            value={draft.persona}
            userName={userName}
            orchestraEnabled={orchestraEnabled}
            onChange={(persona) => patch({ persona })}
          />,
        )}
        {accordion(
          'home-location',
          'Chez moi',
          'Météo et lieu par défaut',
          <HomeLocationSettingsSection
            value={draft.homeLocation}
            onChange={(homeLocation) => patch(homeLocation ? { homeLocation } : { homeLocation: undefined })}
          />,
        )}
        {accordion(
          'knowledge',
          'Mémoire documentaire',
          'Index local et apprentissage',
          <KnowledgeSettingsSection
            learningEnabled={draft.localLearning.enabled}
            autoTrain={draft.localLearning.autoTrain === true}
            onLearningChange={(learningPatch) => {
              const localLearning = { ...draft.localLearning, ...learningPatch };
              setDraft((current) => ({ ...current, localLearning }));
              void window.jarvis.settings.set({ localLearning }).then((payload) => onSavedRef.current(payload));
            }}
          />,
        )}
      </CategoryPanel>

      <CategoryPanel id="parler" active={category}>
        {accordion(
          'voice',
          'Voix et micro',
          'Réveil, transcription, synthèse',
          <VoiceSettingsSection
            voice={draft.voice}
            voiceKeyConfigured={status.voiceKeyConfigured}
            onChange={patchVoice}
            onMicrophoneChange={chooseMicrophone}
            learningSaved={settings.voice.wakeLearning}
          />,
        )}
      </CategoryPanel>

      <CategoryPanel id="services" active={category}>
        {accordion(
          'spotify',
          'Spotify',
          'Musique sur ton compte',
          <>
            <p className="text-xs leading-snug text-slate-500">
              Huit outils spotify_* : lecture, pause, morceau suivant, volume, etc.
            </p>
            <SpotifySettingsSection
              clientId={draft.spotifyClientId}
              onChange={(spotifyClientId) => patch({ spotifyClientId })}
              deviceName={draft.spotifyDeviceName ?? ''}
              onDeviceNameChange={(spotifyDeviceName) => patch({ spotifyDeviceName })}
              askDevice={draft.spotifyAskDevice === true}
              onAskDeviceChange={(spotifyAskDevice) => patch({ spotifyAskDevice })}
            />
          </>,
        )}
        {accordion(
          'google',
          'Google',
          'Gmail, agenda, Drive',
          <GoogleSettingsSection
            clientId={draft.googleClientId}
            clientSecret={draft.googleClientSecret}
            access={draft.googleAccess}
            onChange={(values) => patch(values)}
          />,
        )}
        {accordion(
          'siteblock',
          'Blocage de sites',
          'Connexion à l’appli SiteBlock',
          <SiteBlockSettingsSection
            baseUrl={draft.siteBlockBaseUrl}
            token={draft.siteBlockToken}
            onChange={(values) => patch(values)}
          />,
        )}
        {accordion(
          'robot',
          'Robot',
          'Adresse et jeton du rover',
          <RoverSettingsSection
            baseUrl={draft.roverBaseUrl ?? ''}
            token={draft.roverToken ?? ''}
            onChange={(values) => patch(values)}
          />,
        )}
        {accordion(
          'images',
          'Jarvis Imager',
          'Images en local (Forge + SDXL)',
          <ImagesSettingsSection value={draft.images} onChange={(images) => patch({ images })} />,
        )}
        {accordion('phone', 'Téléphone', 'Jarvis via Tailscale', <PhoneSettingsSection />)}
        {accordion('speakers', 'Enceintes', 'Cartes ESP32 sur le Wi-Fi', <SpeakerSettingsSection />)}
        {accordion(
          'developer-general',
          'Jarvis développeur',
          'Projets et missions depuis la discussion',
          <DeveloperSettingsSection
            developer={draft.developer}
            onSave={saveDeveloper}
            surface="general"
            onOpenAdvanced={() => navigate({ category: 'services', subcategory: 'developer-advanced' })}
          />,
        )}
        {accordion(
          'developer-advanced',
          'Code et projets (avancé)',
          'Copie de travail, modèle, environnement',
          <DeveloperSettingsSection developer={draft.developer} onSave={saveDeveloper} surface="advanced" />,
        )}
      </CategoryPanel>

      <CategoryPanel id="brain" active={category}>
        {accordion(
          'provider',
          'Fournisseur de modèle',
          'Ollama ou service en ligne',
          <>
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
                  <SecretInput
                    value={draft.apiKey}
                    placeholder="sk-…"
                    onChange={(apiKey) => patch({ apiKey })}
                  />
                </Field>
                <Field label="URL de base" hint="Backend compatible OpenAI (LM Studio, OpenRouter…).">
                  <Input
                    value={draft.baseUrl}
                    placeholder={descriptor.defaultBaseUrl ?? ''}
                    onChange={(event) => patch({ baseUrl: event.target.value })}
                  />
                </Field>
              </>
            ) : null}
          </>,
        )}
        {draft.provider === 'ollama'
          ? accordion(
              'ollama',
              'Ollama',
              'Serveur local et test',
              <OllamaSettingsSection
                baseUrl={draft.baseUrl}
                model={draft.model}
                active={brainActive && openSections.ollama === true}
                onChange={(values) => patch(values)}
              />,
            )
          : null}
        {draft.provider === 'ollama'
          ? accordion(
              'orchestra',
              'Chef d’orchestre',
              'Équipes de petits modèles',
              <OrchestraSettingsSection
                baseUrl={draft.baseUrl}
                chatModel={draft.model}
                value={draft.orchestra}
                active={brainActive && openSections.orchestra === true}
                onChange={(orchestra) => patch({ orchestra })}
              />,
            )
          : null}
        {accordion(
          'model',
          'Modèle de repli',
          'Si le modèle principal est absent',
          <Field
            label="Modèle de repli"
            hint="Défaut : qwen2.5:3b. qwen3.5:4b est recommandé, pas le défaut."
          >
            <Input
              value={draft.fallbackModel}
              placeholder="qwen2.5:3b"
              onChange={(event) => patch({ fallbackModel: event.target.value })}
            />
          </Field>,
        )}
        {accordion(
          'system-prompt',
          'Consignes de base',
          'Prompt système à chaque conversation',
          <Field
            label="Consignes de base (prompt système)"
            hint="Distinct de la mémoire persistante (catégorie Moi)."
          >
            <Textarea
              rows={4}
              value={draft.systemPrompt}
              onChange={(event) => patch({ systemPrompt: event.target.value })}
            />
          </Field>,
        )}
        {accordion(
          'search',
          'Recherche Internet',
          'web_search, actualités, pages',
          <>
            <p className="text-xs leading-snug text-slate-500">
              Sans clé : Google Actualités, Bing, DuckDuckGo, Wikipédia, Open-Meteo. Clé Brave ou Tavily
              optionnelle.
            </p>
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
              <Field label="Clé API — recherche" hint="Stockée uniquement sur cette machine.">
                <SecretInput
                  value={draft.searchApiKey}
                  placeholder={draft.searchProvider === 'tavily' ? 'Clé Tavily (tvly-…)' : 'Clé Brave Search…'}
                  onChange={(searchApiKey) => patch({ searchApiKey })}
                />
              </Field>
            ) : null}
          </>,
        )}
        {accordion(
          'market',
          'Cours de bourse',
          'Outil get_stock_quote',
          <>
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
              <Field label="Clé API — bourse" hint="Stockée uniquement sur cette machine.">
                <SecretInput
                  value={draft.marketDataApiKey}
                  placeholder="Clé Finnhub…"
                  onChange={(marketDataApiKey) => patch({ marketDataApiKey })}
                />
              </Field>
            ) : null}
          </>,
        )}
      </CategoryPanel>

      <CategoryPanel id="security" active={category}>
        {accordion(
          'tool-policies',
          'Permissions des outils',
          'Confirmations par catégorie',
          <>
            <p className="text-xs leading-snug text-slate-500">
              Choisis si Jarvis doit demander confirmation toujours, pour les actions destructrices, ou jamais.
            </p>
            {CONFIGURABLE_CATEGORIES.map((toolCategory) => (
              <Field key={toolCategory} label={categoryLabels[toolCategory]}>
                <Select
                  value={draft.toolPolicies[toolCategory]}
                  onChange={(event) =>
                    patch({
                      toolPolicies: {
                        ...draft.toolPolicies,
                        [toolCategory]: event.target.value as ConfirmationPolicy,
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
                Suppression de fichiers, élévation admin, run_command, règles de blocage, indexation et effacement
                mémoire : confirmation toujours obligatoire.
              </p>
            </div>
          </>,
        )}
        {accordion(
          'siteblock-intro',
          'Blocage de sites (rappel)',
          'Outils siteblock_*',
          <p className="text-xs leading-snug text-slate-500">
            Mode travail, liste de sites et créneaux. Toute modification demande une confirmation, même si tu as
            mis Applications à « jamais ». Branche l’appli dans Services → Blocage de sites.
          </p>,
        )}
        {accordion('audit', 'Journal d’audit', 'Actions sensibles enregistrées', <AuditPanel />)}
      </CategoryPanel>

      <CategoryPanel id="application" active={category}>
        {accordion(
          'machine',
          'Cette machine',
          'Profil matériel détecté',
          <>
            {settings.machine ? (
              <>
                <p className="text-xs leading-relaxed text-slate-200">{settings.machine.detected}</p>
                <p className="text-xs leading-relaxed text-cyan-100/90">{settings.machine.chosen}</p>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-slate-400">Aucun profil enregistré.</p>
            )}
            <Button className="mt-2" variant="subtle" size="sm" onClick={() => onAnalyzeMachine?.()}>
              Analyser à nouveau
            </Button>
          </>,
        )}
        {accordion(
          'window',
          'Fenêtre et raccourci',
          'Affichage et démarrage Windows',
          <>
            <ReservedGate name="shortcut">
              <Field label="Raccourci global" hint="Exemples : Control+Space, Alt+J, Super+K.">
                <Input value={draft.hotkey} onChange={(event) => patch({ hotkey: event.target.value })} />
              </Field>
            </ReservedGate>
            <CopyFromLive />
            <Toggle
              label="Rester ouverte"
              hint="Visible si tu cliques ailleurs (masquage : raccourci, Échap, fermer)."
              checked={draft.stayVisibleOnBlur}
              onChange={(stayVisibleOnBlur) => patch({ stayVisibleOnBlur })}
            />
            <Toggle
              label="Lancer au démarrage de Windows"
              checked={draft.launchAtLogin}
              onChange={(launchAtLogin) => patch({ launchAtLogin })}
            />
          </>,
        )}
        {accordion('health', 'Bilan de santé', 'Ce qui bloque, sans rien réparer', <HealthSettingsSection />)}
        {accordion(
          'backup',
          'Sauvegarde',
          'Copie de tes données Jarvis',
          <BackupSettingsSection draft={draft} onChange={patch} />,
        )}
        {accordion('updates', 'Mises à jour', 'Version et installation', <UpdateSettingsSection />)}
        {accordion(
          'questionnaire',
          'Questionnaire d’accueil',
          'Premier lancement et restauration',
          <QuestionnaireSettingsSection
            onSettingsApplied={onSaved}
            onRestartOnboarding={() => onRestartOnboarding?.()}
          />,
        )}
      </CategoryPanel>

      <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex items-center justify-end gap-3 border-t border-white/8 bg-[#070b14]/90 px-4 py-3 backdrop-blur">
        {saveNotice ? (
          <span role="alert" className="mr-auto text-xs leading-snug text-amber-200">
            {saveNotice}
          </span>
        ) : null}
        {saved && !saveNotice ? <span className="text-xs text-accent">Réglages enregistrés</span> : null}
        {unsaved && !saved ? (
          <span className="text-xs text-amber-200/80">Modifications non enregistrées</span>
        ) : null}
        <Button variant={unsaved ? 'default' : 'subtle'} onClick={save}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
}

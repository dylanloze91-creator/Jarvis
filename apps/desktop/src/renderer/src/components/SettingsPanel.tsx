import { useCallback, useEffect, useRef, useState } from 'react';
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
  type VoiceSettings,
  userFirstName,
} from '@jarvis/core';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/field';
import { OllamaSettingsSection } from '@/components/OllamaSettings';
import { OrchestraSettingsSection } from '@/components/OrchestraSettings';
import { PersonaSettingsSection } from '@/components/PersonaSettings';
import { SpotifySettingsSection } from '@/components/SpotifySettings';
import { GoogleSettingsSection } from '@/components/GoogleSettings';
import { SiteBlockSettingsSection } from '@/components/SiteBlockSettings';
import { RoverSettingsSection } from '@/components/RoverSettings';
import { PhoneSettingsSection } from '@/components/PhoneSettings';
import { SpeakerSettingsSection } from '@/components/SpeakerSettings';
import { PersonalizationSettingsSection } from '@/components/PersonalizationSettings';
import { HomeLocationSettingsSection } from '@/components/HomeLocationSettings';
import { KnowledgeSettingsSection } from '@/components/KnowledgeSettings';
import { UpdateSettingsSection } from '@/components/UpdateSettings';
import { VoiceSettingsSection } from '@/components/VoiceSettings';
import { SettingsTabBar, TabPanel, type SettingsTabId } from '@/components/SettingsTabs';
import { DeveloperSettingsSection } from '@/components/developer/DeveloperSettings';
import { absorbSavedSettings, settingsPatch, type SettingsDraft } from '@/lib/settingsPatch';
import type { RuntimeStatus } from '../../../shared/ipc';

/** Onglet rouvert à la prochaine visite des réglages (session en cours). */
let lastSettingsTab: SettingsTabId = 'voice';

/** Prochaine ouverture des réglages sur cet onglet (cartes Google du tableau de bord). */
export function openSettingsOnTab(tab: SettingsTabId): void {
  lastSettingsTab = tab;
}

/**
 * 5.0.64 — brouillon non enregistré gardé pour la session : Échap ou un clic
 * ailleurs ferment le panneau, mais les modifications attendent le retour
 * (« Modifications non enregistrées ») au lieu de disparaître sans prévenir.
 * Gardé avec l'instantané dont il est parti (`base`) : « Enregistrer » compare à cet
 * instantané, pas aux réglages courants, pour ne pas défaire un réglage fait ailleurs
 * entre-temps.
 */
let keptDraft: SettingsDraft | null = null;

interface SettingsPanelProps {
  settings: Settings;
  status: RuntimeStatus;
  onSaved: (payload: { settings: Settings; status: RuntimeStatus }) => void;
  /** Bascule sur un onglet alors que le panneau est déjà ouvert (`at` change à chaque demande). */
  requestedTab?: { tab: SettingsTabId; at: number };
  /** Relance la mesure et applique le profil. Ne part pas tout seul si des réglages existent. */
  onAnalyzeMachine?: () => void;
}

export function SettingsPanel({ settings, status, onSaved, requestedTab, onAnalyzeMachine }: SettingsPanelProps) {
  const [draft, setDraft] = useState<Settings>(() => keptDraft?.draft ?? settings);
  /** Instantané des réglages à la création du brouillon : la base de comparaison de « Enregistrer ». */
  const baseRef = useRef<Settings>(keptDraft?.base ?? settings);
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [searchProviders, setSearchProviders] = useState<SearchProviderDescriptor[]>([]);
  const [marketDataProviders, setMarketDataProviders] = useState<MarketDataProviderDescriptor[]>(
    [],
  );
  const [saved, setSaved] = useState(false);
  /** 5.0.64 : brouillon modifié depuis le dernier enregistrement. */
  const [unsaved, setUnsaved] = useState(() => keptDraft !== null);
  /** 5.0.64 : échec de l'enregistrement, ou raccourci refusé par Windows. */
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<SettingsTabId>(() => lastSettingsTab);
  useEffect(() => {
    lastSettingsTab = tab;
  }, [tab]);
  useEffect(() => {
    if (requestedTab) setTab(requestedTab.tab);
  }, [requestedTab]);
  const dirty = useRef(keptDraft !== null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(
    () => () => {
      keptDraft = dirty.current ? { base: baseRef.current, draft: draftRef.current } : null;
    },
    [],
  );

  // Prénom connu (personnalisation), pour l'aperçu de l'accueil du caractère.
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

  // Un choix de micro ou le mode Développeur sont enregistrés tout de suite, et le
  // processus principal écrit certains blocs de son côté : le brouillon prend ces
  // nouvelles valeurs pour les clés que l'utilisateur n'a pas touchées, garde les siennes,
  // et la base de comparaison devient les réglages enregistrés.
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

  // Comme le micro : enregistré tout de suite, les actions du mode Développeur en dépendent.
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const saveDeveloper = useCallback((developer: DeveloperSettings): void => {
    setDraft((current) => ({ ...current, developer }));
    void window.jarvis.settings.set({ developer }).then((payload) => onSavedRef.current(payload));
  }, []);

  const descriptor = providers.find((provider) => provider.id === draft.provider);
  const searchDescriptor = searchProviders.find((provider) => provider.id === draft.searchProvider);
  const marketDataDescriptor = marketDataProviders.find(
    (provider) => provider.id === draft.marketDataProvider,
  );
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
        // Le processus principal retombe sur Control+Space quand Windows refuse le raccourci.
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

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {status.usingFallback ? (
        <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs leading-snug text-amber-100">
          Aucune clé API valide pour « {status.providerLabel} » : Jarvis répond avec le fournisseur de
          démonstration, hors ligne. Colle une clé dans l’onglet Modèle IA, ou choisis « Ollama (local,
          gratuit) ».
        </p>
      ) : status.providerId === 'mock' ? (
        <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs leading-snug text-amber-100">
          Mode démonstration : aucun modèle n’est branché. Dans l’onglet Modèle IA, choisis « Ollama
          (local, gratuit) », teste, puis enregistre.
        </p>
      ) : null}

      <SettingsTabBar active={tab} onChange={setTab} />

      <TabPanel id="voice" active={tab}>
          <VoiceSettingsSection
            voice={draft.voice}
            voiceKeyConfigured={status.voiceKeyConfigured}
            onChange={patchVoice}
            onMicrophoneChange={chooseMicrophone}
            learningSaved={settings.voice.wakeLearning}
          />
      </TabPanel>
      <TabPanel id="model" active={tab}>
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
                hint="À renseigner pour un backend compatible OpenAI (LM Studio, OpenRouter…)."
              >
                <Input
                  value={draft.baseUrl}
                  placeholder={descriptor.defaultBaseUrl ?? ''}
                  onChange={(event) => patch({ baseUrl: event.target.value })}
                />
              </Field>
            </>
          ) : null}

          {draft.provider === 'ollama' ? (
            <OllamaSettingsSection
              baseUrl={draft.baseUrl}
              model={draft.model}
              active={tab === 'model'}
              onChange={(values) => patch(values)}
            />
          ) : null}

          {draft.provider === 'ollama' ? (
            <OrchestraSettingsSection
              baseUrl={draft.baseUrl}
              chatModel={draft.model}
              value={draft.orchestra}
              active={tab === 'model'}
              onChange={(orchestra) => patch({ orchestra })}
            />
          ) : null}

          <Field
            label="Modèle de repli"
            hint="Utilisé si le modèle choisi n’est pas disponible. Défaut : qwen2.5:3b. qwen3.5:4b est le modèle recommandé, pas le défaut."
          >
            <Input
              value={draft.fallbackModel}
              placeholder="qwen2.5:3b"
              onChange={(event) => patch({ fallbackModel: event.target.value })}
            />
          </Field>

          <PersonaSettingsSection
            value={draft.persona}
            userName={userName}
            orchestraEnabled={draft.provider === 'ollama' && draft.orchestra?.enabled === true}
            onChange={(persona) => patch({ persona })}
          />

          <Field
            label="Consignes de base (prompt système)"
            hint="Instructions envoyées au modèle à chaque conversation. Distinct de la mémoire persistante (onglet Recherche et mémoire), qui survit aux conversations et au changement de modèle Ollama."
          >
            <Textarea
              rows={4}
              value={draft.systemPrompt}
              onChange={(event) => patch({ systemPrompt: event.target.value })}
            />
          </Field>
      </TabPanel>
      <TabPanel id="search" active={tab}>
          <div className="mt-1 flex flex-col gap-1">
            <span className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
              Recherche &amp; données boursières
            </span>
            <p className="text-xs leading-snug text-slate-500">
              Utilisés par les outils « web_search », « web_research », « fetch_page » et
              « get_stock_quote ». Pour une question d’actualité, Jarvis cherche sur Internet avant de
              répondre et cite ses sources avec leur date.
            </p>
            <p className="text-xs leading-snug text-slate-500">
              Sans clé ni compte : Google Actualités, Bing Actualités, DuckDuckGo, Bing, Google,
              Wikipédia et la météo Open-Meteo, avec repli automatique si l’un ne répond pas.
              Optionnel : une clé Brave Search ou Tavily (gratuite, sans carte, 1 000 recherches par
              mois) passe en premier — choisis le fournisseur puis colle la clé.
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
              hint="Stockée uniquement sur cette machine, jamais versionnée ni écrite dans les journaux."
            >
              <Input
                type="password"
                value={draft.searchApiKey}
                placeholder={draft.searchProvider === 'tavily' ? 'Clé Tavily (tvly-…)' : 'Clé Brave Search…'}
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

          <HomeLocationSettingsSection
            value={draft.homeLocation}
            onChange={(homeLocation) => patch(homeLocation ? { homeLocation } : { homeLocation: undefined })}
          />

          <PersonalizationSettingsSection />

          <KnowledgeSettingsSection
            learningEnabled={draft.localLearning.enabled}
            autoTrain={draft.localLearning.autoTrain === true}
            onLearningChange={(patch) => {
              const localLearning = { ...draft.localLearning, ...patch };
              setDraft((current) => ({ ...current, localLearning }));
              void window.jarvis.settings.set({ localLearning }).then((payload) => onSavedRef.current(payload));
            }}
          />
      </TabPanel>
      <TabPanel id="spotify" active={tab}>
          <div className="mt-1 flex flex-col gap-1">
            <span className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
              Musique
            </span>
            <p className="text-xs leading-snug text-slate-500">
              Utilisé par les huit outils « spotify_* » : recherche et lecture, pause, reprise, morceau
              suivant/précédent, volume, mode aléatoire, morceau en cours.
            </p>
          </div>

          <SpotifySettingsSection
            clientId={draft.spotifyClientId}
            onChange={(spotifyClientId) => patch({ spotifyClientId })}
            deviceName={draft.spotifyDeviceName ?? ''}
            onDeviceNameChange={(spotifyDeviceName) => patch({ spotifyDeviceName })}
          />
      </TabPanel>
      <TabPanel id="google" active={tab}>
          <GoogleSettingsSection
            clientId={draft.googleClientId}
            clientSecret={draft.googleClientSecret}
            access={draft.googleAccess}
            onChange={(values) => patch(values)}
          />
      </TabPanel>
      <TabPanel id="robot" active={tab}>
          <RoverSettingsSection
            baseUrl={draft.roverBaseUrl ?? ''}
            token={draft.roverToken ?? ''}
            onChange={(values) => patch(values)}
          />
      </TabPanel>
      <TabPanel id="phone" active={tab}>
          <PhoneSettingsSection />
      </TabPanel>
      <TabPanel id="speakers" active={tab}>
          <SpeakerSettingsSection />
      </TabPanel>
      <TabPanel id="tools" active={tab}>
          <div className="flex flex-col gap-3">
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
                La suppression de fichiers, l’élévation administrateur, l’exécution de commandes (
                <code className="text-slate-400">run_command</code>), les règles de blocage de sites,
                l’indexation d’un dossier et l’effacement de la mémoire documentaire demandent toujours
                une confirmation. Ce réglage n’est pas modifiable, quelle que soit la politique choisie
                ci-dessus.
              </p>
            </div>
          </div>

          <div className="mt-2 flex flex-col gap-1 border-t border-white/8 pt-4">
            <span className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
              Blocage de sites
            </span>
            <p className="text-xs leading-snug text-slate-500">
              Utilisé par les outils « siteblock_* » : mode travail, liste de sites, créneaux. Toute
              modification de règle demande une confirmation, même si tu as mis Applications à « jamais
              ».
            </p>
          </div>

          <SiteBlockSettingsSection
            baseUrl={draft.siteBlockBaseUrl}
            token={draft.siteBlockToken}
            onChange={(values) => patch(values)}
          />
      </TabPanel>
      <TabPanel id="general" active={tab}>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
            <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Cette machine</p>
            {settings.machine ? (
              <>
                <p className="mt-2 text-xs leading-relaxed text-slate-200">{settings.machine.detected}</p>
                <p className="mt-1 text-xs leading-relaxed text-cyan-100/90">{settings.machine.chosen}</p>
              </>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Aucun profil enregistré : Jarvis garde tes réglages actuels.
              </p>
            )}
            <Button className="mt-3" variant="subtle" size="sm" onClick={() => onAnalyzeMachine?.()}>
              Analyser à nouveau
            </Button>
            <p className="mt-2 text-[11px] leading-snug text-slate-500">
              Au démarrage, Jarvis ne mesure la machine que s’il n’y a pas encore de réglages. Ce bouton
              relance la mesure et applique le profil : modèle, voix et mode développeur peuvent changer.
            </p>
          </div>

          <Field label="Raccourci global" hint="Exemples : Control+Space, Alt+J, Super+K.">
            <Input value={draft.hotkey} onChange={(event) => patch({ hotkey: event.target.value })} />
          </Field>

          <Toggle
            label="Rester ouverte"
            hint="La fenêtre reste visible si tu cliques dans une autre application. Masquage uniquement par Ctrl+Espace, Échap, ou le bouton fermer."
            checked={draft.stayVisibleOnBlur}
            onChange={(stayVisibleOnBlur) => patch({ stayVisibleOnBlur })}
          />

          <Toggle
            label="Lancer au démarrage de Windows"
            checked={draft.launchAtLogin}
            onChange={(launchAtLogin) => patch({ launchAtLogin })}
          />

          <div className="mt-2 flex flex-col gap-1 border-t border-white/8 pt-4">
            <span className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
              Jarvis développeur
            </span>
          </div>
          <DeveloperSettingsSection
            developer={draft.developer}
            onSave={saveDeveloper}
            surface="general"
            onOpenAdvanced={() => setTab('developer')}
          />
      </TabPanel>
      <TabPanel id="updates" active={tab}>
          <UpdateSettingsSection />
      </TabPanel>
      <TabPanel id="developer" active={tab}>
          <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setTab('general')}>
            ← Retour aux réglages
          </Button>
          <DeveloperSettingsSection developer={draft.developer} onSave={saveDeveloper} surface="advanced" />
      </TabPanel>

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

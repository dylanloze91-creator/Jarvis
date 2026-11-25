/**
 * Les yeux, étape 2, point 1, côté PC : regarder une photo et répondre à une question sur n'importe
 * quel sujet (`docs/specs/yeux-etape-2.md`). La partie pure est dans `@jarvis/core` (`yeux/regarder.ts`).
 *
 * 1. Le modèle de vision (provisoirement `gemma3:4b`) regarde la photo. La carte graphique (6 Go) ne
 *    garde pas le 7B du chat et le modèle de vision ensemble : les modèles chargés sont déchargés
 *    avant (`keep_alive: 0`, comme pour Imager), et le modèle de vision repart aussitôt après sa
 *    réponse (`keep_alive: 0`). Le 7B se recharge ensuite tout seul pour la suite.
 * 2. Les références lues partent en recherche web avec les mêmes outils et les mêmes gardes que la
 *    recherche des cotes de l'atelier : moteurs de Jarvis avec repli, pages publiques lues comme
 *    `fetch_page` (`guardUrl`, anti-robot), le modèle local propose, Jarvis vérifie.
 * 3. Le modèle du chat écrit la réponse ; s'il ne répond pas, la réponse est assemblée sans lui.
 *
 * La photo n'est jamais écrite sur le disque ici : elle est envoyée au modèle de vision en mémoire.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  comparerCablage,
  consigneCablage,
  demandeCablage,
  FICHIER_REFERENCE_ENCEINTE,
  lireReponseCablage,
  questionCablage,
  referenceDemandee,
  referenceEnceinte,
  reponseCablage,
  type ComparaisonCablage,
  type LectureCablage,
  assessHtml,
  chercherReference,
  consigneReponseYeux,
  consigneVision,
  demandeReponseYeux,
  demandeVision,
  extractReadableText,
  fetchPublicText,
  finirReponseYeux,
  lireReponseVision,
  MODELE_VISION_PROVISOIRE,
  QUESTION_PAR_DEFAUT,
  referencesLues,
  reponseYeuxSansModele,
  resolveLocalSummaryModel,
  searchWithFallback,
  webProviderOrder,
  type DepsRechercheReference,
  type LectureVision,
  type PhotoYeux,
  type RechercheReference,
  type SearchProviderRegistry,
  type Settings,
} from '@jarvis/core';
import { OllamaControl } from '../images/OllamaControl.js';
import { guardUrl } from '../tools/web.js';

/** Durées au plus : la vision (chargement compris), toute la recherche, la réponse. */
export const VISION_DELAI_MS = 120_000;
export const RECHERCHE_DELAI_MS = 90_000;
export const REPONSE_DELAI_MS = 90_000;

export interface EntreeRegarder {
  photo: PhotoYeux;
  question: string;
  /** Réponse courte (enceinte, téléphone avec voix) : sans liste ni sources. */
  oral: boolean;
  avancement?: (message: string) => void;
  signal?: AbortSignal;
}

export interface SortieRegarder {
  texte: string;
  vision: LectureVision;
  recherches: RechercheReference[];
  modeleVision: string;
  /** Point 3 : présent quand la photo a été comparée à un câblage de référence. */
  cablage?: { lecture: LectureCablage; comparaison: ComparaisonCablage };
  /** Vrai si le modèle du chat a écrit la réponse ; faux : réponse assemblée sans lui. */
  parLeChat: boolean;
}

export type Regarder = (entree: EntreeRegarder) => Promise<SortieRegarder>;

export interface OptionsRegarder {
  getSettings: () => Settings;
  searchRegistry: SearchProviderRegistry;
  fetchImpl?: typeof fetch;
  /** Recherche web branchée autrement (essais). Absente : moteurs de Jarvis et pages publiques. */
  recherche?: Omit<DepsRechercheReference, 'modele'>;
  maintenant?: () => number;
  /**
   * Dossiers où chercher la copie de Jarvis (pour `firmware/jarvis-speaker/include/config.h`). Absent :
   * `developer.repoPath`, puis le dossier courant et ses deux parents.
   */
  racines?: () => string[];
}

/** Lit la référence de l'enceinte dans la première copie de Jarvis trouvée ; null si aucune. */
export async function lireReferenceEnceinte(racines: readonly string[]): Promise<{ texte: string; chemin: string } | null> {
  for (const racine of racines) {
    if (!racine) continue;
    const chemin = join(racine, FICHIER_REFERENCE_ENCEINTE);
    try {
      return { texte: await readFile(chemin, 'utf8'), chemin };
    } catch {
      // essayer la suivante
    }
  }
  return null;
}

function base64(octets: Uint8Array): string {
  return Buffer.from(octets.buffer, octets.byteOffset, octets.byteLength).toString('base64');
}

function signalAvec(delaiMs: number, signal?: AbortSignal): AbortSignal {
  const delai = AbortSignal.timeout(delaiMs);
  return signal ? AbortSignal.any([signal, delai]) : delai;
}

/** Le modèle du chat : le cerveau du chef d'orchestre, sinon le modèle Ollama du chat (comme l'atelier). */
export function modeleDuChat(settings: Settings): { model: string; baseUrl: string } {
  const local = resolveLocalSummaryModel(settings);
  const model = settings.orchestra?.enabled && settings.orchestra.brain ? settings.orchestra.brain : local.model;
  return { model, baseUrl: local.baseUrl };
}

export function creerRegarder(options: OptionsRegarder): Regarder {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maintenant = options.maintenant ?? Date.now;

  async function chat(
    baseUrl: string,
    body: Record<string, unknown>,
    delaiMs: number,
    signal?: AbortSignal,
  ): Promise<string> {
    const res = await fetchImpl(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stream: false, ...body }),
      signal: signalAvec(delaiMs, signal),
    });
    if (!res.ok) throw new Error(`Ollama a répondu HTTP ${res.status} (${String(body.model)})`);
    const payload = (await res.json()) as { message?: { content?: string } };
    return payload.message?.content ?? '';
  }

  const rechercheParDefaut: Omit<DepsRechercheReference, 'modele'> = {
    chercher: async (query) => {
      const settings = options.getSettings();
      const config = { provider: settings.searchProvider, apiKey: settings.searchApiKey };
      const r = await searchWithFallback(options.searchRegistry, webProviderOrder(options.searchRegistry, config), config, { query, limit: 6 });
      return r.results.map((x) => x.url);
    },
    lire: async (url, signal) => {
      const fetched = await fetchPublicText(url, { timeoutMs: 12_000, maxRedirects: 5, readLimit: 2_000_000, ...(signal ? { signal } : {}), guard: guardUrl });
      if (!fetched.ok) return null;
      const page = extractReadableText(fetched.text, 60_000);
      const a = assessHtml(fetched.text, page.text);
      if (a.antiBot || a.invalidHtml || a.empty || !page.text) return null;
      return page.title ? `${page.title}\n${page.text}` : page.text;
    },
  };

  return async function regarder(entree) {
    const settings = options.getSettings();
    const { model: modeleChat, baseUrl } = modeleDuChat(settings);
    const modeleVision = MODELE_VISION_PROVISOIRE;
    const question = entree.question.trim() || QUESTION_PAR_DEFAUT;
    const avance = entree.avancement ?? (() => undefined);

    // 1. Regarder. La carte graphique est libérée d'abord : le 7B et le modèle de vision n'y tiennent pas ensemble.
    avance('Je regarde la photo…');
    const ollama = new OllamaControl(baseUrl, fetchImpl);
    for (const m of await ollama.loaded()) {
      if (m.name !== modeleVision) await ollama.unload(m.name);
    }
    let noteReference = '';
    const voir = (consigne: string, demande: string, numPredict: number) =>
      chat(
        baseUrl,
        {
          model: modeleVision,
          format: 'json',
          keep_alive: 0,
          messages: [
            { role: 'system', content: consigne },
            { role: 'user', content: demande, images: [base64(entree.photo.octets)] },
          ],
          options: { temperature: 0, num_ctx: 4096, num_predict: numPredict },
        },
        VISION_DELAI_MS,
        entree.signal,
      );

    // Point 3 : « mon câblage de l'enceinte est bon ? » → comparaison à config.h, sans modèle du chat.
    if (questionCablage(question) && referenceDemandee(question) === 'enceinte') {
      const racines = options.racines?.() ?? [settings.developer?.repoPath ?? '', process.cwd(), resolve(process.cwd(), '..'), resolve(process.cwd(), '..', '..')];
      const source = await lireReferenceEnceinte(racines);
      if (source) {
        avance('Je suis les fils et je compare à la référence de l’enceinte…');
        const reference = referenceEnceinte(source.texte);
        const lecture = lireReponseCablage(await voir(consigneCablage(reference), demandeCablage(question), 900));
        const comparaison = comparerCablage(reference, lecture.fils);
        return {
          texte: reponseCablage({ comparaison, lecture, modeleVision, oral: entree.oral }),
          vision: { description: lecture.description, texteLu: [], reponse: '', doutes: lecture.doutes, brute: lecture.brute },
          recherches: [],
          modeleVision,
          cablage: { lecture, comparaison },
          parLeChat: false,
        };
      }
      noteReference = `Je n'ai pas trouvé la référence de l'enceinte (\`${FICHIER_REFERENCE_ENCEINTE}\`) : je regarde sans comparer.`;
      avance(noteReference);
    }

    const vision = lireReponseVision(await voir(consigneVision(), demandeVision(question), 700));

    // 2. Les références lues sur la photo partent en recherche web ; celles de la question seulement
    //    si la photo n'en montre aucune (« c'est bien un INMP441 ? » sur une photo sans texte lisible).
    const lues = referencesLues(vision.texteLu);
    const references = lues.length ? lues : referencesLues([question]);
    const recherches: RechercheReference[] = [];
    if (references.length) {
      const fin = maintenant() + RECHERCHE_DELAI_MS;
      const deps: DepsRechercheReference = {
        ...(options.recherche ?? rechercheParDefaut),
        modele: (systeme, demande, signal) =>
          chat(
            baseUrl,
            {
              model: modeleChat,
              format: 'json',
              messages: [
                { role: 'system', content: systeme },
                { role: 'user', content: demande },
              ],
              options: { temperature: 0, num_predict: 600, num_ctx: 8192 },
            },
            60_000,
            signal,
          ),
        maintenant,
      };
      for (const reference of references) {
        if (entree.signal?.aborted) break;
        recherches.push(await chercherReference({ reference, question, fin }, deps, avance, entree.signal));
      }
    }

    // 3. La réponse, écrite par le modèle du chat ; sans lui, assemblée à partir de ce qui est sûr.
    avance('J’écris la réponse…');
    let texte: string;
    let parLeChat = true;
    try {
      texte = (
        await chat(
          baseUrl,
          {
            model: modeleChat,
            messages: [
              { role: 'system', content: consigneReponseYeux(entree.oral) },
              { role: 'user', content: demandeReponseYeux({ question, vision, recherches }) },
            ],
            options: { temperature: 0.3, num_predict: entree.oral ? 200 : 600, num_ctx: 8192 },
          },
          REPONSE_DELAI_MS,
          entree.signal,
        )
      ).trim();
      if (!texte) throw new Error('réponse vide');
    } catch (error) {
      if (entree.signal?.aborted) throw error;
      parLeChat = false;
      texte = reponseYeuxSansModele({ vision, recherches });
    }
    return {
      texte: finirReponseYeux({
        texte: noteReference ? `${noteReference}\n\n${texte}` : texte,
        question,
        recherches,
        modeleVision,
        oral: entree.oral,
      }),
      vision,
      recherches,
      modeleVision,
      parLeChat,
    };
  };
}

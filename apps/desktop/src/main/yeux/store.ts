import { join } from 'node:path';
import { OEIL_MAX, verifierOeil, type Oeil } from '@jarvis/core';
import { readStateFile, writeStateFile } from '../safeFile.js';

/**
 * Registre des yeux, dans `userData/yeux.json` : hors de `settings.json` (comme les appendices et
 * les enceintes ; `parseSettings({})` ne gagne aucune clé), écriture sûre (`safeFile.ts`).
 *
 * On y garde les yeux ajoutés (webcam du PC, caméras réseau, iPhone) et les choix faits sur les
 * yeux connus d'avance (imprimante, rover, hub) : allumé ou coupé, adresse, caméra choisie.
 * Le jeton d'une caméra réseau n'est jamais écrit en clair : `jetonScelle` (`safeStorage`).
 * Une entrée illisible ou dans une chambre est écartée à la lecture ; le reste est gardé.
 */
export interface OeilEnregistre extends Oeil {
  jetonScelle?: string;
}

interface FichierYeux {
  yeux: OeilEnregistre[];
}

function lireFichier(bytes: Buffer): FichierYeux {
  const raw: unknown = JSON.parse(bytes.toString('utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('yeux.json : objet attendu');
  const liste = (raw as { yeux?: unknown }).yeux;
  const vus = new Set<string>();
  const yeux: OeilEnregistre[] = [];
  for (const entree of Array.isArray(liste) ? liste : []) {
    const verif = verifierOeil(entree);
    if (!verif.ok || vus.has(verif.oeil.id) || yeux.length >= OEIL_MAX) continue;
    vus.add(verif.oeil.id);
    const jeton = (entree as { jetonScelle?: unknown }).jetonScelle;
    yeux.push({ ...verif.oeil, ...(typeof jeton === 'string' && jeton.length <= 4096 ? { jetonScelle: jeton } : {}) });
  }
  return { yeux };
}

export class YeuxStore {
  private state: FichierYeux = { yeux: [] };
  private loaded = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: () => string) {}

  static inUserData(userData: () => string): YeuxStore {
    return new YeuxStore(() => join(userData(), 'yeux.json'));
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const read = await readStateFile(this.filePath(), lireFichier).catch(() => null);
    if (read && (read.status === 'ok' || read.status === 'restored')) this.state = read.value;
    this.loaded = true;
  }

  liste(): OeilEnregistre[] {
    return this.state.yeux.map((oeil) => ({ ...oeil }));
  }

  /** Ajoute ou remplace (même identifiant). Refuse une chambre, un œil incomplet, un registre plein. */
  async mettre(oeil: OeilEnregistre): Promise<{ ok: true } | { ok: false; raison: string }> {
    await this.load();
    const verif = verifierOeil({ ...oeil, jetonScelle: undefined });
    if (!verif.ok) return verif;
    const autres = this.state.yeux.filter((item) => item.id !== oeil.id);
    if (autres.length >= OEIL_MAX) return { ok: false, raison: `Pas plus de ${OEIL_MAX} yeux.` };
    const enregistre: OeilEnregistre = { ...verif.oeil, ...(oeil.jetonScelle ? { jetonScelle: oeil.jetonScelle } : {}) };
    this.state = { yeux: [...autres, enregistre] };
    await this.save();
    return { ok: true };
  }

  async retirer(id: string): Promise<boolean> {
    await this.load();
    const gardes = this.state.yeux.filter((item) => item.id !== id);
    if (gardes.length === this.state.yeux.length) return false;
    this.state = { yeux: gardes };
    await this.save();
    return true;
  }

  private save(): Promise<void> {
    const snapshot = JSON.stringify(this.state, null, 2);
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        await writeStateFile(this.filePath(), snapshot, { mode: 0o600, parse: lireFichier });
      });
    return this.writing;
  }
}

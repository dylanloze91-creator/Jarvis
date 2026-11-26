/**
 * Jarvis Développeur facile, étape 3 : les deux fichiers du suivi, sur le PC, hors des réglages et
 * hors des dépôts (décision D3) :
 *
 * - `userData/developer/facile/applis.json` : la liste des applis créées (« mes applis ») ;
 * - `userData/developer/facile/renfort.json` : ce qui a été dépensé chez Claude, par appli et par mois.
 *
 * Écriture sûre (`safeFile.ts`) : un fichier abîmé par une coupure est mis de côté, sa copie reprise.
 * Le registre des dépenses abîmé **et sans copie** fait échouer la lecture : mieux vaut ne pas
 * appeler Claude que repartir d'un compteur à zéro.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { emptyRenfortLedger, parseApps, parseRenfortLedger, renfortFileRefusal, writeApps, type FacileApp, type RenfortFile, type RenfortLedger } from '@jarvis/core';
import { readStateFile, writeStateFile } from '../safeFile.js';

const dossier = (userData: string) => join(userData, 'developer', 'facile');

export function facileAppsStore(userData: string): { read(): Promise<FacileApp[]>; write(apps: FacileApp[]): Promise<void> } {
  const fichier = join(dossier(userData), 'applis.json');
  const parse = (bytes: Buffer) => parseApps(bytes.toString('utf8'));
  return {
    read: async () => {
      const lu = await readStateFile(fichier, parse);
      return lu.status === 'ok' || lu.status === 'restored' ? lu.value : [];
    },
    write: (apps) => writeStateFile(fichier, writeApps(apps), { parse }),
  };
}

export function renfortLedgerStore(userData: string): { read(): Promise<RenfortLedger>; write(ledger: RenfortLedger): Promise<void> } {
  const fichier = join(dossier(userData), 'renfort.json');
  const parse = (bytes: Buffer) => parseRenfortLedger(bytes.toString('utf8'));
  return {
    read: async () => {
      const lu = await readStateFile(fichier, parse);
      if (lu.status === 'absent') return emptyRenfortLedger();
      if (lu.status === 'damaged') throw new Error('Le registre des dépenses chez Claude est illisible : je n’appelle pas Claude tant qu’il n’est pas réparé.');
      return lu.value;
    },
    write: (ledger) => writeStateFile(fichier, `${JSON.stringify(ledger, null, 2)}\n`, { parse }),
  };
}

/**
 * Lit des fichiers du dossier d'un projet, par chemins relatifs. Un chemin qui sort du dossier, un
 * fichier que la garde refuse (clés, réglages, dépendances) ou absent est ignoré.
 */
export async function readProjectFiles(folder: string, paths: readonly string[]): Promise<RenfortFile[]> {
  const base = resolve(folder);
  const out: RenfortFile[] = [];
  for (const path of paths) {
    if (renfortFileRefusal({ path, content: '' })) continue;
    const chemin = resolve(base, path);
    if (!chemin.startsWith(base + sep)) continue;
    try {
      const content = await readFile(chemin, 'utf8');
      if (content.length <= 200_000) out.push({ path: path.replace(/\\/g, '/'), content });
    } catch {
      /* absent ou illisible : ignoré */
    }
  }
  return out;
}

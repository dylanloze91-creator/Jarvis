import { mkdirSync } from 'node:fs';
import { app } from 'electron';
import { applyEditionPaths } from '@jarvis/core';
import { edition } from './edition.js';

/**
 * Premier module chargé par le processus principal.
 * Live : aucun setPath. Test : son dossier avant le verrou d'instance,
 * y compris le cache (`sessionData`), pour ne rien écrire chez Live.
 */
applyEditionPaths(edition(), {
  appData: () => app.getPath('appData'),
  ensureDir: (dir) => {
    mkdirSync(dir, { recursive: true });
  },
  setPath: (name, dir) => {
    app.setPath(name, dir);
  },
});

import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { readMachineSnapshot, type MachineSnapshot } from './machineStats';

const emptySnapshot = (): MachineSnapshot => ({
  cpuPercent: null,
  logicalCores: null,
  ramUsedBytes: null,
  ramTotalBytes: null,
  version: null,
});

function readVersion(packageJsonPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/** Relevé machine pour l'aperçu Vite (hors Electron). Les chiffres viennent de `os`. */
export function jarvisMachinePlugin(packageJsonPath: string): Plugin {
  return {
    name: 'jarvis-machine-snapshot',
    configureServer(server) {
      server.middlewares.use('/__jarvis/machine', (request, response, next) => {
        if (request.method !== 'GET') {
          next();
          return;
        }
        void readMachineSnapshot(readVersion(packageJsonPath))
          .then((snapshot) => {
            response.statusCode = 200;
            response.setHeader('content-type', 'application/json; charset=utf-8');
            response.setHeader('cache-control', 'no-store');
            response.end(JSON.stringify(snapshot));
          })
          .catch(() => {
            response.statusCode = 200;
            response.setHeader('content-type', 'application/json; charset=utf-8');
            response.end(JSON.stringify(emptySnapshot()));
          });
      });
    },
  };
}

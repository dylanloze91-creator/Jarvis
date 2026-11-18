import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Banc de vitesse : hors de `npm test` (il appelle le vrai Ollama et dure plusieurs minutes).
 * `npm run banc:vitesse --workspace @jarvis/desktop`.
 */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src/renderer/src') },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/main/vitesse/*.banc.ts'],
    testTimeout: 6_000_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});

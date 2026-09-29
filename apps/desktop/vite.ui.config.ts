import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { jarvisMachinePlugin } from './src/main/machinePlugin';

const require = createRequire(import.meta.url);
const onnxWasm = join(dirname(require.resolve('onnxruntime-web')), 'ort.wasm.min.mjs');

/** Serveur Vite du renderer seul, pour captures et aperçu hors Electron. */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, 'src/renderer/src') },
      { find: /^onnxruntime-web\/webgpu$/, replacement: onnxWasm },
      { find: /^onnxruntime-web$/, replacement: onnxWasm },
    ],
  },
  plugins: [react(), tailwindcss(), jarvisMachinePlugin(resolve(__dirname, 'package.json'))],
  server: {
    host: '127.0.0.1',
    port: 43173,
    strictPort: true,
  },
});

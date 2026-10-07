import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { jarvisMachinePlugin } from './src/main/machinePlugin';
// vosk-browser : worker sans `new Function` (CSP sans unsafe-eval), voir scripts/voskCspPatch.mjs.
import { voskCspPlugin } from './scripts/voskCspPatch.mjs';

const require = createRequire(import.meta.url);
// Un seul runtime ONNX pour Whisper et openWakeWord. transformers.js importe
// `onnxruntime-web/webgpu`, openWakeWord `onnxruntime-web` : les deux pointent
// sur `ort.wasm.min.mjs` (WebAssembly seul, ni JSEP ni WebGPU), donc un seul
// module, un seul `.wasm` (celui copié par setup:voice dans voice-assets/ort).
const onnxRuntimeWasm = join(dirname(require.resolve('onnxruntime-web')), 'ort.wasm.min.mjs');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          indicator: resolve(__dirname, 'src/preload/indicator.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: [
        { find: '@', replacement: resolve(__dirname, 'src/renderer/src') },
        // openWakeWord : WASM seul. Whisper (transformers.js) peut charger webgpu dans le worker.
        { find: /^onnxruntime-web$/, replacement: onnxRuntimeWasm },
      ],
    },
    plugins: [
      voskCspPlugin(),
      react(),
      tailwindcss(),
      jarvisMachinePlugin(resolve(__dirname, 'package.json')),
    ],
    // Worker de Whisper : module ES (imports dynamiques de transformers.js et du runtime).
    worker: { format: 'es' },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          indicator: resolve(__dirname, 'src/renderer/indicator.html'),
        },
      },
    },
  },
});

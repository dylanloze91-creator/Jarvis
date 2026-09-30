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
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: [
        { find: '@', replacement: resolve(__dirname, 'src/renderer/src') },
        { find: /^onnxruntime-web(\/webgpu)?$/, replacement: onnxRuntimeWasm },
      ],
    },
    plugins: [
      voskCspPlugin(),
      react(),
      tailwindcss(),
      jarvisMachinePlugin(resolve(__dirname, 'package.json')),
    ],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});

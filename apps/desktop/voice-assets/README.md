# Fichiers voix embarqués

Rempli par `npm run setup:voice` (lancé aussi par `dev` et `build`). Rien d'autre que ce README n'est commité.

```
ort/                          onnxruntime-web (WebAssembly seul), partagé par Whisper et openWakeWord
  ort-wasm-simd-threaded.mjs
  ort-wasm-simd-threaded.wasm
whisper/Xenova/whisper-base/  config, generation_config, preprocessor_config, tokenizer, tokenizer_config
  onnx/                       encoder_model_quantized.onnx, decoder_model_merged_quantized.onnx (q8)
openwakeword/                 melspectrogram.onnx, embedding_model.onnx, hey_jarvis_v0.1.onnx
```

Dans l'installateur, electron-builder copie ces trois dossiers à côté de `app.asar`, dans `resources/` (extraResources). Le renderer les lit uniquement par `jarvis-oww://<dossier>/<fichier>`, servi par le processus principal (`src/main/voiceAssetsProtocol.ts`), en dev comme une fois installé. La liste des fichiers requis est `REQUIRED_VOICE_ASSETS` dans `packages/core/src/speech/voiceAssets.ts`.

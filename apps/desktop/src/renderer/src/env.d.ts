/// <reference types="vite/client" />

import type { JarvisApi } from '../../shared/ipc';

declare global {
  interface Window {
    jarvis: JarvisApi;
    /** Barre de titre Windows native (réduire / agrandir / fermer). */
    jarvisNativeCaption?: boolean;
  }
}

export {};

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installPreviewBridge } from './preview/bridge';
import { installYoutubeWhisperListener } from './voice/youtubeWhisper';
import './index.css';

if (!window.jarvis) installPreviewBridge();
installYoutubeWhisperListener();

const container = document.getElementById('root');
if (!container) throw new Error('Élément racine introuvable.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

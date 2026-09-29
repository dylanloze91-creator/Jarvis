import { useEffect, useState } from 'react';

const WIDE_QUERY = '(min-width: 1100px)';

function readWide(): boolean {
  if (typeof window === 'undefined') return false;
  const forced = document.documentElement.dataset.jarvisChrome;
  if (forced === 'compact') return false;
  if (forced === 'dashboard') return true;
  const layout = new URLSearchParams(window.location.search).get('layout');
  if (layout === 'compact') return false;
  if (layout === 'dashboard') return true;
  return window.matchMedia(WIDE_QUERY).matches;
}

/** Fenêtre étroite : overlay. Fenêtre large : tableau de bord. */
export function useWideLayout(): boolean {
  const [wide, setWide] = useState(readWide);

  useEffect(() => {
    const sync = (): void => setWide(readWide());
    const media = window.matchMedia(WIDE_QUERY);
    media.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    return () => {
      media.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return wide;
}

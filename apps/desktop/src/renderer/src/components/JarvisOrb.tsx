import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';

const WAVE_BARS = 24;
const HISTORY = 6;

/**
 * Niveaux récents du micro, pour une forme d'onde qui bouge avec la voix.
 * Vide hors captation : rien ne s'anime pendant l'attente de « Jarvis ».
 */
export function useLevelHistory(level: number, listening: boolean, size = HISTORY): number[] {
  const [history, setHistory] = useState<number[]>([]);
  const last = useRef<number[]>([]);
  useEffect(() => {
    if (!listening) {
      last.current = [];
      setHistory([]);
      return;
    }
    last.current = [...last.current, level].slice(-size);
    setHistory(last.current);
  }, [level, listening, size]);
  return history;
}

/** Niveau RMS (0–0,3 en pratique) → 0–1, en compressant les forts niveaux. */
export function normalizedLevel(level: number): number {
  return Math.max(0, Math.min(1, Math.sqrt(Math.max(0, level) / 0.25)));
}

interface JarvisOrbProps {
  /** Vrai seulement pendant la captation d'une commande (après le réveil). */
  listening?: boolean;
  level?: number;
  className?: string;
}

export function JarvisOrb({ listening = false, level = 0, className }: JarvisOrbProps) {
  const history = useLevelHistory(level, listening);
  const current = listening ? normalizedLevel(level) : 0;
  return (
    <div
      className={cn('hero-orb', listening && 'is-listening', className)}
      style={{ '--level': current.toFixed(3) } as CSSProperties}
      data-listening={listening ? 'yes' : 'no'}
      aria-hidden
    >
      {listening ? (
        <div className="orb-wave">
          {Array.from({ length: WAVE_BARS }, (_, index) => {
            const sample = history[(index * 7) % Math.max(1, history.length)] ?? 0;
            const ripple = 0.55 + 0.45 * Math.abs(Math.sin(index * 1.7 + history.length));
            const height = 0.15 + normalizedLevel(sample) * ripple;
            return (
              <span
                key={index}
                style={{ transform: `rotate(${(360 / WAVE_BARS) * index}deg) translateY(-50px) scaleY(${height.toFixed(3)})` }}
              />
            );
          })}
        </div>
      ) : null}
      <div className="orb-core" />
      <div className="orb-ring ring-one" />
      <div className="orb-ring ring-two" />
      <div className="orb-glow" />
    </div>
  );
}

/** Logo à trois barres de l'en-tête : elles suivent la voix pendant la captation, sinon fixes. */
export function BrandMark({ listening = false, level = 0 }: { listening?: boolean; level?: number }) {
  const history = useLevelHistory(level, listening, 3);
  const heights = listening
    ? [0, 1, 2].map((index) => 4 + normalizedLevel(history[history.length - 1 - ((index + 1) % 3)] ?? 0) * 16)
    : null;
  return (
    <div className={cn('brand-mark', listening && 'is-listening')} data-listening={listening ? 'yes' : 'no'} aria-hidden>
      {[0, 1, 2].map((index) => (
        <span key={index} style={heights ? { height: `${heights[index]!.toFixed(1)}px` } : undefined} />
      ))}
    </div>
  );
}

import { MessageSquare, Code2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type JarvisAppMode = 'choose' | 'classic' | 'developer';

export function JarvisModePicker({
  onPick,
}: {
  onPick: (mode: Exclude<JarvisAppMode, 'choose'>) => void;
}) {
  return (
    <section className="jarvis-mode-picker" aria-label="Choisir Jarvis">
      <p className="jarvis-mode-picker-lead">Comment veux-tu parler à Jarvis ?</p>
      <div className="jarvis-mode-picker-grid">
        <button
          type="button"
          className={cn('jarvis-mode-card')}
          data-mode="classic"
          onClick={() => onPick('classic')}
        >
          <MessageSquare className="size-8 text-cyan-300" aria-hidden />
          <span className="jarvis-mode-card-title">Jarvis classique</span>
          <span className="jarvis-mode-card-hint">Questions, aide, recherche, musique…</span>
        </button>
        <button
          type="button"
          className={cn('jarvis-mode-card')}
          data-mode="developer"
          onClick={() => onPick('developer')}
        >
          <Code2 className="size-8 text-violet-300" aria-hidden />
          <span className="jarvis-mode-card-title">Jarvis développeur</span>
          <span className="jarvis-mode-card-hint">Modifier un projet, voir le résultat, discuter</span>
        </button>
      </div>
    </section>
  );
}

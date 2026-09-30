import { BrainCircuit, Globe2, Mic, Search, Sparkles } from 'lucide-react';
import type { ToolInfo } from '../../../shared/ipc';

const suggestions = [
  { text: 'Cherche les dernières infos importantes', icon: Globe2 },
  { text: 'Rappelle-moi ce que tu sais de mes projets', icon: BrainCircuit },
  { text: 'Analyse cette vidéo YouTube : ', icon: Search },
];

interface EmptyStateProps {
  tools: ToolInfo[];
  onPick: (text: string) => void;
}

export function EmptyState({ tools, onPick }: EmptyStateProps) {
  return (
    <div className="empty-stage">
      <div className="hero-orb" aria-hidden>
        <div className="orb-core" />
        <div className="orb-ring ring-one" />
        <div className="orb-ring ring-two" />
        <div className="orb-glow" />
      </div>
      <div className="relative z-10 text-center">
        <div className="mb-2 flex items-center justify-center gap-2 text-[10px] font-semibold tracking-[0.3em] text-cyan-200/60 uppercase">
          <Sparkles className="size-3" /> Système prêt
        </div>
        <h1 className="text-[24px] font-semibold tracking-tight text-white">
          Bonjour, je suis Jarvis.
        </h1>
        <p className="mx-auto mt-2 max-w-[390px] text-[13px] leading-relaxed text-slate-500">
          Recherche, mémoire, ordinateur, musique et commandes vocales. Dis-moi simplement ce que tu
          veux faire.
        </p>
      </div>
      <div className="relative z-10 mt-7 grid w-full max-w-[520px] gap-2 sm:grid-cols-3">
        {suggestions.map(({ text, icon: Icon }) => (
          <button key={text} type="button" onClick={() => onPick(text)} className="suggestion-card">
            <Icon className="size-4 text-cyan-200/80" />
            <span>{text}</span>
          </button>
        ))}
      </div>
      <div className="relative z-10 mt-5 flex items-center justify-center gap-2 text-[10px] text-slate-600">
        <Mic className="size-3" /> Dis « Jarvis » pour commencer
      </div>
      {tools.length > 0 ? (
        <div className="sr-only">{tools.length} outils disponibles</div>
      ) : null}
    </div>
  );
}

import type { ToolInfo } from '../../../shared/ipc';

const suggestions = [
  'Que se passe-t-il sur mon PC ?',
  'Pourquoi mon PC est lent ?',
  'Crée un dossier nommé Projet',
];

interface EmptyStateProps {
  tools: ToolInfo[];
  onPick: (text: string) => void;
}

export function EmptyState({ tools, onPick }: EmptyStateProps) {
  return (
    <div className="flex flex-col gap-4 px-4 py-5">
      <div>
        <p className="text-sm text-slate-300">Bonjour. Que puis-je faire pour toi ?</p>
        <p className="mt-1 text-xs text-slate-500">
          Pose une question, ou demande une action sur ton ordinateur.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onPick(suggestion)}
            className="no-drag rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-slate-100"
          >
            {suggestion}
          </button>
        ))}
      </div>

      {tools.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-white/8 pt-3">
          <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
            Outils disponibles
          </p>
          {tools.map((tool) => (
            <div key={tool.name} className="flex items-center gap-2 text-xs">
              <span className="font-mono text-slate-300">{tool.name}</span>
              <span
                className={
                  tool.risk === 'safe'
                    ? 'rounded-full bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-300'
                    : 'rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-300'
                }
              >
                {tool.risk === 'safe' ? 'sans risque' : 'confirmation'}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

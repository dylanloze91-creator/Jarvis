import { Button } from '@/components/ui/button';

export function ChatMissionReportCard({
  data,
  busy,
  onApply,
  onOpenFolder,
  onKeep,
  onDiscard,
}: {
  data: {
    markdown: string;
    worktreePath: string | null;
    taskClosed: null | 'kept' | 'discarded';
    applied: boolean;
  };
  busy: boolean;
  onApply: () => void;
  onOpenFolder: () => void;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-emerald-400/20 bg-emerald-950/20 px-3 py-3" data-chat-mission="report">
      <p className="text-[13px] font-medium text-emerald-100">Rapport de mission</p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-slate-200">{data.markdown}</pre>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || data.applied} onClick={onApply}>
          Appliquer à mon projet
        </Button>
        <Button size="sm" variant="subtle" disabled={busy || !data.worktreePath} onClick={onOpenFolder}>
          Ouvrir le dossier
        </Button>
        <Button size="sm" variant="ghost" disabled={busy || data.taskClosed === 'kept'} onClick={onKeep}>
          Garder
        </Button>
        <Button size="sm" variant="ghost" disabled={busy || data.taskClosed === 'discarded'} onClick={onDiscard}>
          Jeter
        </Button>
      </div>
    </section>
  );
}

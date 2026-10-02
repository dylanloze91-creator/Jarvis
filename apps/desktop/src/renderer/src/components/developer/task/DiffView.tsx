import { useState } from 'react';
import { ChevronRight, FileMinus2, FilePen, FilePlus2 } from 'lucide-react';
import type { DiffFile } from '@jarvis/core';
import { cn } from '@/lib/utils';

const STATUS = {
  added: { icon: FilePlus2, label: 'nouveau', tone: 'text-emerald-300' },
  deleted: { icon: FileMinus2, label: 'supprimé', tone: 'text-rose-300' },
  modified: { icon: FilePen, label: 'modifié', tone: 'text-sky-300' },
  renamed: { icon: FilePen, label: 'renommé', tone: 'text-sky-300' },
} as const;

/** Un fichier du diff : en-tête cliquable (+/−), lignes colorées avec leurs numéros. */
function DiffFileView({
  file,
  open: initiallyOpen,
  tag,
}: {
  file: DiffFile;
  open: boolean;
  tag?: string;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const status = STATUS[file.status];
  const Icon = status.icon;
  return (
    <div
      className="overflow-hidden rounded-lg border border-white/8 bg-black/25"
      data-diff-file={file.path}
    >
      <button
        type="button"
        className="no-drag flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-white/[0.03]"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-slate-500 transition-transform',
            open && 'rotate-90',
          )}
        />
        <Icon className={cn('size-3.5 shrink-0', status.tone)} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-200">
          {file.path}
        </span>
        {tag ? (
          <span className="rounded-full bg-amber-400/15 px-1.5 py-px text-[10px] text-amber-200">
            {tag}
          </span>
        ) : null}
        <span className="text-[11px] text-emerald-300">+{file.additions}</span>
        <span className="text-[11px] text-rose-300">−{file.deletions}</span>
      </button>
      {open ? (
        <div className="max-h-80 overflow-auto border-t border-white/8 font-mono text-[11px] leading-[1.45]">
          {file.binary ? <p className="px-3 py-2 text-slate-400">Fichier binaire.</p> : null}
          {file.hunks.map((hunk, h) => (
            <div key={`${hunk.header}-${h}`}>
              <div className="bg-sky-400/[0.06] px-3 py-0.5 text-sky-200/70">{hunk.header}</div>
              {hunk.lines.map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex whitespace-pre',
                    line.kind === 'add' && 'bg-emerald-400/[0.09] text-emerald-100',
                    line.kind === 'del' && 'bg-rose-500/[0.10] text-rose-100',
                    line.kind === 'context' && 'text-slate-400',
                  )}
                >
                  <span className="w-9 shrink-0 pr-1 text-right text-slate-600 select-none">
                    {line.oldLine ?? ''}
                  </span>
                  <span className="w-9 shrink-0 pr-1 text-right text-slate-600 select-none">
                    {line.newLine ?? ''}
                  </span>
                  <span className="w-4 shrink-0 text-center select-none">
                    {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                  </span>
                  <span className="pr-3">{line.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DiffView({
  files,
  openFirst = 1,
  tags = {},
}: {
  files: DiffFile[];
  /** Nombre de fichiers ouverts d'emblée. */
  openFirst?: number;
  tags?: Record<string, string>;
}) {
  if (files.length === 0) return <p className="text-xs text-slate-500">Aucune modification.</p>;
  return (
    <div className="flex flex-col gap-1.5" data-diff-view>
      {files.map((file, index) => (
        <DiffFileView
          key={file.path}
          file={file}
          open={index < openFirst}
          tag={tags[file.path.toLowerCase()]}
        />
      ))}
    </div>
  );
}

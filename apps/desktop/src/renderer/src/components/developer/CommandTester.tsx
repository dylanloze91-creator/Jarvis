import { useMemo, useState } from 'react';
import { classifyCommand } from '@jarvis/core';
import { Input } from '@/components/ui/field';
import { SafetyBadge, SafetyReasons, SectionTitle } from './parts';

const EXAMPLES = [
  'npm run typecheck',
  'npm ci',
  'git reset --hard',
  'cmd /c "git push"',
  'Remove-Item -Recurse C:\\dev',
];

function initialCommand(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('devtest') ?? '';
}

/** Montre le classement d'une commande. Rien n'est exécuté. */
export function CommandTester() {
  const [command, setCommand] = useState(initialCommand);
  const [sandbox, setSandbox] = useState(false);
  const safety = useMemo(
    () =>
      command.trim()
        ? classifyCommand(
            command,
            sandbox ? { insideSandbox: true, branch: 'jarvis-dev/essai' } : {},
          )
        : null,
    [command, sandbox],
  );
  return (
    <div className="flex flex-col gap-2" data-command-tester>
      <SectionTitle>Tri de sécurité des commandes</SectionTitle>
      <p className="text-xs leading-snug text-slate-500">
        Tape une commande pour voir comment Jarvis Développeur la classe. Rien n’est exécuté ici.
        Seuls les tests, le lint et la vérification des types, sous leur forme exacte et dans une
        copie isolée, partent sans te demander.
      </p>
      <Input
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        placeholder="Par exemple : git push"
        spellCheck={false}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setCommand(example)}
            className="no-drag rounded-md border border-white/8 bg-white/[0.03] px-2 py-0.5 font-mono text-[11px] text-slate-300 hover:bg-white/[0.07]"
          >
            {example}
          </button>
        ))}
        <label className="no-drag ml-auto flex items-center gap-1.5 text-[11px] text-slate-400">
          <input
            type="checkbox"
            checked={sandbox}
            onChange={(event) => setSandbox(event.target.checked)}
          />
          dans une copie isolée jarvis-dev/*
        </label>
      </div>
      {safety ? (
        <div
          className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
          data-safety-level={safety.level}
        >
          <div className="flex flex-wrap items-center gap-2">
            <SafetyBadge safety={safety} />
            <code className="min-w-0 truncate font-mono text-[11px] text-slate-300">
              {safety.command}
            </code>
          </div>
          <SafetyReasons safety={safety} />
          <p className="mt-1.5 text-[11px] text-slate-500">
            {safety.level === 'denied'
              ? 'Jamais lancée par Jarvis Développeur, même si tu le demandes.'
              : safety.runsWithoutAsking
                ? 'Peut partir sans te demander, seulement dans la copie isolée.'
                : 'Jarvis te montrerait cette commande exacte et attendrait ton accord.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}

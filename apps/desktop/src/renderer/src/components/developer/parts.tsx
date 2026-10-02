import { useState } from 'react';
import type { CommandClassification, CommandSafetyLevel, DevCheck } from '@jarvis/core';
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Loader2,
  Lock,
  ShieldCheck,
  XCircle,
  MinusCircle,
} from 'lucide-react';
import type { DevStep } from '../../../../shared/developerIpc';
import { cn } from '@/lib/utils';

export function SectionTitle({ children }: { children: string }) {
  return (
    <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{children}</p>
  );
}

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="mt-1 flex items-center gap-2">
      <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[11px] text-slate-200">
        {command}
      </code>
      <button
        type="button"
        className="no-drag flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-100"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => setCopied(true));
        }}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copied ? 'Copié' : 'Copier'}
      </button>
    </span>
  );
}

export function CheckList({ checks }: { checks: DevCheck[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {checks.map((check) => (
        <li key={check.id} className="flex items-start gap-2 text-xs leading-snug">
          {check.status === 'ok' ? (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
          ) : check.status === 'warn' ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
          ) : (
            <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-400" />
          )}
          <span className="flex flex-col">
            <span className="text-slate-200">
              {check.label} <span className="text-slate-400">— {check.detail}</span>
            </span>
            {check.command ? <CopyCommand command={check.command} /> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

const SAFETY_STYLE: Record<CommandSafetyLevel, { tone: string; icon: typeof Lock }> = {
  auto: { tone: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200', icon: ShieldCheck },
  confirm: { tone: 'border-sky-400/30 bg-sky-400/10 text-sky-200', icon: ShieldCheck },
  'always-confirm': { tone: 'border-amber-400/35 bg-amber-400/10 text-amber-200', icon: Lock },
  denied: { tone: 'border-rose-400/40 bg-rose-500/15 text-rose-200', icon: Ban },
};

export function SafetyBadge({ safety }: { safety: CommandClassification }) {
  const { tone, icon: Icon } = SAFETY_STYLE[safety.level];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        tone,
      )}
    >
      <Icon className="size-3" />
      {safety.label}
    </span>
  );
}

export function SafetyReasons({ safety }: { safety: CommandClassification }) {
  return (
    <ul className="mt-1.5 flex flex-col gap-0.5 text-[11px] leading-snug text-slate-300">
      {safety.reasons.slice(0, 5).map((reason) => (
        <li key={reason}>• {reason}</li>
      ))}
    </ul>
  );
}

export function StepTimeline({ steps }: { steps: DevStep[] }) {
  return (
    <ol className="flex flex-col gap-1.5" aria-label="Étapes">
      {steps.map((step) => (
        <li
          key={step.id}
          className="flex items-start gap-2 text-[13px] leading-snug"
          data-step-status={step.status}
        >
          {step.status === 'done' ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
          ) : step.status === 'running' ? (
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-cyan-300" />
          ) : step.status === 'failed' ? (
            <XCircle className="mt-0.5 size-4 shrink-0 text-rose-400" />
          ) : step.status === 'skipped' ? (
            <MinusCircle className="mt-0.5 size-4 shrink-0 text-slate-600" />
          ) : (
            <Circle className="mt-0.5 size-4 shrink-0 text-slate-600" />
          )}
          <span className="flex flex-col">
            <span
              className={cn(
                step.status === 'pending' || step.status === 'skipped'
                  ? 'text-slate-500'
                  : 'text-slate-100',
              )}
            >
              {step.label}
            </span>
            {step.detail ? <span className="text-xs text-slate-400">{step.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

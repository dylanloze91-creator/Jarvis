import { redactSecrets } from '../security/redact.js';
import type { ToolResult } from './types.js';

/**
 * Issue additive d'un outil. `ok` reste le booléen historique :
 * seul `success` est `ok: true`. Les cinq autres sont des échecs,
 * avec une phrase française pour l'utilisateur et un détail technique
 * (déjà rédigé) pour le journal.
 */
export const TOOL_OUTCOME_KINDS = [
  'success',
  'recoverable',
  'definitive',
  'timeout',
  'cancelled',
  'missing_dependency',
] as const;

export type ToolOutcomeKind = (typeof TOOL_OUTCOME_KINDS)[number];

export interface ClassifiedToolFailure {
  outcome: Exclude<ToolOutcomeKind, 'success'>;
  userMessage: string;
  technicalDetail: string;
}

const RAW_ERRNO =
  /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|ECONNABORTED|EADDRNOTAVAIL|UND_ERR_[A-Z0-9_]+)\b/;

export function outcomeFromResult(result: ToolResult): ToolOutcomeKind {
  if (result.outcome) return result.outcome;
  return result.ok ? 'success' : 'definitive';
}

export function toolSuccess(content: string, data?: unknown): ToolResult {
  return { ok: true, content, data, outcome: 'success' };
}

export function toolFailure(
  outcome: Exclude<ToolOutcomeKind, 'success'>,
  userMessage: string,
  technicalDetail: string,
  data?: unknown,
): ToolResult {
  return {
    ok: false,
    content: userMessage,
    outcome,
    technicalDetail: redactSecrets(technicalDetail),
    data,
  };
}

export function classifyThrownError(error: unknown): ClassifiedToolFailure {
  const technicalDetail = redactSecrets(technicalOf(error));
  const message = error instanceof Error ? error.message : String(error ?? '');
  const code = errnoCode(error);
  const name = error instanceof Error ? error.name : '';

  if (isTimeout(name, message, code)) {
    return {
      outcome: 'timeout',
      userMessage: "L'opération n'a pas répondu à temps. Je peux réessayer.",
      technicalDetail,
    };
  }
  if (isCancellation(name, message) && !isTimeout(name, message, code)) {
    return {
      outcome: 'cancelled',
      userMessage: "L'opération a été annulée.",
      technicalDetail,
    };
  }
  if (code === 'ECONNRESET' || /\bECONNRESET\b/.test(message)) {
    return {
      outcome: 'recoverable',
      userMessage: 'La connexion a été interrompue. Je peux réessayer.',
      technicalDetail,
    };
  }
  if (isMissingDependency(message, code)) {
    return {
      outcome: 'missing_dependency',
      userMessage: "Une dépendance nécessaire est absente. L'action n'a pas été faite.",
      technicalDetail,
    };
  }
  if (isRecoverableNetwork(message, code)) {
    return {
      outcome: 'recoverable',
      userMessage: "Un problème temporaire a empêché l'action. Je peux réessayer.",
      technicalDetail,
    };
  }
  if (RAW_ERRNO.test(message) || (code != null && RAW_ERRNO.test(code))) {
    return {
      outcome: 'recoverable',
      userMessage: "Un problème temporaire a empêché l'action. Je peux réessayer.",
      technicalDetail,
    };
  }

  const sentence = message.replace(/\s+/g, ' ').trim();
  return {
    outcome: 'definitive',
    userMessage: sentence || "L'action n'a pas pu aboutir.",
    technicalDetail,
  };
}

/** Phrase montrée à l'utilisateur : jamais un code brut, jamais un secret. */
export function presentUserContent(result: ToolResult): string {
  const content = result.content ?? '';
  if (!RAW_ERRNO.test(content)) return redactSecrets(content);
  return classifyThrownError(new Error(content)).userMessage;
}

function technicalOf(error: unknown): string {
  if (error instanceof Error) {
    const code = errnoCode(error);
    return code ? `${error.name} [${code}]: ${error.message}` : `${error.name}: ${error.message}`;
  }
  return String(error ?? '');
}

function errnoCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function isTimeout(name: string, message: string, code: string | undefined): boolean {
  return (
    name === 'TimeoutError' ||
    code === 'ETIMEDOUT' ||
    code === 'ABORT_ERR' && /timeout/i.test(message) ||
    /timeout|délai dépassé|timed out/i.test(message) ||
    (name === 'AbortError' && /timeout/i.test(message))
  );
}

function isCancellation(name: string, message: string): boolean {
  return name === 'AbortError' || /aborted|annul/i.test(message);
}

function isMissingDependency(message: string, code: string | undefined): boolean {
  return (
    code === 'MODULE_NOT_FOUND' ||
    /cannot find module|module introuvable|nomic-embed-text|command not found|introuvable sur le système/i.test(
      message,
    )
  );
}

function isRecoverableNetwork(message: string, code: string | undefined): boolean {
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENETUNREACH' ||
    code === 'EAI_AGAIN' ||
    code === 'EHOSTUNREACH' ||
    /network|fetch failed|socket hang up/i.test(message)
  );
}

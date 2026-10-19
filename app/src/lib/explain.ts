// Plain-language reasons for how a run ended. `error` is the code the core
// stored on the run; unknown codes are shown as they are rather than guessed.
// Texts live in i18n/ns/explain.ts; callers pass the active messages.

import type { Messages } from '../i18n/messages';

// Provider errors about a missing or rejected API key arrive as raw SDK text.
const AUTH_ERROR = /authentication|api[ _-]?key|unauthorized|\b401\b/i;

/** Errors that the Einrichtung page can fix (missing/rejected key, model without tools). */
export function needsSetup(error: string | null | undefined): boolean {
  return Boolean(error) && (AUTH_ERROR.test(error as string) || error === 'model_without_tools' || error === 'key_missing');
}

export function explainFailure(t: Messages, error: string | null | undefined): string {
  const x = t.explain;
  if (error && AUTH_ERROR.test(error)) return x.authError;
  switch (error) {
    case 'no_source_items':
    case 'already_running':
    case 'budget_exceeded':
    case 'agent_disabled':
    case 'interrupted':
      return x.run[error];
    case 'global_budget_exceeded':
      return x.run.budget_exceeded;
    default:
      return error ?? x.unknown;
  }
}

export function explainPartial(t: Messages, error: string | null | undefined): string {
  if (error?.startsWith('traceability')) return t.explain.partial.traceability;
  if (error?.startsWith('schema_violation')) return t.explain.partial.schema;
  return error ?? t.explain.unknown;
}

const RUN_STATUS_CLASS: Record<string, string> = {
  success: 'text-ink',
  partial: 'text-warning',
  failed: 'text-danger',
  running: 'text-ink-soft',
};

/** Label (a word, never colour alone) and colour of a run status. */
export function runStatus(t: Messages, status: string): { label: string; cls: string } | undefined {
  const label = (t.explain.runStatus as Record<string, string>)[status];
  return label ? { label, cls: RUN_STATUS_CLASS[status] ?? '' } : undefined;
}

// How a question to "Fragen" ended, when there is no answer to show.
export function explainAsk(t: Messages, error: string | null | undefined): string {
  const x = t.explain;
  if (error && AUTH_ERROR.test(error)) return x.authError;
  switch (error) {
    case 'model_without_tools':
    case 'ungrounded':
    case 'no_valid_citations':
    case 'invalid_output':
    case 'step_limit':
    case 'already_running':
    case 'agent_disabled':
    case 'no_route':
    case 'unknown_ressort':
    case 'invalid_question':
    case 'budget_exceeded':
      return x.ask[error];
    case 'global_budget_exceeded':
      return x.ask.budget_exceeded;
    case 'delegate_unavailable':
    case 'invalid_routes':
      return x.ask.not_set_up;
    default:
      return error ? x.ask.requestFailed(error) : x.unknown;
  }
}

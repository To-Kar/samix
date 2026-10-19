// Plain-language reasons for how a run ended. `error` is the code the core
// stored on the run; unknown codes are shown as they are rather than guessed.

export function explainFailure(error: string | null | undefined): string {
  switch (error) {
    case 'no_source_items':
      return 'Keine Quelle lieferte Beiträge (Netzwerk oder Quellen prüfen). Es wurde nichts bezahlt.';
    case 'already_running':
      return 'Es lief bereits ein Lauf.';
    case 'budget_exceeded':
    case 'global_budget_exceeded':
      return 'Tagesbudget erreicht.';
    case 'agent_disabled':
      return 'Das Ressort ist ausgeschaltet.';
    case 'interrupted':
      return 'Der Lauf wurde unterbrochen (App beendet oder abgestürzt).';
    default:
      return error ?? 'unbekannt';
  }
}

export function explainPartial(error: string | null | undefined): string {
  if (error?.startsWith('traceability')) {
    return 'Das Modell nannte Quellen, die nicht abgerufen wurden. Es wurde nichts veröffentlicht.';
  }
  if (error?.startsWith('schema_violation')) return 'Die Modellantwort war nicht im erwarteten Format.';
  return error ?? 'unbekannt';
}

export const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  success: { label: 'ok', cls: 'text-emerald-700 dark:text-emerald-400' },
  partial: { label: 'teilweise', cls: 'text-amber-700 dark:text-amber-400' },
  failed: { label: 'fehlgeschlagen', cls: 'text-red-700 dark:text-red-400' },
  running: { label: 'läuft', cls: 'text-neutral-500' },
};

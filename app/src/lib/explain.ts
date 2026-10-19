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

// How a question to "Fragen" ended, when there is no answer to show.
export function explainAsk(error: string | null | undefined): string {
  switch (error) {
    case 'model_without_tools':
      return 'Das eingestellte Modell kann keine Werkzeuge nutzen und würde aus dem Gedächtnis antworten. Wähle unter „Modell“ Claude oder DeepSeek.';
    case 'budget_exceeded':
    case 'global_budget_exceeded':
      return 'Tagesbudget erreicht. Die Frage wurde nicht (weiter) bearbeitet.';
    case 'ungrounded':
      return 'Das Modell hat nicht in den gesammelten Artikeln gesucht. Eine Antwort aus Allgemeinwissen wird nicht angezeigt.';
    case 'no_valid_citations':
      return 'Das Modell fand Artikel, konnte seine Antwort aber nicht mit ihnen belegen. Eine unbelegte Antwort wird nicht angezeigt.';
    case 'invalid_output':
      return 'Die Modellantwort war nicht im erwarteten Format. Versuche es noch einmal.';
    case 'step_limit':
      return 'Die Frage war zu aufwendig (Schrittlimit erreicht). Stelle sie enger oder in Teilen.';
    case 'already_running':
      return 'Es wird bereits eine Frage bearbeitet.';
    case 'agent_disabled':
      return 'Die Auskunft ist ausgeschaltet.';
    case 'no_route':
      return 'Ich konnte nicht entscheiden, was zu tun ist. Ich kann in deiner Zeitung suchen, deine Notizen zeigen oder ein Ressort-Update vorschlagen.';
    case 'unknown_ressort':
      return 'Dieses Ressort gibt es nicht oder es ist ausgeschaltet.';
    case 'delegate_unavailable':
    case 'invalid_routes':
      return 'Die Auskunft ist in dieser Installation nicht vollständig eingerichtet.';
    case 'invalid_question':
      return 'Die Frage ist leer oder zu lang (höchstens 2000 Zeichen).';
    default:
      return error ? `Die Anfrage an das Modell ist fehlgeschlagen: ${error}` : 'unbekannt';
  }
}

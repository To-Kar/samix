// Plain-language reasons for how a run ended. `error` is the code the core
// stored on the run; unknown codes are shown as they are rather than guessed.

// Provider errors about a missing or rejected API key arrive as raw SDK text.
const AUTH_ERROR = /authentication|api[ _-]?key|unauthorized|\b401\b/i;
const AUTH_TEXT =
  'Für das eingestellte Modell fehlt der API-Schlüssel oder er wurde abgelehnt. Trage ihn unter „Einstellungen“ ein (in der Entwicklungs-App danach neu starten) und prüfe, ob das Modell zum Schlüssel passt (Ressorts → Modell).';

/** Errors that the Einrichtung page can fix (missing/rejected key, model without tools). */
export function needsSetup(error: string | null | undefined): boolean {
  return Boolean(error) && (AUTH_ERROR.test(error as string) || error === 'model_without_tools' || error === 'key_missing');
}

export function explainFailure(error: string | null | undefined): string {
  if (error && AUTH_ERROR.test(error)) return AUTH_TEXT;
  switch (error) {
    case 'no_source_items':
      return 'Keine Quelle lieferte Beiträge (Netzwerk, Quellen oder – bei der Websuche – Perplexity-Schlüssel und Tageslimit prüfen). Das Modell wurde nicht aufgerufen.';
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
  success: { label: 'ok', cls: 'text-ink' },
  partial: { label: 'teilweise', cls: 'text-warning' },
  failed: { label: 'fehlgeschlagen', cls: 'text-danger' },
  running: { label: 'läuft', cls: 'text-ink-soft' },
};

// How a question to "Fragen" ended, when there is no answer to show.
export function explainAsk(error: string | null | undefined): string {
  if (error && AUTH_ERROR.test(error)) return AUTH_TEXT;
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

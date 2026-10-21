// Plain-language reasons for how a run or a question ended.

export const de = {
  explain: {
    authError:
      'Für das eingestellte Modell fehlt der API-Schlüssel oder er wurde abgelehnt. Trage ihn unter „Einrichtung“ ein (in der Entwicklungs-App danach neu starten) und prüfe, ob das Modell zum Schlüssel passt (Ressorts → Modell).',
    unknown: 'unbekannt',
    run: {
      no_source_items:
        'Keine Quelle lieferte Beiträge (Netzwerk, Quellen oder – bei der Websuche – Perplexity-Schlüssel und Tageslimit prüfen). Das Modell wurde nicht aufgerufen.',
      already_running: 'Es lief bereits ein Lauf.',
      budget_exceeded: 'Tagesbudget erreicht.',
      agent_disabled: 'Das Ressort ist ausgeschaltet.',
      interrupted: 'Der Lauf wurde unterbrochen (App beendet oder abgestürzt).',
    },
    partial: {
      traceability: 'Das Modell nannte Quellen, die nicht abgerufen wurden. Es wurde nichts veröffentlicht.',
      schema: 'Die Modellantwort war nicht im erwarteten Format.',
    },
    ask: {
      model_without_tools:
        'Das eingestellte Modell kann keine Werkzeuge nutzen und würde aus dem Gedächtnis antworten. Wähle unter „Modell“ Claude oder DeepSeek.',
      budget_exceeded: 'Tagesbudget erreicht. Die Frage wurde nicht (weiter) bearbeitet.',
      question_budget_exceeded: 'Das Budget für diese Frage ist aufgebraucht. Stelle sie enger oder in Teilen.',
      delegation_cycle: 'Die Agenten verweisen im Kreis aufeinander. Prüfe die Weiterleitungen in den Manifesten.',
      delegation_too_deep: 'Die Kette der Weiterleitungen ist zu lang (höchstens 3 Agenten).',
      ungrounded:
        'Das Modell hat nicht in den gesammelten Artikeln gesucht. Eine Antwort aus Allgemeinwissen wird nicht angezeigt.',
      no_valid_citations:
        'Das Modell fand Artikel, konnte seine Antwort aber nicht mit ihnen belegen. Eine unbelegte Antwort wird nicht angezeigt.',
      invalid_output: 'Die Modellantwort war nicht im erwarteten Format. Versuche es noch einmal.',
      step_limit: 'Die Frage war zu aufwendig (Schrittlimit erreicht). Stelle sie enger oder in Teilen.',
      already_running: 'Es wird bereits eine Frage bearbeitet.',
      agent_disabled: 'Die Auskunft ist ausgeschaltet.',
      no_route:
        'Ich konnte nicht entscheiden, was zu tun ist. Ich kann in deiner Zeitung suchen, deine Notizen zeigen oder ein Ressort-Update vorschlagen.',
      unknown_ressort: 'Dieses Ressort gibt es nicht oder es ist ausgeschaltet.',
      not_set_up: 'Die Auskunft ist in dieser Installation nicht vollständig eingerichtet.',
      invalid_question: 'Die Frage ist leer oder zu lang (höchstens 2000 Zeichen).',
      requestFailed: (error: string) => `Die Anfrage an das Modell ist fehlgeschlagen: ${error}`,
    },
    runStatus: {
      success: 'ok',
      partial: 'teilweise',
      failed: 'fehlgeschlagen',
      running: 'läuft',
    },
  },
};

export const en: typeof de = {
  explain: {
    authError:
      'The selected model has no API key, or the key was rejected. Enter it under “Setup” (restart the development app afterwards) and check that the model matches the key (Sections → Model).',
    unknown: 'unknown',
    run: {
      no_source_items:
        'No source delivered any items (check the network, the sources or — for web search — the Perplexity key and daily limit). The model was not called.',
      already_running: 'A run was already in progress.',
      budget_exceeded: 'Daily budget reached.',
      agent_disabled: 'This section is switched off.',
      interrupted: 'The run was interrupted (app quit or crashed).',
    },
    partial: {
      traceability: 'The model cited sources that were not fetched. Nothing was published.',
      schema: 'The model response was not in the expected format.',
    },
    ask: {
      model_without_tools:
        'The selected model cannot use tools and would answer from memory. Choose Claude or DeepSeek under “Model”.',
      budget_exceeded: 'Daily budget reached. The question was not (further) processed.',
      question_budget_exceeded: "This question's budget is used up. Ask it more narrowly or in parts.",
      delegation_cycle: 'The agents point at each other in a circle. Check the delegations in the manifests.',
      delegation_too_deep: 'The chain of delegations is too long (at most 3 agents).',
      ungrounded: 'The model did not search the collected articles. An answer from general knowledge is not shown.',
      no_valid_citations:
        'The model found articles but could not back its answer with them. An unsupported answer is not shown.',
      invalid_output: 'The model response was not in the expected format. Please try again.',
      step_limit: 'The question took too many steps. Ask it more narrowly or in parts.',
      already_running: 'A question is already being processed.',
      agent_disabled: 'Ask is switched off.',
      no_route:
        'I could not decide what to do. I can search your newspaper, show your notes or suggest a section update.',
      unknown_ressort: 'This section does not exist or is switched off.',
      not_set_up: 'Ask is not fully set up in this installation.',
      invalid_question: 'The question is empty or too long (at most 2000 characters).',
      requestFailed: (error) => `The request to the model failed: ${error}`,
    },
    runStatus: {
      success: 'ok',
      partial: 'partial',
      failed: 'failed',
      running: 'running',
    },
  },
};

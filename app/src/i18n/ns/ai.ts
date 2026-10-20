// Einrichtung → KI: simple/advanced mode, local model, own model, extra instructions.

export const de = {
  ai: {
    title: 'KI-Modus',
    simple: 'Einfach',
    advanced: 'Erweitert',
    simpleHint:
      'Einfach: Die Agenten laufen nur mit den eingebauten Modellen und ihren eigenen Prompts. Das lokale Modell kannst du immer einstellen.',
    advancedHint:
      'Erweitert: Zusätzlich wirken ein eigenes Modell und eigene Zusatzanweisungen je Agent. Quellenbindung, Zitatprüfung und Budgets bleiben unverändert und werden vom Programm erzwungen, nicht vom Prompt.',
    local: 'Lokales Modell (Ollama)',
    localHint:
      'Adresse und Modellname deines lokalen Ollama. Es bleibt alles auf deinem Rechner. Lokale Modelle können hier keine Werkzeuge aufrufen, daher kein „Frag deine Zeitung“.',
    localUrl: 'Adresse',
    localModel: 'Modellname (Tag)',
    localSource: { app: 'In der App gesetzt', env: 'Aus der Umgebung (Entwicklung)', default: 'Standardwert' },
    save: 'Speichern',
    reset: 'Zurücksetzen',
    test: 'Testen',
    testing: 'Testet …',
    saved: 'Gespeichert.',
    saveFailed: (e: string) => `Speichern fehlgeschlagen: ${e}`,
    testOk: (ms: number) => `Antwort erhalten (${ms} ms).`,
    testFailed: (e: string) => `Test fehlgeschlagen: ${e}`,
    custom: 'Eigenes Modell',
    customHint:
      'Jeder Dienst mit OpenAI-kompatibler Schnittstelle („/chat/completions“), auch auf deinem Rechner oder im Heimnetz. Samix kennt den Preis nicht: Trage ihn selbst ein, sonst stimmen die Kosten nicht und das Modell läuft nicht. Ob der Dienst Werkzeuge kann, weiß Samix auch nicht; du gibst es an.',
    customUrl: 'Basis-Adresse (z. B. http://127.0.0.1:1234/v1)',
    customName: 'Modellname beim Dienst',
    customIn: 'Preis Eingabe (USD je Mio. Tokens)',
    customOut: 'Preis Ausgabe (USD je Mio. Tokens)',
    customTools: 'Das Modell kann Werkzeuge aufrufen (nötig für „Frag deine Zeitung“)',
    customKey: 'API-Schlüssel (optional)',
    customKeyHint: 'Liegt im Schlüsselbund; die App startet den Core danach neu.',
    customRemove: 'Eigenes Modell entfernen',
    customUsable: 'Bereit: Es erscheint jetzt in der Modellauswahl der Agenten.',
    customNotUsable: 'Noch nicht nutzbar (Adresse, Name und Preis fehlen).',
    customDataNote: 'Alles, was ein Agent mit diesem Modell bearbeitet, geht an diese Adresse.',
    instructions: 'Zusatzanweisungen je Agent',
    instructionsHint:
      'Werden an den Prompt des Agenten angehängt, nie an seine Stelle gesetzt. Sie wirken nur im erweiterten Modus und gelten ab dem nächsten Lauf oder der nächsten Frage.',
    instructionsInactive: 'Gespeichert, aber im einfachen Modus ohne Wirkung.',
    instructionsPlaceholder: 'z. B. „Schreibe knapp, höchstens zwei Sätze.“',
    instructionsCount: (n: number, max: number) => `${n} / ${max} Zeichen`,
  },
};

export const en: typeof de = {
  ai: {
    title: 'AI mode',
    simple: 'Simple',
    advanced: 'Advanced',
    simpleHint:
      'Simple: agents run only with the built-in models and their own prompts. You can always configure the local model.',
    advancedHint:
      'Advanced: your own model and your own extra instructions per agent also take effect. Source binding, citation checks and budgets stay as they are and are enforced by the program, not by the prompt.',
    local: 'Local model (Ollama)',
    localHint:
      'Address and model name of your local Ollama. Everything stays on your computer. Local models cannot call tools here, so no “Ask your paper”.',
    localUrl: 'Address',
    localModel: 'Model name (tag)',
    localSource: { app: 'Set in the app', env: 'From the environment (development)', default: 'Default' },
    save: 'Save',
    reset: 'Reset',
    test: 'Test',
    testing: 'Testing …',
    saved: 'Saved.',
    saveFailed: (e) => `Saving failed: ${e}`,
    testOk: (ms) => `Got a reply (${ms} ms).`,
    testFailed: (e) => `Test failed: ${e}`,
    custom: 'Own model',
    customHint:
      'Any service with an OpenAI-compatible interface (“/chat/completions”), also on your computer or home network. Samix does not know the price: enter it yourself, otherwise the costs would be wrong and the model will not run. Samix does not know whether the service can call tools either; you say so.',
    customUrl: 'Base address (e.g. http://127.0.0.1:1234/v1)',
    customName: 'Model name at the service',
    customIn: 'Input price (USD per million tokens)',
    customOut: 'Output price (USD per million tokens)',
    customTools: 'The model can call tools (needed for “Ask your paper”)',
    customKey: 'API key (optional)',
    customKeyHint: 'Stored in the keychain; the app restarts the core afterwards.',
    customRemove: 'Remove own model',
    customUsable: 'Ready: it now appears in the agents’ model choice.',
    customNotUsable: 'Not usable yet (address, name and price are missing).',
    customDataNote: 'Everything an agent processes with this model is sent to this address.',
    instructions: 'Extra instructions per agent',
    instructionsHint:
      'Appended to the agent’s prompt, never replacing it. They only take effect in advanced mode, from the next run or question.',
    instructionsInactive: 'Saved, but without effect in simple mode.',
    instructionsPlaceholder: 'e.g. “Keep it short, two sentences at most.”',
    instructionsCount: (n, max) => `${n} / ${max} characters`,
  },
};

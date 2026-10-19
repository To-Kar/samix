// Model per agent and article votes.

export const de = {
  agentModel: {
    keyPresent: ' – Schlüssel vorhanden',
    noKey: ' – kein Schlüssel',
    local: ' – lokal',
    saved: 'Gespeichert – der nächste Lauf verwendet dieses Modell.',
    saveFailed: (error: string) => `Speichern fehlgeschlagen: ${error}`,
    primary: 'Hauptmodell',
    fallback: 'Ersatzmodell',
    none: 'keines',
    missingKey: (model: string, env: string) => `Für ${model} fehlt der Schlüssel (${env}). Bitte zuerst unter „Einrichtung“ eintragen.`,
    save: 'Modell speichern',
  },
  vote: {
    label: 'Bewertung',
    more: 'Mehr davon',
    less: 'Weniger davon',
  },
  native: {
    pickProjectFolder: 'Projektordner wählen',
  },
};

export const en: typeof de = {
  agentModel: {
    keyPresent: ' – key present',
    noKey: ' – no key',
    local: ' – local',
    saved: 'Saved – the next run uses this model.',
    saveFailed: (error) => `Saving failed: ${error}`,
    primary: 'Main model',
    fallback: 'Fallback model',
    none: 'none',
    missingKey: (model, env) => `${model} has no key (${env}). Please enter it under “Setup” first.`,
    save: 'Save model',
  },
  vote: {
    label: 'Vote',
    more: 'More of this',
    less: 'Less of this',
  },
  native: {
    pickProjectFolder: 'Choose project folder',
  },
};

// App shell: navigation, connection state, status words, model hint.

export const de = {
  status: {
    error: 'Fehler:',
    warning: 'Warnung:',
    notice: 'Hinweis:',
  },
  app: {
    coreConfigUnavailable: 'Core-Konfiguration nicht verfügbar',
    coreConfigHint: (cmd: string, vars: string) =>
      `Läuft ${cmd}, und wurden ${vars} an den Tauri-Prozess übergeben?`,
    connecting: 'Verbinde …',
    navLabel: 'Bereiche',
    ask: 'Fragen',
    askClose: 'Fragen schließen',
    ressorts: 'Ressorts',
    ressortsClose: 'Ressorts schließen',
    setup: 'Einrichtung',
    setupClose: 'Einrichtung schließen',
    appearance: 'Aussehen',
    language: 'Sprache',
    languageHint: 'Gilt für die Oberfläche.',
    articleLanguage: 'Sprache der Artikel',
    articleLanguageFollow: 'Wie die App',
    articleLanguageHint:
      'Gilt ab dem nächsten Abruf: Die Agenten schreiben Titel und Zusammenfassungen in dieser Sprache. Bereits abgerufene Artikel bleiben, wie sie sind. Ob ein Modell die Vorgabe befolgt, prüft Samix nicht.',
    quote: (text: string) => `„${text}“`,
  },
  banner: {
    unreachable: 'Fehler: Samix-Core nicht erreichbar.',
    unreachableDev: 'Läuft `pnpm dev:core` noch?',
    unreachableApp: 'Beim Neustart des Cores kann das kurz auftreten.',
    connected: (version: string, seconds: number) => `Core verbunden · v${version} · läuft seit ${seconds} s`,
    connecting: 'Verbinde mit dem Core …',
  },
  modelHint: {
    switched: (n: number, model: string, names: string) =>
      `${n} ${n === 1 ? 'Agent' : 'Agenten'} auf ${model} umgestellt: ${names}.`,
    missingKey: (names: string, options: string) =>
      `Für ${names} fehlt der API-Schlüssel, für ${options} ist einer eingetragen.`,
    and: ' und ',
    switchTo: (model: string) => `Auf ${model} umstellen`,
  },
};

export const en: typeof de = {
  status: {
    error: 'Error:',
    warning: 'Warning:',
    notice: 'Note:',
  },
  app: {
    coreConfigUnavailable: 'Core configuration unavailable',
    coreConfigHint: (cmd, vars) => `Is ${cmd} running, and were ${vars} passed to the Tauri process?`,
    connecting: 'Connecting …',
    navLabel: 'Sections',
    ask: 'Ask',
    askClose: 'Close Ask',
    ressorts: 'Sections',
    ressortsClose: 'Close sections',
    setup: 'Setup',
    setupClose: 'Close setup',
    appearance: 'Appearance',
    language: 'Language',
    languageHint: 'Applies to the interface.',
    articleLanguage: 'Article language',
    articleLanguageFollow: 'Same as the app',
    articleLanguageHint:
      'Applies from the next fetch: agents write titles and summaries in this language. Articles already fetched stay as they are. Samix does not check whether a model follows the instruction.',
    quote: (text) => `“${text}”`,
  },
  banner: {
    unreachable: 'Error: Samix core not reachable.',
    unreachableDev: 'Is `pnpm dev:core` still running?',
    unreachableApp: 'This can happen briefly while the core restarts.',
    connected: (version, seconds) => `Core connected · v${version} · up ${seconds} s`,
    connecting: 'Connecting to the core …',
  },
  modelHint: {
    switched: (n, model, names) => `Switched ${n} ${n === 1 ? 'agent' : 'agents'} to ${model}: ${names}.`,
    missingKey: (names, options) => `${names}: API key missing; a key is set for ${options}.`,
    and: ' and ',
    switchTo: (model) => `Switch to ${model}`,
  },
};

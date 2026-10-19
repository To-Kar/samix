// First start and creating a section.

export const de = {
  onboarding: {
    choices: {
      'claude-haiku-4-5': { title: 'Claude Haiku (Anthropic)', note: 'Braucht einen API-Schlüssel von Anthropic.' },
      'deepseek-chat': { title: 'DeepSeek', note: 'Braucht einen API-Schlüssel von DeepSeek; in der Regel günstiger.' },
      'ollama-llama3': {
        title: 'Nur lokal (Ollama)',
        note: 'Kein Schlüssel und keine Kosten, aber Ollama muss auf diesem Rechner installiert sein und laufen.',
      },
    } as Record<string, { title: string; note: string }>,
    enterKey: 'Bitte den API-Schlüssel eintragen.',
    savingKey: 'Schlüssel wird gespeichert …',
    restarting: 'Samix wird neu gestartet …',
    notRestarted: (reason: string) =>
      `Der Schlüssel ist gespeichert, aber der Core wurde nicht neu gestartet: ${reason}. Beende die App und starte sie neu; dann geht es hier weiter.`,
    testingKey: 'Schlüssel wird getestet …',
    keyFails: (reason: string) => `Der Schlüssel funktioniert nicht: ${reason}`,
    coreSilent: 'Der Core antwortet nicht.',
    settingModel: 'Modell wird für alle Agenten eingestellt …',
    welcome: 'Willkommen bei Samix',
    intro:
      'Samix sammelt Artikel aus deinen Quellen und fasst sie mit einem Sprachmodell zusammen. Welches soll es benutzen? Das lässt sich später unter „Einrichtung“ ändern.',
    apiKey: 'API-Schlüssel',
    keyPlaceholder: 'wird im Schlüsselbund des Betriebssystems gespeichert',
    steps: ['1 Anbieter wählen', '2 Schlüssel einfügen', '3 Test', '4 Erste Ausgabe'],
    wait: 'Einen Moment …',
    go: 'Weiter und erste Ausgabe erstellen',
  },
  newAgent: {
    missingName: 'einen Namen',
    missingTopic: 'ein Thema („Worum soll es gehen?“)',
    missingSource: 'mindestens eine Webseite oder einen RSS-Feed (oder „im Web suchen“ wählen)',
    title: 'Neues Ressort',
    name: 'Name',
    namePlaceholder: 'z. B. Chip · KI',
    topic: 'Worum soll es gehen?',
    topicPlaceholder: 'z. B. Künstliche Intelligenz, Sprachmodelle und ihre Anwendung im Alltag',
    topicHint:
      'Das Sprachmodell wählt aus den abgerufenen Beiträgen die passenden aus. Stichwörter an den Quellen filtern vorher kostenlos.',
    where: 'Woher sollen die Artikel kommen?',
    whereSearch: 'Allgemein im Web suchen',
    whereSearchNote: 'Samix sucht selbst nach dem Thema (Perplexity). Du musst keine Seite kennen.',
    whereSites: 'Nur bestimmte Seiten',
    whereSitesNote: 'Nur die Webseiten und Feeds, die du unten einträgst.',
    whereBoth: 'Beides',
    whereBothNote: 'Deine Seiten und zusätzlich eine allgemeine Websuche.',
    searchCost:
      'Jede Suche kostet extra (geschätzt etwa 0,25 Cent, abgebucht vom Tageslimit des Ressorts). Das lässt sich später unter „Quellen“ des Ressorts ändern.',
    noSearchKey: ' Es ist noch kein Perplexity-Schlüssel eingetragen (Einrichtung → Weitere Anbieter).',
    sites: 'Seiten und Feeds',
    rssPlaceholder: 'Optional: RSS-Feeds, eine URL pro Zeile',
    when: 'Wann?',
    costHint:
      'Beim Anlegen wird nichts abgerufen und nichts bezahlt. Kosten entstehen erst, wenn du „Neue Artikel holen“ drückst oder der Zeitplan greift. Pro Ressort gilt ein eigenes Tageslimit.',
    missing: (what: string) => `Zum Anlegen fehlt noch: ${what}.`,
    creating: 'Legt an …',
    create: 'Ressort anlegen',
    cancel: 'Abbrechen',
  },
};

export const en: typeof de = {
  onboarding: {
    choices: {
      'claude-haiku-4-5': { title: 'Claude Haiku (Anthropic)', note: 'Needs an API key from Anthropic.' },
      'deepseek-chat': { title: 'DeepSeek', note: 'Needs an API key from DeepSeek; usually cheaper.' },
      'ollama-llama3': {
        title: 'Local only (Ollama)',
        note: 'No key and no cost, but Ollama must be installed and running on this computer.',
      },
    },
    enterKey: 'Please enter the API key.',
    savingKey: 'Saving the key …',
    restarting: 'Restarting Samix …',
    notRestarted: (reason) =>
      `The key is saved, but the core was not restarted: ${reason}. Quit the app and start it again; you'll continue here.`,
    testingKey: 'Testing the key …',
    keyFails: (reason) => `The key does not work: ${reason}`,
    coreSilent: 'The core does not answer.',
    settingModel: 'Setting the model for all agents …',
    welcome: 'Welcome to Samix',
    intro:
      'Samix collects articles from your sources and summarises them with a language model. Which one should it use? You can change this later under “Setup”.',
    apiKey: 'API key',
    keyPlaceholder: "stored in the operating system's keychain",
    steps: ['1 Choose provider', '2 Paste key', '3 Test', '4 First edition'],
    wait: 'One moment …',
    go: 'Continue and create the first edition',
  },
  newAgent: {
    missingName: 'a name',
    missingTopic: 'a topic (“What should it be about?”)',
    missingSource: 'at least one website or RSS feed (or choose “search the web”)',
    title: 'New section',
    name: 'Name',
    namePlaceholder: 'e.g. Chips · AI',
    topic: 'What should it be about?',
    topicPlaceholder: 'e.g. artificial intelligence, language models and their everyday use',
    topicHint: 'The language model picks the fitting items from what was fetched. Keywords on the sources filter beforehand at no cost.',
    where: 'Where should the articles come from?',
    whereSearch: 'Search the web',
    whereSearchNote: "Samix searches for the topic itself (Perplexity). You don't need to know any site.",
    whereSites: 'Only certain sites',
    whereSitesNote: 'Only the websites and feeds you enter below.',
    whereBoth: 'Both',
    whereBothNote: 'Your sites plus a general web search.',
    searchCost:
      "Each search costs extra (estimated at about 0.25 cents, taken from the section's daily limit). You can change this later under the section's “Sources”.",
    noSearchKey: ' No Perplexity key is set yet (Setup → More providers).',
    sites: 'Sites and feeds',
    rssPlaceholder: 'Optional: RSS feeds, one URL per line',
    when: 'When?',
    costHint:
      'Creating fetches nothing and costs nothing. Costs arise only when you press “Fetch new articles” or the schedule runs. Each section has its own daily limit.',
    missing: (what) => `Still missing to create: ${what}.`,
    creating: 'Creating …',
    create: 'Create section',
    cancel: 'Cancel',
  },
};

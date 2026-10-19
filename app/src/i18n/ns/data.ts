// Data agents may read: project folders, notes, reader profile.

export const de = {
  projects: {
    intro: {
      before: 'Die Auskunft „Frag dein Projekt“ darf Textdateien dieser Ordner lesen (nur lesen, nichts wird verändert). Schlüssel, ',
      env: '-Dateien, ',
      and: ' und ',
      after:
        ' sind ausgeschlossen. Mit dem Haken gehen gelesene Dateiausschnitte an den Modellanbieter; ohne Haken liest sie nichts. Das ist eine Heuristik: prüfe selbst, ob der Ordner Geheimnisse in anderen Dateien enthält.',
    },
    notFound: 'Ordner nicht gefunden',
    allowed: 'an Modell senden erlaubt',
    removeLabel: (name: string) => `Freigabe von „${name}“ entfernen`,
    remove: 'Freigabe entfernen',
    none: 'Noch kein Ordner freigegeben.',
    name: 'Name',
    pathPlaceholder: 'Absoluter Pfad, z. B. /Users/du/Projekte/mein-projekt',
    choose: 'Ordner wählen …',
    allow: 'Gelesene Dateiausschnitte dürfen an das Modell gesendet werden',
    release: 'Ordner freigeben',
  },
  notes: {
    intro:
      'Was du hier einträgst, kann die Auskunft lesen, um Suchen an deine Interessen anzupassen (dann steht „read_notes“ unter „Wie kam das zustande?“), und Ressorts mit eingeschalteter Personalisierung nutzen es beim Ranking (siehe „Dein Profil“ des Ressorts). Nur dann geht es an das Modell. Notizen sind keine Quellen.',
    deleteLabel: (text: string) => `Notiz „${text}“ löschen`,
    none: 'Noch keine Notizen.',
    placeholder: 'z. B. Ich verfolge Rust und offene Sprachmodelle',
    add: 'Merken',
  },
  profile: {
    intro:
      'Mit 👍 und 👎 an den Artikeln und mit deinen Notizen (Einrichtung → Daten) sagst du Samix, was dich interessiert. Ist die Personalisierung an, geht beim nächsten Lauf genau die Liste unten (die letzten Titel, höchstens 10 je Seite, und bis zu 20 Notizen) an das Modell – nur um die Wichtigkeit zu gewichten. Sonst wird nichts über dich gesendet. Bewertungen und Notizen bleiben auf diesem Rechner.',
    personalize: 'Bewertungen und Notizen beim Ranking berücksichtigen',
    loading: 'Lädt …',
    none: 'Noch keine Bewertungen und Notizen.',
    liked: '👍 Gefällt',
    disliked: '👎 Gefällt nicht',
    yourNotes: '📝 Deine Notizen',
    confirmReset: 'Alle Bewertungen für dieses Ressort löschen?',
    reset: 'Bewertungen zurücksetzen',
  },
};

export const en: typeof de = {
  projects: {
    intro: {
      before: 'The “Ask your project” assistant may read text files in these folders (read only, nothing is changed). Keys, ',
      env: ' files, ',
      and: ' and ',
      after:
        " are excluded. With the tick, excerpts it reads go to the model provider; without it, it reads nothing. This is a heuristic: check yourself whether the folder holds secrets in other files.",
    },
    notFound: 'Folder not found',
    allowed: 'sending to the model allowed',
    removeLabel: (name) => `Remove access to “${name}”`,
    remove: 'Remove access',
    none: 'No folder shared yet.',
    name: 'Name',
    pathPlaceholder: 'Absolute path, e.g. /Users/you/Projects/my-project',
    choose: 'Choose folder …',
    allow: 'Excerpts it reads may be sent to the model',
    release: 'Share folder',
  },
  notes: {
    intro:
      'What you enter here can be read by Ask to fit searches to your interests (then “read_notes” appears under “How was this answered?”), and sections with personalisation switched on use it for ranking (see the section\'s “Your profile”). Only then does it go to the model. Notes are not sources.',
    deleteLabel: (text) => `Delete note “${text}”`,
    none: 'No notes yet.',
    placeholder: 'e.g. I follow Rust and open language models',
    add: 'Remember',
  },
  profile: {
    intro:
      'With 👍 and 👎 on articles and with your notes (Setup → Data) you tell Samix what interests you. With personalisation on, exactly the list below (the latest titles, at most 10 per side, and up to 20 notes) goes to the model in the next run – only to weigh importance. Nothing else about you is sent. Votes and notes stay on this computer.',
    personalize: 'Use votes and notes for ranking',
    loading: 'Loading …',
    none: 'No votes or notes yet.',
    liked: '👍 Liked',
    disliked: '👎 Not liked',
    yourNotes: '📝 Your notes',
    confirmReset: 'Delete all votes for this section?',
    reset: 'Reset votes',
  },
};

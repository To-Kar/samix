# Samix – Datenschutz (ENTWURF)

> **Status: Entwurf, keine Rechtsberatung.** Der Text beschreibt den Datenfluss, wie er im Code steht (geprüft gegen Fakes und Quelltext, nicht gegen echte Anbieter). Vor einer Veröffentlichung an andere Nutzer braucht er eine rechtliche Prüfung (Verantwortlicher/Impressum, Rechtsgrundlagen, Anbieterverträge). Stellen mit **[Unverified]** konnte ich nicht belegen.

## 1. Kurzfassung

- Samix läuft **lokal auf deinem Rechner**. Es gibt kein Samix-Konto, keinen Samix-Server und **keine Telemetrie**.
- Deine Daten (Artikel, Notizen, Gespräche, Abstimmungen, Einstellungen) liegen in einer Datenbank auf deinem Gerät.
- Daten verlassen dein Gerät nur in diesen Fällen: (a) an den **Modellanbieter, den du wählst**, (b) an **Perplexity**, wenn du die Websuche nutzt, (c) als **Abruf der Quellen**, die du oder ein Ressort einträgst.
- API-Schlüssel liegen im **Schlüsselbund deines Betriebssystems**, nicht in Dateien.

## 2. Was lokal gespeichert wird

| Was | Wo | Löschen |
|---|---|---|
| Datenbank (Artikel, Läufe, Kosten, Gespräche, Notizen, Abstimmungen, Projekte, Einstellungen) | App-Datenordner (`samix.db`; macOS: `~/Library/Application Support/app.samix/`, Windows: `%APPDATA%\app.samix\`) | Gespräche und Notizen in der App löschbar; Datenbank durch Löschen der Datei |
| Ressort-Definitionen (Prompt, Quellen, Zeitplan) | Ordner `agents/` im Datenordner | Entfernte Ressorts wandern nach `agents/.removed/`, werden **nicht** gelöscht; Datenbankeinträge (Läufe, Artikel) bleiben |
| Volltexte und Bilder abgerufener Artikel | Datenbank bzw. Medienordner neben der Datenbank | laufen nach 90 Tagen ab (einstellbar über `SAMIX_CONTENT_RETENTION_DAYS`) |
| Logdatei `core.log` | Log-Ordner der App | wird beim Start rotiert; kann Fehlertexte und Adressen enthalten **[Unverified: ob in Fehlertexten Teile deiner Fragen auftauchen können]** |
| Darstellung (gewähltes Theme, eigene Themes, Schriftgröße, Sprache der Oberfläche) | Browser-Speicher (`localStorage`) des App-Fensters, nur auf diesem Gerät; wird nicht an Dritte gesendet | Eigene Themes in der App löschbar; sonst mit dem App-Datenordner |
| API-Schlüssel | OS-Schlüsselbund, Dienst „samix“ | in der App entfernbar |

## 3. Was an Dritte geht

### 3.1 Modellanbieter (Anthropic/Claude, DeepSeek; optional Ollama lokal)
Je nach Funktion wird an **den von dir für das jeweilige Ressort gewählten** Anbieter gesendet:
- **Ressort-Lauf:** die Anweisung des Ressorts und die abgerufenen Quellenelemente (Titel, Auszug, Adresse). Mit der Option „Personalisieren“ zusätzlich bis zu 10 Titel/Themen gelikter und geminuster Artikel und bis zu 20 deiner Notizen („Interessen“).
- **Fragen an die Zeitung / Orchestrator:** deine Frage, der bisherige Gesprächsverlauf und die Artikelauszüge, die die Suchwerkzeuge für diese Frage liefern. Der Orchestrator sieht deine Frage und die Beschreibung der verfügbaren Aktionen, nicht deine Artikel.
- **Projekt-Assistent:** nur für Ordner, die du **ausdrücklich freigegeben** hast und bei denen „Modellzugriff“ aktiv ist: deine Frage und die Dateiausschnitte, die die Lese-Werkzeuge liefern.
- **Notizen:** gehen nur an ein Modell, wenn ein Agent sie über das Werkzeug „Notizen lesen“ abruft oder ein Ressort „Interessen“ nutzt.

Bei **Ollama** bleibt alles auf deinem Rechner (sofern dein Ollama lokal läuft).
Wie lange Anthropic/DeepSeek Eingaben speichern oder verwenden, hängt von deren Bedingungen und deinem Vertrag ab. **Ich kann das nicht verifizieren** – bitte dort nachlesen. DeepSeek ist ein Anbieter außerhalb der EU **[Unverified: Verarbeitungsort]**.

### 3.2 Perplexity (Websuche)
Wenn ein Ressort „allgemein suchen“ nutzt, gehen dessen **Themenbeschreibung bzw. Suchbegriffe** an Perplexity. Deine Artikel, Notizen und Fragen werden dafür nicht gesendet. Pro Suche entstehen Kosten, die gegen deine Limits gerechnet werden. Aus den Treffern übernimmt Samix nur Adressen und lädt die Seite selbst; Texte, die Perplexity generiert, werden nicht als Artikelinhalt verwendet.

### 3.3 Abruf von Quellen
Feeds, Webseiten, Sitemaps und Bilder werden direkt von den jeweiligen Servern abgerufen. Diese sehen deine IP-Adresse und den User-Agent `samix/0.1`. Adressen im privaten Netz werden von Samix nicht abgerufen.

### 3.4 Themes und Sprache
Eine Theme-Datei (`.samix-theme.json`) enthält nur Daten: Farben als Hex-Werte, Schriftnamen aus einer festen Liste, Maße und Texte (Name, Haltung, Übersetzungen). Beim Import wird sie gegen ein Schema und eine Kontrastprüfung geprüft (max. 64 KB). Sie kann weder Adressen noch Bilder noch Schriften nachladen; die Schriften sind in der App mitgeliefert und die Inhaltssicherheitsrichtlinie (CSP) der App erlaubt Schriften nur von der App selbst. Beim Import und Export wird nichts über das Netz gesendet; der Export ist ein lokaler Dateidownload. Ein eigener Hintergrund (Bild) ist derzeit **nicht** vorgesehen. Käme er, müsste er lokal gespeichert werden und dieser Abschnitt ergänzt werden.

### 3.5 Sonst nichts
Keine Telemetrie, keine Absturzberichte, kein automatischer Update-Check (Stand dieses Entwurfs). Kommt ein Update-Check hinzu, muss dieser Text ergänzt werden.

## 4. Projektordner: Grenzen
Samix liest nur freigegebene Ordner, nur lesend, nur relative Pfade innerhalb des Ordners; Symlinks und eine Liste typischer Geheimnis-Dateien (z. B. Schlüssel, `.env`) werden übersprungen. **Die Ausschlussliste ist eine Heuristik, keine Garantie.** Gib keine Ordner frei, deren Inhalt nicht zum Modellanbieter soll.

## 5. Deine Kontrolle
- Anbieter pro Ressort wählen; Ollama für „nichts verlässt den Rechner“ (für Funktionen mit Werkzeugen **[Unverified: ob dein lokales Modell Werkzeugaufrufe kann]**).
- Websuche je Ressort ein-/ausschalten; Personalisierung ist standardmäßig aus.
- Profil-Ansicht zeigt genau, was für Personalisierung gesendet würde.
- Tägliche Limits (pro Ressort und global) begrenzen Kosten.
- Alles lokal löschen: App beenden, Datenordner entfernen, Schlüssel in der App/dem Schlüsselbund löschen.

## 6. Offen vor Veröffentlichung
- Verantwortlicher/Kontakt, Rechtsgrundlagen, Auftragsverarbeitung mit Anbietern.
- Prüfung, ob Logs Nutzereingaben enthalten können.
- Update-Mechanismus (falls eingeführt) ergänzen.
- Rechtliche Prüfung des gesamten Textes.

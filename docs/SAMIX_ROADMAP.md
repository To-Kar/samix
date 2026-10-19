# Samix — Roadmap bis zum fertigen Produkt

**Type:** Plan (kein Spec — jede Phase bekommt vor dem Start eigenes Spec + Handoff-Doc)
**Stand:** 2026-10-19, nach Code-Gegenprüfung von Phase 1 (Commit `f9d5275`)
**Bezug:** `SAMIX_ABOUT.md` (Werte), `SAMIX_PHASE_1_REPORT.md` (Ist-Stand)

> Kennzeichnung: Aussagen mit **[verifiziert]** wurden am Code oder durch Ausführen geprüft. **[Inference]** / **[Unverified]** sind Annahmen, die in der jeweiligen Phase geprüft werden müssen, bevor darauf gebaut wird.

---

## 0. Überblick

Die Phasennummern aus `SAMIX_ABOUT.md` bleiben gültig (Phase 3 = reaktive Agenten, Phase 4 = Orchestrator, Phase 5 = Veröffentlichung). Phase 2 wird in drei Teilphasen zerlegt, weil sie sonst zu groß ist.

| Phase | Titel | Ergebnis | Meilenstein |
|---|---|---|---|
| **1.5** | Stabilisierung | Frischer Klon läuft auf macOS + Windows, Werte-Verstöße behoben, Tests + CI | — |
| **2a** | Zeitung & Reader | Zeitungslayout mit Textblöcken, Volltext-Artikel, In-App-Reader | — |
| **2b** | Desktop-App macOS + Windows | Doppelklick-App ohne Terminal, ohne installiertes Node | **v1.0 — täglich nutzbar für Tom** |
| **2c** | Personalisierung & mehr Agenten | Voting, Interessenprofil, zweiter Agent, generischer Quellen-Editor | v1.1 |
| **3** | Reaktive Agenten | On-Demand-Agenten (z. B. Coding-Assistent) | v2.0 |
| **4** | Orchestrator & Memory | Hierarchisch delegierender Router, Cross-Agent-Memory | v3.0 |
| **5** | Öffentliche Veröffentlichung | Signierte, notarisierte Installer, Auto-Update, rechtliche Prüfung | Public 1.0 |

**Definition „fertiges Produkt“:** Für die persönliche Nutzung ist **v1.0 nach Phase 2b** der Punkt, an dem Samix „funktioniert“: App per Doppelklick starten (Mac und Windows), Zeitung erscheint jeden Morgen von selbst, Artikel lassen sich in der App lesen, Kosten sind gedeckelt. Phase 3–5 sind Ausbau, nicht Voraussetzung.

### Änderungen gegenüber früheren Docs (bewusst)

1. **macOS wird Ship-Target, nicht nur Dev-Plattform.** CLAUDE.md sagt „Windows-first for shipping“, Phase-0-Spec legt Cross-Platform-Builds auf Phase 4+. Neu: macOS und Windows sind ab Phase 2b gleichrangige Ziele. Signing/Notarisierung bleibt Phase 5 (nur für Weitergabe nötig).
2. **Mehrspaltiges Zeitungslayout.** Phase-1-Handoff (§5 Punkt 10) erklärt Single-Column als bewusst und Mehrspaltigkeit zur „Phase 2 design decision“. Diese Entscheidung wird hiermit für Phase 2a getroffen.
3. **Phase 2 zerlegt** in 2a/2b/2c. Inhalte aus dem alten Phase-2-Backlog (Tray, Autostart, OpenAI, Voting, Retention, Sidecar) sind auf die Teilphasen verteilt.

CLAUDE.md und Phase-Specs müssen beim Start von 1.5 entsprechend angepasst werden.

---

## Phase 1.5 — Stabilisierung

**Ziel:** Was Phase 1 verspricht, funktioniert reproduzierbar — auf einem frischen Mac und einem frischen Windows-Rechner.

### 1.5.1 Setup & Developer Experience

- **`DATABASE_URL` fehlt in frischem Klon** [verifiziert: `prisma migrate deploy` bricht mit `P1012` ab]. Lösung: `core/.env.example` committen *und* den Default im Code setzen (Core setzt `DATABASE_URL` selbst, wenn nicht gesetzt). In 2b übernimmt die Rust-Shell das mit dem echten App-Datenpfad.
- **`prisma generate` automatisieren** (`postinstall` oder `prebuild` in `core/package.json`).
- **Migrations beim Core-Start automatisch anwenden** (`migrate deploy` beim Boot), damit kein manueller Schritt nötig ist — Voraussetzung für 2b.
- **README-Setup** auf macOS *und* Windows einmal von Null durchspielen und korrigieren.

### 1.5.2 Werte-Verstöße beheben

- **Source-Traceability erzwingen** [verifiziert: Kommentar in `runner.ts:105` verweist auf nicht existierende Prüfung]. Jede `sourceUrl` im LLM-Output muss (nach URL-Normalisierung) in den `SourceSnapshot`s dieses Runs vorkommen. Treffer ohne Snapshot → Item verwerfen und loggen; fallen dadurch zu viele Items weg → Run `partial`.
- **Kein Model-Call ohne Quellen** [verifiziert: Runner ruft bei 0 Items trotzdem das Modell]. Ein Agent mit deklarierten Quellen und 0 gefetchten Items endet als `failed` mit `reason: no_source_items` — keine Kosten, keine erfundenen Artikel.
- **`publishedAt` Pflicht** im `newsletter-ai`-Schema (Spec Z. 40 und Wert „Source-traceable“ verlangen URL + Datum). Fehlt das Datum im LLM-Output, aus dem passenden `SourceSnapshot` übernehmen statt das Item zu verwerfen.
- **`Article.sourceName`** aus dem `SourceSnapshot` befüllen [verifiziert: wird nie gesetzt].
- **`specTypeOf`-Heuristik ersetzen**: `SourceItem` trägt seinen Spec-Typ direkt.

### 1.5.3 Bugs & Robustheit

- `GET /articles?since=<ungültig>` → 400 statt 500 [verifiziert: 500].
- **Hängende Runs**: beim Core-Start alle `AgentRun.status='running'` auf `failed` mit `reason: interrupted` setzen.
- **SQLite Foreign Keys**: `PRAGMA foreign_keys=ON` prüfen/erzwingen (Ursache des Bugs aus Commit `3d09183`).
- **Parallele Runs**: Lock pro Agent (manueller Run + Cron gleichzeitig → doppelte Kosten, Budget-Race).
- **Ollama**: `timeout_secs` im `ModelPreference`, Modell-Tag konfigurierbar statt hartcodiert `llama3`.
- **Claude-Preise** gegen offizielle Preisliste prüfen (`// VERIFY` in `claude.ts`) — sonst stimmt das `BudgetLedger` nicht. Anthropic-SDK-Version (`^0.32`) prüfen/aktualisieren.
- **Core-Prozess beim Beenden**: [Unverified] Ob `Drop for AppState` beim App-Ende zuverlässig läuft und ob `child.kill()` auf `pnpm` auch die Enkel-Prozesse (`tsx` → `node`) beendet. Prüfen auf macOS + Windows; sonst bleibt ein verwaister Node-Prozess mit offener DB zurück. Lösung bei Bedarf: Exit über `RunEvent::Exit` + Prozessgruppe.

### 1.5.4 Tests & CI

- **Vitest** im Core. Pflicht-Tests mindestens für: Budget-Gates (per-Agent + global), Fallback-Chain (Kriterium 8 automatisiert, mit Fake-Adaptern), Schema-Validierung → `partial`, Traceability-Filter, „0 Quellen → kein Call“, Catchup-Logik.
- **GitHub Actions** auf `macos-latest` und `windows-latest`: `pnpm install`, `prisma generate`, `tsc --noEmit` (core + app), Core-Tests. Rust: `cargo check` auf beiden Runnern.
- **Kriterium 8** einmal manuell mit echtem ungültigem Key + laufendem Ollama nachtesten, dann Report-Status aktualisieren.

### Exit-Kriterien 1.5

1. Frischer Klon auf macOS und Windows: README-Schritte → Zeitung zeigt Artikel, ohne manuellen Eingriff außerhalb der README.
2. CI grün auf beiden Plattformen.
3. Kein Artikel in der DB, dessen `sourceUrl` nicht in einem `SourceSnapshot` desselben Runs steht (per Test bewiesen).
4. Alle 12 Phase-1-Kriterien (außer den gestrichenen 5 + 6) bestanden und dokumentiert.

---

## Phase 2a — Zeitung & Reader

**Ziel:** Samix sieht aus und liest sich wie eine Zeitung. Man sieht Zusammenfassungen in Textblöcken, wichtige Artikel stehen komplett auf der Seite, und ein Klick öffnet den ganzen Artikel sauber in der App — nicht im Browser.

### 2a.1 Das Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  SAMIX                                      Montag, 19. Oktober 2026  │
│  Ausgabe Nr. 42 · 8 Artikel · 3 Quellen · Kosten heute 0,03 $          │
├──────────────────────────────────────────────────────────────────────┤
│  AUFMACHER (Volltext, 2 Spalten)                │  KURZ NOTIERT       │
│  ┌─────────────────────────────────────────┐    │  ▪ Titel            │
│  │ Große Schlagzeile                        │    │    1–2 Sätze        │
│  │ Quelle · Datum · 6 Min. Lesezeit         │    │  ▪ Titel            │
│  │ ┌ KI-Zusammenfassung ────────────────┐   │    │    1–2 Sätze        │
│  │ └────────────────────────────────────┘   │    │  ▪ Titel            │
│  │ Originaltext Spalte 1 │ Spalte 2 …       │    │    1–2 Sätze        │
│  │                  [ Weiterlesen → ]       │    │                     │
│  └─────────────────────────────────────────┘    │                     │
├──────────────────────┬──────────────────────┬────┴────────────────────┤
│  Artikel-Block       │  Artikel-Block       │  Artikel-Block          │
│  Titel               │  Titel               │  Titel                  │
│  Zusammenfassung     │  Zusammenfassung     │  Zusammenfassung        │
│  Quelle · Datum      │  Quelle · Datum      │  Quelle · Datum         │
└──────────────────────┴──────────────────────┴─────────────────────────┘
```

**Drei Block-Typen**, gesteuert durch eine Wichtigkeit pro Artikel:

| Block | Wann | Inhalt auf der Titelseite |
|---|---|---|
| **Aufmacher** | höchste Wichtigkeit, 1 (max. 2) pro Ausgabe | Schlagzeile groß, KI-Zusammenfassung, **Originaltext** mehrspaltig (angeschnitten nach N Absätzen, „Weiterlesen“) |
| **Artikel-Block** | mittlere Wichtigkeit | Titel, Zusammenfassung, Quelle, Datum |
| **Kurz notiert** | niedrige Wichtigkeit | Titel + 1–2 Sätze in einer schmalen Spalte |

- **Ausgaben statt Endlosliste:** Die Seite zeigt eine *Ausgabe* (= ein erfolgreicher Run bzw. ein Tag). Navigation „‹ gestern | morgen ›“ zu älteren Ausgaben.
- **Typografie:** Serifenschrift für Text, Kopfzeile im Zeitungsstil, Spaltensatz mit CSS `columns` / Grid. Schriften **lokal gebündelt** (Local-first; CSP erlaubt ohnehin nur `font-src 'self'`). Kandidaten mit Open-Font-Licence prüfen, z. B. Source Serif 4 [Unverified: Lizenz vor Einbindung prüfen].
- **Hell + Dunkel** (Papier-Ton / dunkles Papier), Mindestfensterbreite 800 px → bei schmalem Fenster auf 2 bzw. 1 Spalte zurückfallen.

### 2a.2 Wer entscheidet, was „interessant“ ist?

- **Schritt 1 (2a):** Das Output-Schema bekommt `importance` (1–5) und `importanceReason` (ein Satz). Das LLM bewertet beim Zusammenfassen. Das Layout ordnet nach `importance`. Kosten: wenige Tokens pro Item [Inference].
- **Schritt 2 (2c):** Voting (👍/👎, „mehr davon“) und ein Interessenprofil fließen in die Bewertung ein.
- Ehrlichkeit: `importanceReason` ist in der UI sichtbar („Warum oben?“).

### 2a.3 Volltext holen (Core)

Neuer Baustein im Core: **Content-Extraktor**, analog zu Adaptern und Fetchern hinter einem Interface.

- **Wann:** *Nach* der Validierung des LLM-Outputs, nur für Artikel, die angezeigt werden. Aufmacher werden sofort beim Run vorgeladen, alle anderen **beim ersten Klick** (lazy) und dann gecacht. → keine zusätzlichen LLM-Kosten.
- **Wie:** Original-URL laden, Hauptinhalt extrahieren (Kandidat: `@mozilla/readability` + ein DOM wie `linkedom`/`jsdom` [Unverified: Eignung im Spike prüfen]).
- **Ausgabeformat: strukturierte Blöcke, kein HTML.** Der Extraktor liefert `[{type:'heading'|'paragraph'|'quote'|'list'|'image'|'code', …}]`. Die UI rendert diese Blöcke als React-Elemente — **kein `dangerouslySetInnerHTML`**. Grund: fremdes HTML in einer WebView mit Tauri-IPC-Zugriff ist ein Sicherheitsrisiko; strukturierte Blöcke vermeiden das ganze Problem.
- **Bilder:** Core lädt Bilder herunter und liefert sie über den Loopback-Server aus (lokal gecacht). So bleibt die CSP streng und Dritte sehen nicht, was gelesen wird (keine Tracking-Pixel). Größenlimit pro Bild/Artikel.
- **Wenn es nicht geht** (Paywall, reine JavaScript-Seite, PDF, Fehler): Status `paywalled` / `unsupported` / `failed` speichern; der Reader zeigt dann Zusammenfassung + „Im Browser öffnen“. Ehrlich anzeigen, nicht verschweigen.
- **Sonderfälle:** arXiv → Abstract-Seite statt PDF [Unverified: ob arXiv-HTML-Volltexte zuverlässig verfügbar sind, im Spike prüfen]. Hacker News → verlinkter Artikel, nicht die Kommentarseite.
- **Höflich fetchen:** eigener User-Agent, Timeout, Größenlimit, Rate-Limit pro Domain.

**Datenmodell (neu):**

```
ArticleContent
  articleId    → Article (1:1)
  status       ok | paywalled | unsupported | failed
  title, byline, siteName, lang
  blocks       JSON (strukturierte Blöcke)
  wordCount, readingMinutes
  fetchedAt, error
```

`Article` bleibt schlank; zusätzlich `importance`, `importanceReason`.

**Neue Endpoints:** `GET /editions` (Liste der Ausgaben), `GET /editions/:id`, `GET /articles/:id` (inkl. `ArticleContent` + zugehörige `SourceSnapshot`s), `POST /articles/:id/content` (Extraktion auslösen/neu laden), `GET /media/:id` (gecachte Bilder).

### 2a.4 Der Reader (App)

Klick auf einen Artikel öffnet eine **eigene Leseansicht in der App**:

- Ruhige, schmale Textspalte (ca. 65–75 Zeichen pro Zeile), große Serifenschrift, viel Weißraum, keine Werbung, keine Navigation der Originalseite.
- Kopf: Schlagzeile, Quelle, Autor, Datum, Lesezeit.
- **Klar getrennt:** Kasten „KI-Zusammenfassung (claude-haiku-4-5)“ oben, darunter „Originaltext von <Quelle>, abgerufen am …“. Nutzer sieht immer, was vom LLM kommt und was Original ist (Wert „Honest AI“).
- Unten: **Quellen-Nachweis** — welche `SourceSnapshot`s dieser Artikel belegt (macht Traceability sichtbar; stand bereits als Phase-2-Empfehlung im Report).
- Aktionen: „Zurück zur Zeitung“ (auch `Esc`), „Original im Browser öffnen“, „Neu laden“, Pfeiltasten / `j` `k` für nächsten/vorigen Artikel.
- Ladezustand, wenn der Volltext erst beim Klick geholt wird.

### 2a.5 Retention

Ausgaben wachsen unbegrenzt (Report-Empfehlung). Konfigurierbare Aufbewahrung (Default z. B. 90 Tage für Volltexte und Bilder, Artikel-Metadaten länger), Aufräumen beim Start.

### Exit-Kriterien 2a

1. Nach einem Run zeigt die Titelseite: genau 1–2 Aufmacher mit Originaltext, Artikel-Blöcke, „Kurz notiert“.
2. Klick auf jeden Artikel öffnet den Reader in der App; bei extrahierbaren Seiten steht der vollständige Text dort.
3. Nicht extrahierbare Artikel zeigen einen ehrlichen Hinweis + Browser-Link, keinen leeren Screen.
4. Kein fremdes HTML wird als HTML gerendert (Code-Review + Test).
5. Keine Netzwerkanfrage der WebView an fremde Domains (CSP unverändert streng).
6. Layout funktioniert bei 800 px und bei Vollbild, hell und dunkel, auf macOS und Windows.

### Rechtlicher Hinweis

[Unverified — keine Rechtsberatung] Volltexte lokal für den eigenen Gebrauch zu speichern entspricht dem, was Read-Later-Apps tun. Für die Veröffentlichung in Phase 5 muss geprüft werden, ob das so bleiben kann (Urheberrecht, Nutzungsbedingungen der Quellen).

---

## Phase 2b — Desktop-App für macOS und Windows

**Ziel:** Samix ist eine normale App: Doppelklick, läuft, kein Terminal, kein installiertes Node/pnpm nötig. Auf **macOS (Apple Silicon + Intel)** und **Windows** gleichwertig.

### 2b.1 Core als gebündelter Sidecar (größter Brocken)

Heute startet die Rust-Shell `pnpm --filter samix-core dev` (`tsx watch`) [verifiziert: `spawn.rs`]. Das funktioniert in einer ausgelieferten App nicht:

- Auf dem Zielrechner ist kein Node/pnpm installiert.
- **macOS-spezifisch:** Apps, die aus Finder/Dock gestartet werden, erben nicht den `PATH` der Shell — `pnpm` wird dort nicht gefunden, selbst wenn es installiert ist [Inference: bekanntes macOS-Verhalten, im Spike bestätigen].

**Entscheidung als ADR-007 (Spike vorab):** Wie wird der Core gebündelt?

| Option | Für | Gegen |
|---|---|---|
| A: Node-Binary + kompiliertes `dist/` + `node_modules` als Tauri-Ressource | robust, gleiche Laufzeit wie Dev | größeres Bundle |
| B: Node Single-Executable-Application (SEA) | eine Datei | [Unverified] Reife, native Module (Prisma, better-sqlite3) schwierig |
| C: Andere Runtime (z. B. Bun compile) | eine Datei | zweite Laufzeit neben Dev, Kompatibilität ungeklärt |

Knackpunkt bei allen Optionen: **native Bestandteile pro Plattform/Architektur** (Prisma-Query-Engine, `better-sqlite3`). Für macOS Universal (arm64 + x86_64) müssen beide Architekturen enthalten sein oder zwei getrennte Builds erstellt werden. Der Spike klärt, ob Prisma dafür tragbar ist oder ob ein Wechsel der DB-Zugriffsschicht nötig wird (dann eigenes ADR, ADR-003 SQLite bleibt unberührt).

### 2b.2 Datenpfade & Konfiguration

- Rust-Shell setzt `DATABASE_URL`, Agents-Verzeichnis und Cache-Verzeichnis beim Spawn über Tauris App-Data-Pfad:
  - macOS: `~/Library/Application Support/<identifier>/`
  - Windows: `%APPDATA%\<identifier>\`
  - [Unverified] genaue Pfadbildung von Tauri v2 mit Identifier `app.samix` prüfen; CLAUDE.md nennt `%APPDATA%/samix/samix.db` → angleichen.
- `agents/` aus dem Bundle beim ersten Start in den Benutzerordner kopieren (Sources-Editor schreibt `manifest.yaml` — im signierten App-Bundle wäre das nicht beschreibbar).
- Logs in Datei (rotierend) im App-Data-Ordner, damit Fehler ohne Terminal sichtbar sind; „Logs öffnen“ in den Settings.

### 2b.3 Plattformverhalten

- **API-Keys ohne Neustart:** Heute muss die App nach dem Speichern neu gestartet werden [verifiziert: README]. Neu: Shell startet den Core nach dem Speichern automatisch neu (sauberste Lösung, Keys bleiben nur im Prozess-ENV).
- **Schlaf/Aufwachen:** Laptops schlafen um 06:00 oft. `catchup_on_startup` greift nur beim Start. Neu: Catchup auch beim Aufwachen bzw. bei erkanntem Zeitsprung (macOS und Windows).
- **Menüleiste / Tray:** macOS-Menüleisten-Icon bzw. Windows-Tray: „Zeitung öffnen“, „Jetzt aktualisieren“, „Beenden“. Fenster schließen ≠ App beenden (auf dem Mac üblich), damit der Scheduler weiterläuft.
- **Autostart:** macOS Login-Item, Windows-Autostart (Tauri-Autostart-Plugin [Unverified: aktuelle API prüfen]); in den Settings abschaltbar, Default aus.
- **Keychain:** `keyring` mit `apple-native`/`windows-native` ist bereits konfiguriert [verifiziert: `Cargo.toml`]. Auf dem Mac prüfen: [Inference] unsignierte oder neu gebaute Apps lösen wiederholte Keychain-Freigabedialoge aus; `delete_credential()` (`// VERIFY`) testen.
- **Benachrichtigung** (optional): „Neue Ausgabe ist da“ als System-Notification.
- **Onboarding:** Erster Start ohne Keys → geführter Dialog (Key eingeben oder „nur lokal mit Ollama“), statt leerer Zeitung.

### 2b.4 Build & Verteilung (nur für Tom)

- macOS: `.app` + `.dmg`, Universal-Build oder getrennte arm64/x86_64-Builds (Ergebnis aus dem Spike). **Ad-hoc-Signatur** reicht für eigene Nutzung; ohne Apple-Developer-Zertifikat muss die App beim ersten Start per Rechtsklick → „Öffnen“ freigegeben werden [Inference: Gatekeeper-Verhalten, auf aktueller macOS-Version prüfen].
- Windows: `.msi` oder NSIS-Installer, unsigniert (SmartScreen-Warnung akzeptiert für Eigennutzung).
- CI baut beide Installer bei jedem Tag als Artefakt.

### Exit-Kriterien 2b = v1.0

1. Auf einem Mac **ohne** Node/pnpm: `.dmg` installieren, Doppelklick, Key eingeben, Zeitung erscheint — ohne Neustart.
2. Dasselbe auf Windows.
3. App beenden → kein verwaister Core-Prozess (auf beiden Plattformen geprüft).
4. Rechner schläft über 06:00 → nach dem Aufwachen läuft der verpasste Run.
5. Fenster zu → App läuft in Menüleiste/Tray weiter; Scheduler läuft.
6. Eine Woche täglicher Eigennutzung ohne manuellen Eingriff, Kosten im Budget.

---

## Phase 2c — Personalisierung & mehr Agenten (v1.1)

- **Voting** pro Artikel (👍/👎, „mehr / weniger davon“), gespeichert lokal.
- **Interessenprofil** aus Votes → fließt als Kontext in `importance`-Bewertung ein (Skill-Daten, kein Code pro Agent).
- **Duplikate über Runs hinweg** erkennen (gleiche URL/Story nicht jeden Tag neu).
- **Zweiter proaktiver Agent** (z. B. `github-digest` oder `arxiv-weekly`) — Test, dass „Skills are data“ hält. Zeitung bekommt **Ressorts** (ein Ressort pro Agent / Topic).
- **Generischer Quellen-Editor** (heute hartcodiert auf `newsletter-ai`) + Agent-Auswahl, Zeitplan bearbeiten.
- **Run-Historie in der UI**: Status, Kosten, Fehler pro Run (Wert „Transparent operations“ sichtbar machen).
- **OpenAI-Adapter** (alter Phase-2-Backlog) — eine Datei + Registry-Eintrag.
- Optional: Delivery-Kanäle (E-Mail/Telegram) als Opt-in, nur wenn echter Bedarf.

---

## Phase 3 — Reaktive Agenten (v2.0)

Wie in `SAMIX_ABOUT.md` vorgesehen: Agenten, die auf Anfrage arbeiten (z. B. Coding-Assistent mit Projektkontext). Gleiche Skill-Abstraktion, Adapter, Budget-Gates. Tool-Use im Adapter-Interface. Primär-Interface bleibt der Informationsraum, kein Chat-Fenster als Hauptansicht. Eigenes Spec vor Start.

## Phase 4 — Orchestrator & Cross-Agent-Memory (v3.0)

Hierarchisch delegierender Router, gemeinsames Gedächtnis über Agenten hinweg. Eigenes Spec vor Start.

## Phase 5 — Öffentliche Veröffentlichung

- **macOS:** Apple-Developer-Programm, Developer-ID-Signatur, Notarisierung [Unverified: aktuelle Kosten und Ablauf bei Apple prüfen].
- **Windows:** Code-Signing-Zertifikat.
- **Auto-Update** (Tauri-Updater, signierte Updates).
- Rechtliche Prüfung: Volltext-Speicherung, Lizenzen aller Abhängigkeiten und Schriften, Datenschutz.
- Endnutzer-Doku, Onboarding ohne Entwicklerwissen.

---

## Reihenfolge & Abhängigkeiten

```
1.5 Stabilisierung ──► 2a Zeitung & Reader ──► 2b Desktop-App ──► v1.0
        │                                         ▲
        └── ADR-007-Spike (Sidecar) kann parallel zu 2a laufen ──┘
                                                      │
                                          2c Personalisierung ──► v1.1 ──► 3 ──► 4 ──► 5
```

- 1.5 zuerst: Ohne Traceability-Prüfung und Tests würde 2a auf möglicherweise erfundenen URLs Volltexte laden.
- Der Sidecar-Spike (2b.1) ist das größte technische Risiko und sollte früh starten, parallel zu 2a.

## Offene Entscheidungen (vor Start der jeweiligen Phase)

| # | Frage | Phase | Vorschlag |
|---|---|---|---|
| 1 | Aufmacher-Volltext auf der Titelseite komplett oder angeschnitten mit „Weiterlesen“? | 2a | angeschnitten (Seite bleibt überschaubar) |
| 2 | Bilder im Reader anzeigen? | 2a | ja, lokal gecacht |
| 3 | Eine Ausgabe = ein Run oder ein Kalendertag? | 2a | ein Tag (mehrere Runs zusammengeführt) |
| 4 | macOS: nur Apple Silicon oder auch Intel? | 2b | Ergebnis des Spikes abwarten |
| 5 | Core-Bündelung (ADR-007) | 2b | Spike entscheidet |
| 6 | Apple-Developer-Konto für Signatur? | 5 | erst bei Veröffentlichung nötig |

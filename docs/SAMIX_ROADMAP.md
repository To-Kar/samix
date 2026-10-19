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
| **2a** | Zeitung, Reader & Webseiten-Quellen | Zeitungslayout mit Textblöcken, Volltext-Artikel, In-App-Reader mit Bildern, beliebige Webseiten als Quelle (mit optionalem Filter) | — |
| **2b** | Desktop-App macOS (Apple Silicon) + Windows | Doppelklick-App ohne Terminal, ohne installiertes Node | **v1.0 — täglich nutzbar für Tom** |
| **2c** | Personalisierung & mehr Agenten | Voting, Interessenprofil, zweiter Agent, generischer Quellen-Editor | v1.1 |
| **3** | Reaktive Agenten | On-Demand-Agenten (z. B. Coding-Assistent) | v2.0 |
| **4** | Orchestrator & Memory | Hierarchisch delegierender Router, Cross-Agent-Memory | v3.0 |
| **5** | Öffentliche Veröffentlichung | Signierte, notarisierte Installer, Auto-Update, rechtliche Prüfung | Public 1.0 |

**Definition „fertiges Produkt“:** Für die persönliche Nutzung ist **v1.0 nach Phase 2b** der Punkt, an dem Samix „funktioniert“: App per Doppelklick starten (Mac und Windows), Zeitung erscheint jeden Morgen von selbst, Artikel lassen sich in der App lesen, Kosten sind gedeckelt. Phase 3–5 sind Ausbau, nicht Voraussetzung.

### Änderungen gegenüber früheren Docs (bewusst)

1. **macOS wird Ship-Target, nicht nur Dev-Plattform.** CLAUDE.md sagt „Windows-first for shipping“, Phase-0-Spec legt Cross-Platform-Builds auf Phase 4+. Neu: macOS (vorerst nur Apple Silicon / arm64) und Windows sind ab Phase 2b gleichrangige Ziele. Signing/Notarisierung bleibt Phase 5 (nur für Weitergabe nötig).
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
- **Datum Pflicht, aber im Runner erzwungen statt im Schema** (Spec Z. 40 und Wert „Source-traceable“ verlangen URL + Datum). Das Datum der Quelle gilt, das des Modells nur als Rückfall; ohne Datum wird der Artikel verworfen. Bewusste Abweichung von „Pflicht im Schema“: ein Pflichtfeld im Schema würde ein Item verwerfen, dessen Datum wir aus der Quelle kennen.
- **`Article.sourceName`** aus dem `SourceSnapshot` befüllen [verifiziert: wird nie gesetzt].
- **`specTypeOf`-Heuristik ersetzen**: `SourceItem` trägt seinen Spec-Typ direkt.

### 1.5.3 Bugs & Robustheit

- `GET /articles?since=<ungültig>` → 400 statt 500 [verifiziert: 500].
- **Hängende Runs**: beim Core-Start alle `AgentRun.status='running'` auf `failed` mit `reason: interrupted` setzen.
- ~~**SQLite Foreign Keys**~~ **[verifiziert: kein Handlungsbedarf]** Prisma setzt `foreign_keys=ON` selbst und blockiert das Löschen (getestet). Der Waisen-Bug aus Commit `3d09183` entstand durch manuelles Löschen mit einem externen SQLite-Tool.
- **Parallele Runs**: Lock pro Agent (manueller Run + Cron gleichzeitig → doppelte Kosten, Budget-Race).
- **Ollama**: `timeout_secs` im `ModelPreference`, Modell-Tag konfigurierbar statt hartcodiert `llama3`.
- **Claude-Preise** gegen offizielle Preisliste prüfen (`// VERIFY` in `claude.ts`) — sonst stimmt das `BudgetLedger` nicht. Anthropic-SDK-Version (`^0.32`) prüfen/aktualisieren.
- **Core-Prozess beim Beenden**: [Unverified] Ob `Drop for AppState` beim App-Ende zuverlässig läuft und ob `child.kill()` auf `pnpm` auch die Enkel-Prozesse (`tsx` → `node`) beendet. Prüfen auf macOS + Windows; sonst bleibt ein verwaister Node-Prozess mit offener DB zurück. Lösung bei Bedarf: Exit über `RunEvent::Exit` + Prozessgruppe.

### 1.5.4 Tests & CI

- **Vitest** im Core. Pflicht-Tests mindestens für: Budget-Gates (per-Agent + global), Fallback-Chain (Kriterium 8 automatisiert, mit Fake-Adaptern), Schema-Validierung → `partial`, Traceability-Filter, „0 Quellen → kein Call“, Catchup-Logik.
- **GitHub Actions** auf `macos-latest` und `windows-latest`: `pnpm install`, `prisma generate`, `tsc --noEmit` (core + app), Core-Tests. Rust: `cargo check` auf beiden Runnern.
- **Kriterium 8** einmal manuell mit echtem ungültigem Key + laufendem Ollama nachtesten, dann Report-Status aktualisieren.

### Status 1.5 (2026-10-19)

Umgesetzt und getestet: alles aus 1.5.1–1.5.4 außer den unten genannten Punkten. Zusätzlich neu: Eltern-Watchdog (`SAMIX_PARENT_PID`) statt `child.kill()`-Annahme, eigener Migrator (Prisma-kompatibel, gegen `prisma migrate status/diff` geprüft), Claude-Preise gegen die offizielle Preisseite geprüft (korrekt).

**Offen / nicht verifiziert:**
- CI (`.github/workflows/ci.yml`) ist geschrieben, aber noch auf **keinem** echten macOS-/Windows-Runner gelaufen.
- Rust-Änderung (`SAMIX_PARENT_PID` in `spawn.rs`) ist nicht kompiliert (Sandbox hat keine GTK-Bibliotheken); der Watchdog im Core ist getestet, das Setzen der Variable durch die Shell nicht.
- Kriterium 8 nicht manuell mit echtem Key + Ollama geprüft; `delete_credential()` (Keychain) ungetestet; Windows-Pfade ungetestet.
- Die Test-Dateien werden nicht von `tsc` typgeprüft (nur von vitest ausgeführt).
- Hinweis: Auf der Preisseite stehen inzwischen neuere Modelle (z. B. Haiku 5.5 mit $0.10/$0.50 pro MTok statt $1/$5 bei Haiku 4.5). Ein Modellwechsel ist eine Manifest-/Registry-Entscheidung für später, nicht Teil von 1.5.

### Exit-Kriterien 1.5

1. Frischer Klon auf macOS und Windows: README-Schritte → Zeitung zeigt Artikel, ohne manuellen Eingriff außerhalb der README.
2. CI grün auf beiden Plattformen.
3. Kein Artikel in der DB, dessen `sourceUrl` nicht in einem `SourceSnapshot` desselben Runs steht (per Test bewiesen).
4. Alle 12 Phase-1-Kriterien (außer den gestrichenen 5 + 6) bestanden und dokumentiert.

---

## Phase 2a — Zeitung, Reader & Webseiten-Quellen

**Ziel:** Samix sieht aus und liest sich wie eine Zeitung. Man sieht Zusammenfassungen in Textblöcken, wichtige Artikel stehen angeschnitten mit Originaltext auf der Seite, und ein Klick öffnet den ganzen Artikel samt Bildern sauber in der App — nicht im Browser. Quellen sind nicht mehr nur RSS-URLs und arXiv-Kategorien: Man gibt eine Webseite an, optional mit Filter.

### 2a.0 Webseiten als Quellen

**Was man angibt** (im Quellen-Editor, als neuer Quell-Typ `website`):

| Beispiel | Bedeutung |
|---|---|
| `chip.de` | die neuesten Artikel von chip.de |
| `chip.de` + Filter `KI` | die neuesten Artikel von chip.de, die von KI handeln |

Im Manifest (Skills bleiben Daten — keine Zeile Code pro Webseite):

```yaml
sources:
  - type: website
    config:
      url: https://www.chip.de
      max_items: 10
  - type: website
    config:
      url: https://www.chip.de
      max_items: 10
      filter:
        topic: KI                       # was gesucht wird
        keywords: [KI, "künstliche Intelligenz", ChatGPT, LLM]   # optional, lokal
        mode: keywords | semantic       # Default: keywords
```

**Wie der Fetcher die neuesten Artikel findet** — generisch, ohne Wissen über die konkrete Seite, in dieser Reihenfolge:

1. **Feed-Erkennung:** Startseite laden, `<link rel="alternate" type="application/rss+xml|atom+xml">` suchen, gängige Pfade probieren (`/feed`, `/rss`, …). Ist ein Feed da, wird der vorhandene RSS-Parser benutzt (sortiert nach Datum). Viele Nachrichtenseiten haben Feeds [Unverified für chip.de — der Sandbox-Proxy hat die Seite blockiert, im Spike prüfen].
2. **Sitemap:** `robots.txt` → `sitemap.xml` bzw. News-Sitemap, Einträge nach `lastmod`/Publikationsdatum.
3. **Startseite auswerten:** Artikel-Links auf der Seite sammeln, jede Artikelseite auf Datum (`<meta property="article:published_time">`, JSON-LD `datePublished`) prüfen. Teuerste und fragilste Stufe — nur wenn 1 und 2 nichts liefern.

Das Ergebnis (welche Methode, welche Feed-URL) wird pro Quelle gecacht, damit nicht jeder Lauf neu sucht. Items **ohne erkennbares Datum werden verworfen** (Wert „Source-traceable“: URL + Datum).

**Filter — zwei Stufen:**

- **`keywords` (Default, kostenlos):** lokaler Abgleich auf Titel + Beschreibung, groß/klein egal. Schnell, aber `KI` findet nicht automatisch „Machine Learning“.
- **`semantic` (kostet Tokens):** Die Kandidaten (nur Titel + Kurzbeschreibung) gehen an das Modell mit der Frage „passt zu Thema *KI*?“. Läuft durch dieselben Budget-Gates wie jeder andere Call. Gefiltert wird **vor** dem Zusammenfassen, damit das teure Zusammenfassen nur passende Artikel sieht.
- Filter-Treffer und -Ablehnungen werden pro Lauf geloggt („12 gefunden, 4 passen zu KI“), damit nachvollziehbar ist, warum etwas fehlt.

**Im Quellen-Editor:** Webseite eintippen, optional Filter, **„Vorschau“-Knopf** zeigt sofort, welche Artikel gefunden würden und welche Methode (Feed/Sitemap/Seite) gegriffen hat — bevor gespeichert wird. Fehlt eine Seite komplett (JavaScript-only, blockiert), sagt die Vorschau das ehrlich.

**Architektur-Grenze:** Ein neuer Fetcher `website` im Core (wie `rss`, `arxiv`). Keine seitenspezifischen Sonderwege für chip.de oder andere — wenn eine Seite mit den drei Stufen nicht funktioniert, ist das ein Hinweis in der UI, kein neuer Code-Pfad. Höfliches Fetchen (User-Agent, `robots.txt` respektieren, Rate-Limit pro Domain) gilt wie beim Volltext-Extraktor.

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

- **Ausgaben statt Endlosliste:** Die Seite zeigt eine *Ausgabe*. **Entschieden: eine Ausgabe = ein erfolgreicher Lauf.** Navigation „‹ vorige | nächste ›“ zu älteren Ausgaben.
- **Aufmacher angeschnitten (entschieden):** Originaltext nach einigen Absätzen abgeschnitten, „Weiterlesen“ öffnet den Reader. Die Länge ist eine Einstellung, kein fester Wert, damit sie später leicht änderbar ist.
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
- **Bilder (entschieden: ja, im Reader und beim Aufmacher):** Core lädt Bilder herunter und liefert sie über den Loopback-Server aus (lokal gecacht). So bleibt die CSP streng und Dritte sehen nicht, was gelesen wird (keine Tracking-Pixel). Größenlimit pro Bild/Artikel.
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
7. Bilder erscheinen im Reader, geladen vom lokalen Core, nicht von der fremden Domain.
8. Quelle `website` mit nur einer URL liefert die neuesten Artikel mit Datum; mit Filter nur passende. Getestet an mindestens drei verschiedenen Nachrichtenseiten (eine davon chip.de), ohne seitenspezifischen Code.
9. Vorschau im Quellen-Editor zeigt Treffer und Methode vor dem Speichern.

### Status 2a (2026-10-19)

Umgesetzt, mit Tests: Wichtigkeit (1–5, im Modell-Output, mit Begründung), Ausgaben-API, Volltext-Extraktor mit lokal gecachten Bildern, abgesicherter Abruf (SSRF-Schutz), Webseiten-Quelle (Feed → Sitemap → Seitenlinks, Stichwortfilter, `robots.txt`), Vorschau im Quellen-Editor, Zeitungs-Titelseite, Reader, Aufbewahrungsfrist für Volltexte, DeepSeek-Adapter.

Exit-Kriterien:

| # | Kriterium | Stand |
|---|---|---|
| 1 | Titelseite: 1–2 Aufmacher mit Anriss, Artikel-Blöcke, „Kurz notiert“ | ✅ im Browser (Chromium) mit echtem Core und Demodaten geprüft; **nicht** mit einem echten Lauf |
| 2 | Klick öffnet den Reader in der App, Volltext vollständig | ✅ Extraktion gegen eine Fixture getestet; **nicht** gegen echte Seiten (kein Netz in der Entwicklungsumgebung) |
| 3 | Nicht extrahierbar → ehrlicher Hinweis + Browser-Link | ✅ |
| 4 | Kein fremdes HTML wird als HTML gerendert | ✅ Blöcke, nur Text; per Test |
| 5 | WebView macht keine Anfragen an fremde Domains | ⚠️ Abweichung: `blob:` wurde in `img-src` ergänzt (Bilder laufen über den Core und werden per `fetch` + Token geladen). Im Tauri-Fenster **nicht** geprüft |
| 6 | Layout bei 800 px und Vollbild, hell und dunkel, macOS und Windows | ⚠️ in Chromium geprüft; **nicht** in WKWebView (macOS) und WebView2 (Windows) |
| 7 | Bilder im Reader vom lokalen Core | ✅ |
| 8 | Webseiten-Quelle an ≥ 3 Seiten getestet, davon chip.de | ❌ **nicht verifiziert**: die Entwicklungsumgebung hat kein Netz. Getestet nur mit Fixtures für alle drei Strategien |
| 9 | Vorschau im Quellen-Editor | ✅ |

**Bewusst nicht umgesetzt / offen:**
- Filter `semantic` (Modell entscheidet) ist nicht implementiert; ein Manifest damit wird mit klarer Fehlermeldung abgelehnt. Nach Phase 2c verschoben.
- Die zuletzt erfolgreiche Methode pro Seite wird nur im Speicher gemerkt, nicht dauerhaft.
- Reine JavaScript-Seiten funktionieren nicht (kein Browser-Rendering); die Vorschau sagt das.
- Inline-Formatierung und Links im Artikeltext werden zu Klartext vereinfacht.
- Die Sprache der Oberfläche ist uneinheitlich: Zeitung und Reader sind deutsch, Quellen und Einstellungen englisch. Die Zusammenfassungen sind so englisch oder deutsch wie der Prompt in `SKILL.md` (aktuell Englisch).
- Der Aufmacher-Anriss ist in den Einstellungen einstellbar (Absätze); gespeichert nur im Browser-Speicher der App.

### Rechtlicher Hinweis

[Unverified — keine Rechtsberatung] Volltexte lokal für den eigenen Gebrauch zu speichern entspricht dem, was Read-Later-Apps tun. Für die Veröffentlichung in Phase 5 muss geprüft werden, ob das so bleiben kann (Urheberrecht, Nutzungsbedingungen der Quellen).

---

## Phase 2b — Desktop-App für macOS und Windows

**Ziel:** Samix ist eine normale App: Doppelklick, läuft, kein Terminal, kein installiertes Node/pnpm nötig. Auf **macOS (vorerst nur Apple Silicon)** und **Windows** gleichwertig. Intel-Macs sind bewusst ausgeklammert und können später als zweiter Build ergänzt werden.

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

Knackpunkt bei allen Optionen: **native Bestandteile pro Plattform/Architektur** (Prisma-Query-Engine, `better-sqlite3`). Weil macOS vorerst nur arm64 ist, reicht ein Build pro Plattform (macOS arm64, Windows x64) — kein Universal-Binary nötig. Der Spike klärt, ob Prisma dafür tragbar ist oder ob ein Wechsel der DB-Zugriffsschicht nötig wird (dann eigenes ADR, ADR-003 SQLite bleibt unberührt).

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

- macOS: `.app` + `.dmg` für Apple Silicon (`aarch64-apple-darwin`). **Ad-hoc-Signatur** reicht für eigene Nutzung; ohne Apple-Developer-Zertifikat muss die App beim ersten Start per Rechtsklick → „Öffnen“ freigegeben werden [Inference: Gatekeeper-Verhalten, auf aktueller macOS-Version prüfen].
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

### Status 2b (2026-10-19)

**Wichtigste Einschränkung: Es gibt in der Entwicklungsumgebung weder macOS noch Windows.** Alles unten ist auf **Linux** geprüft (echter Release-Build, `.deb` ausgepackt und unter einem virtuellen Display gestartet). Was auf Mac und Windows nur gleich *aussehen* sollte, ist es nicht bewiesen.

Gebaut: gebündelter Core mit offiziellem Node als Sidecar (ADR 007, 008), Release-Konfiguration, Datenordner und Logdatei im App-Verzeichnis, Kopie der Standard-Agenten (Nutzerbearbeitungen bleiben), Neustart des Cores nach Schlüsseländerung, Tray/Menüleiste mit „Zeitung öffnen / Jetzt aktualisieren / Beenden“, Fenster schließen = ausblenden, Autostart (`--hidden`), Aufwach-Erkennung, Onboarding, Modellauswahl, Release-Workflow für macOS arm64 und Windows x64.

| # | Kriterium | Stand |
|---|---|---|
| 1 | Mac ohne Node/pnpm: `.dmg` installieren, Doppelklick, Key, Zeitung, ohne Neustart | ❌ **nicht geprüft** (kein Mac). Auf Linux entsprechend: `.deb` ausgepackt, App gestartet, Core läuft, UI spricht mit dem Core (`/health`, `/editions/latest`, mit Token) |
| 2 | dasselbe auf Windows | ❌ nicht geprüft |
| 3 | App beenden → kein verwaister Core | ✅ Linux, auch bei `SIGKILL` (Core beendet sich nach ~5 s selbst). ⚠️ Windows/macOS: gleiche Logik (`process.kill(pid, 0)`), nicht ausprobiert |
| 4 | Rechner schläft über 06:00 → nach dem Aufwachen läuft der verpasste Lauf | ⚠️ Logik mit künstlicher Uhr getestet; **nicht** mit echtem Ruhezustand |
| 5 | Fenster zu → App läuft in Menüleiste/Tray weiter | ⚠️ geschrieben und kompiliert; Tray-Icon wird angelegt (kein Fehler), aber unter dem virtuellen Display nicht sichtbar. Ausblenden beim Schließen **nicht** ausprobiert |
| 6 | Eine Woche täglicher Eigennutzung | ❌ offen |

Zusätzlich geprüft: zweiter Start auf bestehenden Daten (keine erneute Migration, Bearbeitung an `manifest.yaml` bleibt), Bundle-Smoke-Test lehnt absichtlich kaputte Bundles ab (ohne Engine, ohne Migrationen), SHA-256-Prüfung des Node-Downloads schlägt bei falschem Hash fehl, Rust-Pfadlogik (inkl. Windows-Präfix) als Unit-Test.

**Gefunden und behoben beim Bauen:** die Rust-Shell kompilierte seit Phase 1 nicht (fehlendes `use tauri::Manager`); der Autostart-Plugin hob Tauri auf 2.12.4, die npm-Pakete mussten angeglichen werden (sonst bricht `tauri build` ab); mit asynchroner Logdatei ging ein Startfehler verloren (jetzt synchron).

**Nicht geprüft, auf dem Mac/Windows zuerst ansehen:**
- `restart_core`, Autostart-Schalter, „Show log file“, Tray-Menü, Ausblenden/Wiederöffnen (Dock-Klick auf dem Mac)
- Mac: lädt die ad-hoc signierte Prisma-Engine? Liegt der Sidecar wie angenommen neben der Executable (`Contents/MacOS/node`), die Ressourcen in `Contents/Resources/core`? Schlüsselbund-Abfragen bei jedem neuen Build?
- Windows: kein aufblitzendes Konsolenfenster (`CREATE_NO_WINDOW`), Pfadlänge (MAX_PATH) im Installationsordner, NSIS- und MSI-Build, Defender/SmartScreen bei dem 120-MB-`node.exe`
- Beide: Größe des Installers (Linux-`.deb`: 63 MB), CI-Workflows (`ci.yml`, `release.yml`) sind nie auf einem echten Runner gelaufen
- Das Tray-Symbol ist das Standard-App-Icon (auf dem Mac ideal wäre ein einfarbiges Template-Bild)

**Bewusst nicht gelöst:** Signieren/Notarisieren (Phase 5); Verbesserungen an mitgelieferten Agenten erreichen bestehende Installationen nicht (Nutzerdateien werden nie überschrieben).

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

### Status 2c (2026-10-19)

Gebaut, mit Tests (Core: 213, App: 11) und im Browser mit dem echten Core angesehen:

| Plan | Umsetzung |
|---|---|
| Voting | 👍/👎 an Karten und im Reader; ein Votum pro Artikel, lokal gespeichert; Klick auf das aktive Votum löscht es |
| Interessenprofil | Opt-in pro Agent (`personalize: true`): die letzten ≤ 10 gemochten/nicht gemochten Titel (+Thema) gehen als `readerProfile` an das Modell, **nur** zum Gewichten der Wichtigkeit; der Prompt verlangt, dass das in `importanceReason` offengelegt wird. Die Seite „Dein Profil“ zeigt genau diese Liste und setzt sie zurück |
| Dubletten über Läufe | URL-genau, pro Agent, `dedupe_days` (Standard 14). Ist alles schon veröffentlicht: Lauf ohne Modellaufruf, Kosten 0, „Nichts Neues“ |
| Zweiter Agent / Ressorts | Statt eines fest eingebauten zweiten Agenten: **Ressort anlegen** aus der Vorlage (Name, Themen-Fokus, Quellen, Zeitplan) – nur der markierte Fokus-Satz von `newsletter-ai` wird ersetzt. Ressort-Leiste in der Zeitung; Ressorts lassen sich ein-/ausschalten und umbenennen |
| Generischer Quellen-Editor | Quellen-, Zeitplan-, Modell- und Profil-Bearbeitung pro Ressort („Ressorts“-Seite). Zeitplan ohne Cron-Kenntnis (täglich/wöchentlich/eigener Ausdruck/nur manuell) |
| Lauf-Historie | pro Ressort: Status, Auslöser, Modell, Kosten, Tokens und eine verständliche Erklärung je Lauf |
| „Jetzt aktualisieren“ (Tray) | läuft jetzt über alle aktiven Ressorts nacheinander |

**Bewusst nicht gemacht / offen:**
- **OpenAI-Adapter:** nicht gebaut. Modellnamen und Preise lassen sich von hier nicht verlässlich prüfen (gleiches Problem wie bei DeepSeek), und du nutzt DeepSeek. Der DeepSeek-Adapter ist OpenAI-kompatibel; ein weiterer Anbieter wäre eine kleine Erweiterung.
- **Filter `semantic`:** weiterhin abgelehnt. Das leistet jetzt der **Themen-Fokus eines Ressorts** (das Modell wählt passende Beiträge aus); die Stichwort-Filter an den Quellen sparen vorher Kosten.
- **Ressort löschen:** nicht gebaut (ausschalten statt löschen, Verlauf bleibt erhalten).
- **Dieselbe Meldung unter anderer URL** wird nicht als Dublette erkannt.
- **Delivery-Kanäle (E-Mail/Telegram):** nicht gebaut, weiter ohne Bedarf.

**Nicht verifiziert:**
- **Ob das Profil das Ranking wirklich verbessert.** Geprüft ist nur, dass es genau dann und genau so im Modell-Aufruf steht (Test mit Fake-Modell). Gegen ein echtes Modell (DeepSeek/Claude) nie gelaufen.
- Die Fokus-Formulierung im generierten Prompt („matching this focus: "…"") ist nicht mit einem echten Modell erprobt.
- Wie sich ein neues Ressort mit echten Quellen verhält (kein Netz in der Entwicklungsumgebung).
- Oberfläche nur in Chromium, nicht in den Tauri-Fenstern; keine automatisierten Komponententests.
- Ressorts erscheinen alphabetisch nach Namen, nicht nach Aktivität.
- Die Verwaltungsseiten sind deutsch, die Einstellungen (Schlüssel, App) noch englisch.

**Gefunden und behoben beim Ansehen im Browser:** Klick auf das bereits aktive Ressort leerte die Seite ohne Neuladen; für ein bloß leeres Ressort erschien das Erststart-Onboarding; CORS ließ `DELETE` nicht zu.

## Phase 3 — Reaktive Agenten (v2.0)

Wie in `SAMIX_ABOUT.md` vorgesehen: Agenten, die auf Anfrage arbeiten. Gleiche Skill-Abstraktion, Adapter, Budget-Gates; Tool-Use im Adapter-Interface. Der Zuschnitt steht in `docs/SAMIX_PHASE_3_SPEC.md`: **3a „Frag deine Zeitung“** (Fragen und Antworten über die gesammelten Artikel, mit Quellen) ist gebaut; **3b Projekt-Assistent (nur lesen)** und **3c Coding-Agent (mit Freigabe je Aktion)** sind dort nur beschrieben, nicht gebaut.

### Status 3a (2026-10-19)

Gebaut (Core: 264 Tests, App: 14), die Oberfläche im Browser mit dem echten Core und einem Fake-Modell angesehen:

| Plan (Spec) | Umsetzung |
|---|---|
| Adapter-Tool-Calling (§4) | `ToolSpec`/`ToolCall`/Tool-Nachrichten im `ModelAdapter`; Claude und DeepSeek übersetzen in die Anbieterform; Ollama/Perplexity/Static lehnen Tools ab |
| Vier Lese-Tools (§5) | `list_ressorts`, `search_articles` (Ganzwort, Unicode, Ressort-/Datumsfilter), `get_article` (ohne Netz), `fetch_full_text` (nur per `articleId`, höchstens 3 je Frage); Fehler kommen als Ergebnis zurück, nie als Absturz |
| Gesprächsschleife (§6) | `runner/converse.ts`: ≤ 6 Modellaufrufe, Budget-Gate (Agent + global) vor **jedem** Aufruf, Kosten jedes Aufrufs gebucht, „erst suchen“, höchstens 4 Tool-Aufrufe je Schritt, eine Frage je Agent gleichzeitig, letzte 6 Züge als Verlauf |
| Quellenpflicht im Code | nur Artikel, die ein Tool in **dieser** Frage geliefert hat, dürfen zitiert werden; Erfundenes fällt weg, `[n]` wird neu nummeriert; bleibt nichts Belegbares → `partial` ohne Antwort; wurde gar nichts gefunden, zeigt der Core einen festen Text statt der Modellantwort |
| Datenmodell/API (§8) | `Conversation`, `ConversationMessage` (Migration), `POST /ask`, `GET /conversations`, `GET`/`DELETE /conversations/:id`; Manifest-Feld `tools:` (unbekannte Namen werden abgelehnt) |
| Agent | `agents/frag-die-zeitung` (reaktiv, Haiku, 0,50 $/Tag); erscheint nicht unter „Ressorts“ |
| UI „Fragen“ | Gesprächsliste (löschbar), Antwort mit nummerierten Quellen → Reader → zurück zur Antwort, „Wie kam das zustande?“ (Schritte, Modell, Kosten), Hinweis zum Datenfluss, Modellwahl, verständliche Texte je Fehlerstatus |

Abnahme gegen die Spec-Kriterien (§10): 1–8 erfüllt (Tests; Mutationsproben für Budget-Gate vor jedem Aufruf, Zitierprüfung, Fallback ohne Tools, Suche-zuerst, Aufruf- und Verlaufslimits, „nichts gefunden“, Buchung der Kosten). Die Probe „Modell ohne Tools wird vorab abgelehnt“ war zunächst wirkungslos, weil die Prüfung im Fallback-Pfad dasselbe abfängt; ein Test prüft jetzt zusätzlich, dass kein Gespräch angelegt wird.

**Nicht verifiziert / offen:**
- **Kriterium 9 und 10:** Antwortqualität, echte Tool-Nutzung und Prompt-Injection-Verhalten realer Modelle sind **nicht geprüft** (kein Schlüssel, kein Netz). Das Tool-Format von Claude und DeepSeek ist nur gegen Fakes getestet; dass die DeepSeek-API Function Calling wie angenommen unterstützt, kann ich nicht verifizieren.
- **Suche nur mit ganzen Wörtern:** „Chip“ findet „Chips“ nicht. Der Prompt weist das Modell darauf hin, Wortformen mitzusuchen; ob es das tut, ist ungeprüft. Eine Wortstamm-/Volltextsuche wäre ein Folgeschritt.
- Die Verlaufszüge werden als Klartext wiedergegeben; ob ein Modell dadurch vom JSON-Endformat abkommt, ist ungeprüft (es gibt eine Korrekturaufforderung, danach `partial: invalid_output`).
- Ein Modell kann durch Fremdtext in Artikeln eine irreführende, aber **belegte** Antwort geben (Restrisiko, Spec §7).
- „Nichts gefunden“ und die Fehlertexte sind deutsch fest eingebaut, unabhängig von der Sprache der Frage.
- Oberfläche nur in Chromium; keine Komponententests (nur die Aufteilung der Antwort in Text und Quellenmarker ist getestet).
- 3b und 3c: nicht begonnen.

## Phase 4 — Orchestrator & Cross-Agent-Memory (v3.0)

Spec: `docs/SAMIX_PHASE_4_SPEC.md`. Zuschnitt (vom Auftraggeber gewählt): **ein Eingang, der weiterleitet** (kein Mehrschritt-Planer) und **sichtbare Notizen des Nutzers** als Gedächtnis (kein automatisches Lernen).

### Status 4 (2026-10-19)

Gebaut (Core: 282 Tests, App: 14), die Oberfläche im Browser mit dem echten Core und einem Fake-Modell angesehen:

| Plan (Spec) | Umsetzung |
|---|---|
| Notizen (§4) | `MemoryNote` (Migration), `GET/POST /notes`, `DELETE /notes/:id`, höchstens 100 Stück à 500 Zeichen; Bereich „Notizen“ in „Fragen“; Tool `read_notes` (nur lesen, liefert keine Artikel-IDs, also nie zitierbar); „Frag deine Zeitung“ darf es laut Manifest nutzen |
| Orchestrator (§5) | `runner/orchestrate.ts` + `agents/orchestrator`: **ein** Routing-Aufruf wählt genau eine Aktion (`delegate`, `show_notes`, `propose_refresh`, per Manifest `routes:`/`delegates:` freigegeben). Angezeigt wird nur das Ergebnis der Aktion, nie Modelltext des Routers; Text statt Tool → eine Erinnerung, dann `no_route` |
| Delegation | Der Delegat läuft über `askAgent` (`ephemeral`, mit den Gesprächszügen als Verlauf) mit **eigenem** `AgentRun`, eigenem Budget und eigenen Gates; seine geprüften Zitate und sein Status werden unverändert übernommen. Die Antwort zeigt die Summe der Kosten |
| Vorschlag statt Aktion | `propose_refresh` startet **nichts**; die Oberfläche zeigt einen Knopf, der erst nach Klick `POST /agents/:slug/run` auslöst |
| Gemeinsame Bausteine | `runner/turn.ts` (Sperre, Gespräch, Verlauf, `AgentRun`) und `runner/budget.ts`, von `askAgent` und dem Orchestrator geteilt |
| API/UI | `POST /ask` geht standardmäßig an den Orchestrator (sonst direkt an „Frag deine Zeitung“); „Weitergeleitet an …“, Vorschlagsknopf, Notizen, beide Modelle wählbar, Datenfluss-Hinweis nennt alle beteiligten Modelle |

Mutationsproben erfasst: Budget-Gate vor dem Routing, Delegaten-Allowlist, `ephemeral`, Summe der Kosten, Verlauf an den Delegaten, ausgeschaltetes Ressort, Text-ohne-Tool-Pfad, Limit der Routing-Aufrufe (nach einem Test mit festem Wert statt der Konstante).

**Nicht verifiziert / offen:**
- **Kriterien 9 und 10 der Spec:** Wahl der Aktion und Formulierung der Delegaten-Frage durch ein **echtes** Modell, sowie Prompt-Injection-Verhalten, sind nicht geprüft (kein Schlüssel, kein Netz). Gegen Fakes getestet ist nur die Mechanik.
- [Inference] Mit einem Antwort-Agenten bringt der Router heute wenig über „Fragen“ hinaus; er kostet einen zusätzlichen Modellaufruf je Frage. Der Mehrwert entsteht erst mit weiteren Delegaten (3b/3c).
- Der Router formuliert die Frage an den Delegaten um; die umformulierte Frage steht im Ablauf („Wie kam das zustande?“), aber das Modell kann sie verfälschen.
- Ein Vorschlagsknopf ist nach dem Neuladen eines Gesprächs wieder klickbar (der Zustand „schon ausgelöst“ wird nicht gespeichert).
- Notizen fließen **nicht** in die Ressort-Läufe (`personalize`) ein; nur „Frag deine Zeitung“ kann sie lesen. Das Modell kann sie nicht schreiben.
- Keine Planung über mehrere Schritte, keine Ketten von Delegaten.
- Oberfläche nur in Chromium, keine Komponententests.

### Status 3b (2026-10-19) — Projekt-Assistent (nur lesen)

Spec: `docs/SAMIX_PHASE_3B_SPEC.md`. Als zweiter Delegat des Orchestrators gebaut, damit der Eingang einen Nutzen hat. Core: 310 Tests; die Oberfläche im Browser mit dem echten Core und einem Fake-Modell gesehen.

| Plan | Umsetzung |
|---|---|
| Freigabe | `Project` (Migration), `GET/POST /projects`, `PUT /projects/:id` (Haken „an Modell senden erlaubt“), `DELETE`. Ohne Haken liefern die Tools nichts; Widerruf wirkt sofort. `/`, Laufwerkswurzeln und der Home-Ordner selbst werden abgelehnt |
| Pfadsicherheit | `projects/safePath.ts`: nur relative Pfade, kein `..`/`\`/NUL/absolut, `realpath` muss in der echten Wurzel liegen (Symlinks nach außen, Geschwisterordner mit gleichem Präfix), Symlinks werden beim Auflisten/Suchen übersprungen, Ausschlüsse (`.git`, `node_modules`, `.ssh`, `.env*`, Schlüsseldateien …) gelten auch über Symlinks. Nur Text, ≤ 500 KB, ≤ 8000 Zeichen je Lesevorgang |
| Tools | `list_projects`, `list_files`, `search_files` (einfache Textsuche), `read_file` (mit Zeilennummern) |
| Zitate | Quell-ID `file:<projekt>:<pfad>`; dieselbe Code-Prüfung wie bei Artikeln (nur in **dieser** Frage gelieferte Dateien, sonst keine Antwort); Zitat zeigt Pfad und Projekt (keine Zeilen). Manifest `empty_answer` ersetzt den „nichts gefunden“-Text je Agent |
| Agent/Orchestrator | `agents/projekt-assistent`; `orchestrator` listet ihn unter `delegates:` |
| UI | Bereich „Projekte“ (freigeben, Haken, entfernen), Datei-Zitate ohne Reader-Link, Datenfluss-Hinweis |

Mutationsproben erfasst: `..`-Prüfung, `realpath`-Prüfung (inkl. Präfix ohne Trennzeichen), Ausschluss über Symlink-Ziel, `.env`-Muster, Binär- und Größengrenze, Freigabe-Prüfung, Zitierprüfung, Home-Ordner. Nicht erfasst (gleichwertig, weil doppelt abgesichert): der Ausschluss nach Namen vor `realpath` und das explizite Überspringen von Symlinks (Dirent meldet sie ohnehin nicht als Datei/Ordner).

**Nicht verifiziert / offen:**
- **Kriterium 7 der Spec:** Antwortqualität, Tool-Nutzung und Prompt-Injection-Verhalten echter Modelle bei fremdem Code sind nicht geprüft.
- **Heuristik, keine Garantie:** Die Ausschlussliste findet keine Geheimnisse in gewöhnlich benannten Dateien (z. B. ein Token in `config.json`). Was gelesen wird, geht an den Modellanbieter.
- Windows-Pfade (Laufwerksbuchstaben, Groß-/Kleinschreibung, `\`) sind nur durch Ablehnung abgedeckt, auf Windows nicht getestet; macOS ebenfalls nicht (nur Linux).
- Der Ordner wird per eingetipptem Pfad freigegeben (kein Ordner-Dialog).
- Bestehende Installationen: `seedAgents` überschreibt nie. Ein schon kopierter `orchestrator` kennt `projekt-assistent` nicht, bis `delegates:` in seiner `manifest.yaml` ergänzt wird; `projekt-assistent` selbst wird neu kopiert und ist direkt über `agent: projekt-assistent` ansprechbar.
- Zitate nur auf Dateiebene; keine Schreib-/Ausführ-Tools (**3c** bleibt offen und braucht ein eigenes Spec mit Freigabe je Aktion).

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

## Entscheidungen

### Getroffen (2026-10-19)

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Aufmacher-Volltext komplett oder angeschnitten? | **angeschnitten** mit „Weiterlesen“, Länge als Einstellung (später änderbar) |
| 2 | Bilder im Reader? | **ja**, lokal gecacht |
| 3 | Eine Ausgabe = ein Lauf oder ein Tag? | **ein Lauf** |
| 4 | macOS-Architektur | **nur Apple Silicon** vorerst |
| 5 | Quellen | **Webseiten** angeben können: neueste Artikel, optional mit Themen-Filter (Abschnitt 2a.0) |

### Offen (vor Start der jeweiligen Phase)

| # | Frage | Phase | Vorschlag |
|---|---|---|---|
| 6 | Webseiten-Filter Default `keywords` (kostenlos) oder `semantic` (genauer, kostet Tokens)? | 2a | `keywords`, `semantic` pro Quelle zuschaltbar |
| 7 | Core-Bündelung (ADR-007) | 2b | Spike entscheidet |
| 8 | Apple-Developer-Konto für Signatur? | 5 | erst bei Veröffentlichung nötig |

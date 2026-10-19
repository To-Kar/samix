# Samix — Phase 3b Spec: Projekt-Assistent (nur lesen)

**Stand:** 2026-10-19 · **Bezug:** `SAMIX_PHASE_3_SPEC.md` §9, `SAMIX_PHASE_4_SPEC.md`, `SAMIX_ABOUT.md`
**Status:** Entwurf → umgesetzt (Abnahme in `SAMIX_ROADMAP.md`, „Status 3b“)

> Kennzeichnung: **[Unverified]** / **[Inference]** wie im Rest des Projekts.

## 1. Entscheidung und Zweck

Ein zweiter Delegat für den Orchestrator (Phase 4), damit der Eingang einen echten Nutzen hat: **„Frag dein Projekt“** beantwortet Fragen zu Dateien eines lokalen Ordners (Code, Notizen, Dokumente) — **nur lesen**, mit Dateiangabe als Beleg. Schreiben/Ausführen (3c) bleibt ausdrücklich ausgeklammert.

Nicht-Ziele: keine Schreib-/Ausführ-Tools, keine Shell, kein Zugriff außerhalb freigegebener Ordner, keine Indizierung/Vektorsuche, kein Zitat auf Zeilenebene (nur Datei; die Tools liefern Zeilennummern im Text).

## 2. Werte-Check

| Wert | Konsequenz |
|---|---|
| Local-first | Ordner werden **einzeln und ausdrücklich** freigegeben (Pfad + Haken „Dateiinhalte dürfen an das Modell gesendet werden“). Ohne Haken liefern die Tools nichts. Es gibt keinen Standardordner |
| Honest AI / source-traceable | Zitierbar sind nur Dateien, die ein Tool in **dieser Frage** geliefert hat (gleiche Code-Prüfung wie bei Artikeln); sonst keine Antwort. Gibt es nichts, sagt der Core das mit festem Text |
| Budget-disciplined | Gleiche Schleife und Gates wie „Frag deine Zeitung“ (≤ 6 Aufrufe, Gate vor jedem); zusätzlich Größen-/Mengenlimits der Tools |
| Skills are data | `agents/projekt-assistent/`; Werkzeuge per Manifest; der Orchestrator darf ihn nur per `delegates:` erreichen |

## 3. Sicherheit (hier liegt das Risiko)

- **Nur freigegebene Wurzeln.** Ein Projekt = absoluter Ordner, der existiert. `/`, Laufwerkswurzeln und das Home-Verzeichnis selbst werden abgelehnt.
- **Pfade nur relativ zur Wurzel.** Absolute Pfade, `..`-Segmente, Rückwärts-Schrägstriche und NUL werden abgelehnt; danach `realpath` und Prüfung, dass das Ergebnis **innerhalb** der echten Wurzel liegt (fängt Symlinks nach außen). Symlinks werden beim Auflisten und Suchen **übersprungen**.
- **Ausschlüsse (unsichtbar, nicht lesbar, nicht durchsucht):** `.git`, `node_modules`, `.ssh`, `.gnupg`, `.aws`, `.kube`, `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `id_rsa*`, `id_ed25519*`, `id_dsa*`, `credentials*`.
- **Nur Text, begrenzt.** Dateien mit NUL-Bytes (binär) und > 500 KB werden nicht gelesen; ein Lesevorgang liefert ≤ 8000 Zeichen; Auflisten ≤ 200 Einträge; Suche ≤ 20 Treffer, ≤ 2000 Dateien, nur Dateien ≤ 1 MB.
- **Prompt-Injection:** Dateiinhalte sind Fremdtext und können Anweisungen enthalten. Schranken wie bisher: keine Schreib-/Netz-Tools, Quellenprüfung im Code. Restrisiko: eine irreführende, aber **belegte** Antwort. [Inference: realistisch bei fremden Repos]
- **Datenfluss:** Gelesene Dateiausschnitte gehen an den Modellanbieter. Das steht an der Freigabe und im Fragen-Bereich.
- Was **nicht** ausgeschlossen werden kann: Geheimnisse in gewöhnlich benannten Dateien (z. B. Token in `config.json`). Die Liste oben ist eine Heuristik, keine Garantie. [Unverified: Vollständigkeit]

## 3a. Bausteine

`Project { id, name, path, allowModelAccess, createdAt }` (Migration). API: `GET/POST /projects`, `PUT /projects/:id {allowModelAccess}`, `DELETE /projects/:id`.
Tools (nur freigegebene Projekte): `list_projects`, `list_files {project, path?}`, `search_files {project, query, path?}`, `read_file {project, path, startLine?, maxLines?}`. Quell-ID einer Datei: `file:<projektId>:<relativer Pfad>`.
Zitate: `AnswerCitation.kind = 'file'` mit `path` und Projektname; die Oberfläche zeigt sie ohne Reader-Link.
Manifest-Feld `empty_answer`: Text, wenn nichts gefunden wurde (Zeitung: „…Artikeln…“, Projekt: „…Projekten…“).

## 4. Akzeptanzkriterien

| # | Kriterium | Prüfung |
|---|---|---|
| 1 | `..`, absolute Pfade, `\`, NUL, Symlink nach außen, Ausschlüsse werden abgelehnt/nicht gelistet/nicht gefunden | Tests (echtes Dateisystem im Temp-Ordner) + Mutationstest |
| 2 | Ohne Freigabe liefert kein Tool Inhalt; Freigabe widerrufbar | Tests |
| 3 | Größen-/Mengenlimits, Binärdateien | Tests |
| 4 | Zitate: nur gelieferte Dateien; erfundene verworfen; „nichts gefunden“-Text je Agent | Tests |
| 5 | Orchestrator leitet an den Projekt-Assistenten; eigener Run/Budget | Test |
| 6 | UI: Projekt freigeben/widerrufen/entfernen, Datei-Zitate | im Browser |
| 7 | Antwortqualität/Tool-Nutzung echter Modelle, Prompt-Injection realer Modelle | ❌ nicht prüfbar |

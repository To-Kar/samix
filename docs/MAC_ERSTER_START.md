# Samix auf dem Mac: erster Start und was zu beobachten ist

Alles Folgende ist in der Entwicklungsumgebung (Linux, kein Mac, kein API-Schlüssel, kein Netz) **nicht** geprüft worden. Diese Liste soll beim ersten echten Lauf zeigen, was davon stimmt. Bitte Auffälligkeiten mit Datum und Logauszug festhalten.

## 0. Voraussetzungen
- Apple Silicon, Node ≥ 22.13 (`.node-version`), pnpm ≥ 10, Rust-Toolchain, Xcode Command Line Tools.
- `pnpm install`, dann entweder `pnpm dev:app` (Entwicklung) oder `pnpm build:app` (installierbare App; auf dem Mac bauen).
- [Unverified] Der erste macOS-Build ist nie gelaufen; mit Fehlern in `tauri build` (Bundle, Sidecar-Name, Gatekeeper) ist zu rechnen. Für die persönliche Nutzung ist keine Signierung nötig; macOS fragt beim ersten Öffnen nach („Rechtsklick → Öffnen“).

## 1. Schlüssel und Modell
- Einstellungen: DeepSeek- und/oder Anthropic-Schlüssel eintragen (landet im macOS-Schlüsselbund). Danach in „Ressorts“ bzw. „Fragen → Modelle“ das Modell wählen.
- **Preise und Modellname von DeepSeek sind Platzhalter** (`core/src/adapters/deepseek.ts`, überschreibbar über `SAMIX_DEEPSEEK_PRICE_IN/OUT`, `SAMIX_DEEPSEEK_MODEL`). Vor dem ersten Lauf mit der Preisseite des Anbieters abgleichen, sonst lügt das Budget. Tagesbudgets stehen in den `manifest.yaml`s (Ressort 0,50 $, Fragen 0,50 $, Eingang 0,20 $) und global `SAMIX_GLOBAL_DAILY_USD_MAX` (Standard 5 $).
- **Tool-Calling** (Fragen, Eingang, Projekt) ist für Claude und DeepSeek nur gegen Fakes getestet. Wenn ein Modell Werkzeuge ablehnt oder falsch aufruft, steht der Grund unter „Wie kam das zustande?“.

## 2. Reihenfolge der Prüfung (billig → teuer)
1. App startet, Banner „Core connected“, Fenster schließen → Tray/Menüleiste bleibt, Beenden über Tray.
2. Ressort „KI-News“ **einmal manuell** laufen lassen. Erwartet: Artikel, Kosten wenige Cent in der Lauf-Historie (Ressorts → Lauf-Historie). Kosten gegen die Abrechnung des Anbieters vergleichen.
3. Artikel im Reader öffnen (Volltext, Bilder). [Unverified: echte Webseiten]
4. Fragen: „Was gab es zu <Thema aus dem Ressort>?“ → Antwort mit Quellen, „Weitergeleitet an …“, Kosten. Danach eine Frage zu etwas, das nicht gesammelt wurde → „nichts gefunden“ statt einer Antwort.
5. Notiz anlegen, Frage stellen, prüfen ob `read_notes` im Ablauf auftaucht.
6. Projekt freigeben (kleiner Ordner ohne Geheimnisse zuerst), Frage zu einer Datei → Zitat mit Pfad.
7. Autostart/Wake-Catch-up erst nach 1–6 testen (Mac zuklappen, am nächsten Tag öffnen; der Lauf sollte nachgeholt werden).

## 3. Wo man nachsieht
- Log: Datei im App-Datenordner (Einstellungen zeigt die Pfade; `get_app_paths`); Stufe über `SAMIX_LOG_LEVEL=debug`.
- Datenbank: `pnpm db:studio` (Entwicklung).
- Kosten je Tag: Tabelle `BudgetLedger`; je Lauf: `AgentRun`.
- Läuft nach dem Schließen noch ein Core-Prozess? (`pgrep -fl samix`). Er sollte mit der App enden.

## 4. Bekannte Lücken (siehe `SAMIX_ROADMAP.md`)
- Fragen/Eingang/Projekt: Antwortqualität und Prompt-Injection realer Modelle ungeprüft.
- Wortgleiche Suche: „Chip“ findet „Chips“ nicht.
- Bestehende Installationen: ein früher kopierter `orchestrator` kennt `projekt-assistent` nicht, bis `delegates:` in seiner `manifest.yaml` ergänzt ist.
- Nicht gebaut: Ressort löschen, OpenAI-Adapter, Coding-Agent (3c), Veröffentlichung/Signierung (Phase 5).

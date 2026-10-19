# Samix veröffentlichen: Stand, Anleitung, offene Punkte

**Stand:** 2026-10-19. Alles in diesem Dokument ist in der Entwicklungsumgebung (Linux, kein Mac, kein Windows, kein Apple- oder Windows-Konto, kein GitHub-Runner) **nicht ausprobiert**. Was ich über Apples und Tauris Abläufe weiß, steht als **[Unverified]**; prüfe es gegen die aktuelle Dokumentation, bevor du Geld oder Zeit darauf verwendest.

## 1. Was heute schon da ist

| Teil | Zustand |
|---|---|
| Installierbare App | `pnpm build:app` auf dem Zielsystem; die CI-Workflows bauen auf macOS (Apple Silicon) und Windows (x64). **Nie auf einem echten Runner gelaufen** |
| Signierung macOS | `release.yml` signiert und notarisiert, **wenn** die Apple-Secrets (unten) gesetzt sind; sonst unsigniert. Ungeprüft |
| Signierung Windows | nicht eingerichtet (immer unsigniert) |
| Auto-Update | **nicht gebaut** (siehe 4.) |
| Versionen | ein Skript `scripts/version.mjs` hält alle Stellen gleich; CI und ein Test brechen, wenn sie auseinanderlaufen |
| GitHub-Release | bei einem Tag `vX.Y.Z` entsteht ein **Entwurf** mit den Installern; veröffentlicht wird nichts von selbst. Ungeprüft |
| Lizenz | **keine `LICENSE`-Datei im Repo** (siehe 5.) |

## 2. Eine Version veröffentlichen

1. `node scripts/version.mjs 0.2.0` (setzt Version in 6 Dateien und `Cargo.lock`); `node scripts/version.mjs --check` prüft.
2. Alle Tests lokal: `pnpm --filter samix-core test`, `pnpm --filter samix-app test`.
3. Committen, Tag setzen: `git tag v0.2.0 && git push origin v0.2.0`. Der Workflow „Release build" prüft, dass der Tag zur Version passt, baut beide Plattformen und legt einen Entwurf an.
4. Die Installer auf **echten, frischen Rechnern** ausprobieren (Abschnitt 6), dann den Entwurf von Hand veröffentlichen.

## 3. Signieren

### macOS
- Voraussetzung: **Apple Developer Program** (Mitgliedschaft, kostet Geld; aktuelle Kosten und Ablauf [Unverified] bei Apple nachsehen). Ohne Signatur und Notarisierung warnt Gatekeeper beim ersten Öffnen („nicht verifizierter Entwickler"); für die private Nutzung genügt Rechtsklick → Öffnen.
- Benötigt: ein Zertifikat „Developer ID Application" (als `.p12` exportiert) und Zugangsdaten für die Notarisierung.
- GitHub-Secrets für `release.yml` (Namen wie in Tauris Dokumentation [Unverified]):
  - `APPLE_CERTIFICATE`: das `.p12`, base64-kodiert (`base64 -i cert.p12 | pbcopy`)
  - `APPLE_CERTIFICATE_PASSWORD`: sein Passwort
  - `APPLE_SIGNING_IDENTITY`: z. B. `Developer ID Application: Name (TEAMID)`
  - `APPLE_ID`: die Apple-ID für die Notarisierung
  - `APPLE_PASSWORD`: ein **App-spezifisches Passwort** (nicht das Apple-ID-Passwort)
  - `APPLE_TEAM_ID`: die Team-ID
- Sind alle sechs gesetzt, läuft der Schritt „macOS, signed and notarised"; sonst der unsignierte. Ob Tauri die Variablen so erwartet und ob der Sidecar (Node-Binary) und der Core-Ordner mit signiert werden, ist **ungeprüft**; beim ersten Versuch mit Apples `spctl --assess` und `codesign --verify --deep` nachprüfen.
- Hardened Runtime: das mitgelieferte Node läuft als Hilfsprogramm; ob es eigene Entitlements braucht (z. B. für JIT) [Unverified], zeigt erst ein echter Lauf mit Notarisierung.

### Windows
- Ohne Signatur zeigt SmartScreen eine Warnung. Optionen (Kosten und Verfügbarkeit [Unverified] prüfen): ein Code-Signing-Zertifikat (OV/EV) oder ein Cloud-Signaturdienst. Nichts davon ist eingerichtet. Wenn du dich entschieden hast, ergänze ich den Schritt in `release.yml`.

## 4. Auto-Update (nicht gebaut, bewusst)

Tauris Updater-Plugin würde so eingebunden [Unverified, gegen die Tauri-Doku prüfen]:
1. Schlüsselpaar erzeugen (`pnpm exec tauri signer generate`); der **private Schlüssel** kommt als Secret in die CI (geht er verloren, kann keine App mehr aktualisiert werden), der öffentliche in `tauri.conf.json`.
2. Plugin in Cargo/npm/`lib.rs`/Capabilities einbinden, einen Endpunkt festlegen (z. B. `latest.json` als Release-Datei) und einen UI-Hinweis „Update verfügbar" bauen.
3. Der Release-Workflow muss signierte Update-Pakete und `latest.json` erzeugen.

Warum noch nicht: Ein falsch konfigurierter Updater (falscher öffentlicher Schlüssel, falsche URL) kann Installationen von Updates abschneiden, und ich kann ihn hier nicht gegen einen echten Release prüfen. Er lohnt sich, sobald es Nutzer außer dir gibt. Dabei auch klären: Die App sendet sonst **nichts** an Dritte außer den von dir gewählten Modellanbietern und den abgerufenen Quellen; ein Update-Check wäre eine weitere Verbindung und gehört in den Datenschutztext.

## 5. Vor einer öffentlichen Weitergabe zu klären (Entscheidungen für dich)

- **Lizenz:** Es gibt keine `LICENSE`-Datei. Ohne Lizenz dürfen andere den Code nicht nutzen oder weitergeben. Welche (oder keine, wenn Samix privat bleibt) das sein soll, entscheidest du; ich wähle keine. Die Lizenzen aller Abhängigkeiten (npm, Rust, Schriften, Icons) sind **nicht geprüft**.
- **Datenschutz / Datenfluss:** Die App schickt Fragen, Artikelauszüge, freigegebene Dateiausschnitte und Notizen (nur wo erlaubt) an die gewählten Modellanbieter, und Suchbegriffe an Perplexity (Websuche). Ein Entwurf für Endnutzer steht in `docs/SAMIX_PRIVACY.md` (rechtlich ungeprüft); die Oberfläche nennt den Datenfluss zusätzlich an den jeweiligen Stellen.
- **Quellen / Urheberrecht:** Samix speichert Volltexte lokal (Cache, Standard 90 Tage) und zeigt Zusammenfassungen. Die rechtliche Einordnung steht als offene Frage im Roadmap-Abschnitt „Rechtlicher Hinweis"; sie ist nicht geklärt.
- **Kosten:** Nutzer tragen ihre API-Kosten selbst. Preise sind in der App einstellbar, aber die eingebauten ungeprüft; das gehört vor einer Weitergabe geprüft.
- **Zweck „Frag dein Projekt":** Er liest Dateien nach ausdrücklicher Freigabe. Der Ausschluss sensibler Dateien ist eine Heuristik (siehe Roadmap), keine Garantie; das muss Nutzern gesagt werden.
- **Namen und Marken:** Ob „Samix" als Name frei nutzbar ist, habe ich nicht geprüft.
- **Support und Fehlerberichte:** Es gibt keine Telemetrie und keinen Weg, Fehler zu melden, außer der Logdatei (Einrichtung → Logdatei anzeigen).

## 6. Prüfliste auf echten Rechnern (vor dem Veröffentlichen)

Pro Plattform auf einem **frischen Benutzerkonto** (ohne Entwicklertools):
1. Installieren, starten: Gatekeeper/SmartScreen-Verhalten notieren.
2. Onboarding: Anbieter, Schlüssel, Test, erste Ausgabe.
3. Fenster schließen → Tray/Menüleiste; Beenden über das Tray; danach läuft kein `node`-Prozess mehr.
4. Autostart an/aus, Neustart des Rechners.
5. Zuklappen/Ruhezustand über eine geplante Zeit → Nachholen.
6. Update von der vorigen Version **über** die alte Installation: Datenbank, Schlüssel, Agenten (Agenten-Update, Backup-Ordner) und Ressorts bleiben.
7. Deinstallieren: was bleibt zurück (Datenordner, Schlüsselbund-Eintrag „samix")? In die Anleitung schreiben.
8. Die „Nicht verifiziert"-Listen der Phasen in `SAMIX_ROADMAP.md` einmal durchgehen.

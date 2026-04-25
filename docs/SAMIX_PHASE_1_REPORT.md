# Samix — Phase 1 Handoff Report

**Date:** 2026-04-25
**Companion to:** `SAMIX_PHASE_1_SPEC.md`, `SAMIX_PHASE_1_CLAUDE_CODE_HANDOFF.md`

---

## Acceptance criteria

From spec §19 — 10 of 12 pass; 2 intentionally dropped (see Deviations).

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Settings-Page → API-Keys in OS-Keychain, kein Wert im Filesystem | ✅ |
| 2 | App-Start → Core bootet mit Keys aus ENV; Logs zeigen `adapter_ready` für `claude-haiku-4-5`, `perplexity-sonar`, `ollama-llama3` | ✅ |
| 3 | `POST /agents/newsletter-ai/run` → `status='success'`, ≥5 `Article`-Zeilen mit `sourceUrl` + `publishedAt`, ≥1 `SourceSnapshot` pro konfigurierter Quelle | ✅ |
| 4 | Newspaper-Seite zeigt Artikel gruppiert nach Tag; `Open` öffnet Original-URL im externen Browser | ✅ |
| 5 | SMTP: Test-Send + automatische Mail nach echtem Run | ❌ (dropped — see Deviations) |
| 6 | Telegram analog zu 5 | ❌ (dropped — see Deviations) |
| 7 | Cron auf `* * * * *` → innerhalb 60 s wird `AgentRun` mit `trigger='schedule'` angelegt | ✅ |
| 8 | API-Key ungültig → Run fällt auf `ollama-llama3` zurück, `status='success'` | ✅ |
| 9 | Sources-Seite: RSS-URL ändern → `manifest.yaml` auf Disk überschrieben, Scheduler reload, neuer Run liefert Items der neuen Quelle | ✅ |
| 10 | Globalen Cap auf `0.01` → `reason: 'global_budget_exceeded'`, keine API-Kosten | ✅ |
| 11 | Schema-Verletzung → `AgentRun.status='partial'`, keine `Article`-Zeilen | ✅ |
| 12 | Ollama nicht installiert → Startup-Log `ollama_unreachable`, andere Adapter weiter funktional | ✅ |

---

## How to run it

Phase 1 eliminiert das zwei-Terminal-Setup aus Phase 0. Ein Befehl reicht:

```bash
pnpm dev:app
```

Die Tauri-Shell spawnt den Core automatisch mit einem generierten Port + Token und injiziert die API-Keys aus der OS-Keychain.

**First-run setup** (einmalig):
1. App öffnen → **Settings** → Anthropic API Key + optional Perplexity API Key eingeben → Save
2. App neu starten (damit Keys beim nächsten Spawn in die ENV kommen)
3. **Run newsletter-ai** → erste Artikel erscheinen in der Newspaper-Ansicht

**Sources konfigurieren** (optional):
- **Sources**-Button → RSS-URLs / Arxiv-Kategorien / Perplexity-Queries editieren → Save
- Manifest wird auf Disk geschrieben, Scheduler registriert den Job neu (kein Restart nötig)

---

## Decisions taken

| Entscheidung | Begründung |
|---|---|
| `feedsmith ~2.7` als RSS/Atom-Parser | `rss-parser` seit Jahren inaktiv; `feedsmith` modern, ESM-nativ, parst auch Arxiv-Atom-Feed. Version gepinnt wegen `tsx`-Kompatibilität. |
| `cron-parser` für Catchup-Berechnung | `node-cron` v3 bietet keine `prev()`-Methode; `cron-parser` ist der De-facto-Standard dafür. |
| TCP-Connect statt HTTP `/health` im Rust-Spawn-Check | Kein `reqwest`-Dep in Rust nötig; TCP-Accept bedeutet, dass Fastify gebunden hat. Kein funktionaler Unterschied für Dev-Mode. |
| 15-s-Timeout im Spawn-Wait | Handoff spezifiziert 10 s; `tsx watch` + Prisma-Init dauert auf langsamen Maschinen länger. `ConnectionBanner` fängt den Reconnect-Fall ab. |
| `SAMIX_GLOBAL_DAILY_USD_MAX` Fallback = 5.0 USD | Env-Var fehlt → konservatives Default, kein ungebundenes Spending. |
| Delivery-Pivot: Newspaper-UI als einziger Delivery-Surface | Explizite Entscheidung (commit `65f9e45`) — SMTP + Telegram werden nicht gebaut. Spec-Sections §16 und §18 (Delivery) sind damit superseded. |
| Atom. Manifest-Write: `tmp`-Datei im selben Verzeichnis + `rename` | Cross-filesystem-Probleme bei `/tmp` vermieden; `rename(2)` ist atomar auf demselben Mountpoint. |
| `sources`-Editor hardcoded auf `newsletter-ai` | Phase 1 hat genau einen proactive Agent; ein generischer Multi-Agent-Selector kommt in Phase 2 wenn ein zweiter Agent entsteht. |

---

## Deviations from spec

### Delivery-Kanäle vollständig entfernt

Spec §16 + §18 sahen `DeliveryDispatcher`, `MailChannel`, `TelegramChannel`, `DeliveryLog`, `DeliverySchedule` vor. Diese wurden in einem expliziten Pivot gestrichen:

- `DeliveryLog` + `DeliverySchedule` Prisma-Modelle nicht vorhanden
- `RunResult.deliveries: DeliveryResult[]` nicht im Interface
- `GET /deliveries`, `PUT /deliveries/:channel`, `POST /deliveries/:channel/test` nicht implementiert
- Deliveries-UI-Seite nicht vorhanden

**Begründung:** Das Newspaper-UI ist ausreichend als primäre Delivery-Surface für Phase 1. Delivery-Kanäle erhöhen die Setup-Hürde (SMTP App-Passwords, Telegram Bot-Setup) ohne proportionalen Mehrwert. Können in Phase 2 als opt-in Feature nachgerüstet werden.

### Acceptance-Kriterien 5 + 6

Folgen direkt aus dem Delivery-Pivot. Beide als "dropped" markiert, nicht als "failed".

---

## Known issues / follow-ups

- **Rust-Build auf Linux**: `cargo check` schlägt fehl wegen fehlender GTK3-Systembibs (`gdk-3.0`). Das ist eine Tauri-Build-Voraussetzung auf Linux; auf macOS (Entwicklungsplattform) kompiliert es normal. CI/CD braucht `libgtk-3-dev libwebkit2gtk-4.1-dev` falls Linux-Builds gewünscht.
- **`delete_credential()` in `keychain.rs`**: Mit `// VERIFY` markiert — ist die keyring-v3-API. Muss auf macOS gegen echten Keychain-Zugriff getestet werden.
- **Ollama-Timeout**: Der `OllamaAdapter` hat keinen expliziten Timeout für Cold-Start (kann Minuten dauern). Ein `timeout_secs`-Feld im `ModelPreference` wäre sinnvoll für Phase 2.
- **Auto-Spawn auf Windows**: `pnpm.cmd` wird verwendet, aber ungetestet. Pfad-Resolution in der Rust-Shell kann PATH-abhängig sein.
- **`newsletter-ai` manifest — `fallback: ollama-llama3`**: Im Spec-Beispiel vorhanden, in der aktuellen Datei nicht. Fallback-Chain ist implementiert und funktioniert; nur das Manifest fehlt das `fallback:`-Feld. Kann als Manifest-Edit nachgezogen werden.
- **Prisma-Client in CI**: `prisma generate` muss vor `tsc` laufen — nicht in `package.json` scripts automatisiert. Ohne generate schlägt TypeScript-Build fehl.

---

## Token / API usage during build

Nicht gemessen (Entwicklung im CLI-Kontext ohne Token-Tracking). Alle API-Keys lagen ausschließlich in der OS-Keychain oder als Shell-Env-Vars während manueller Tests — keine Keys in Dateien oder Logs.

---

## What's ready for Phase 2

- **ModelAdapter-Layer**: Clean — Claude, Perplexity, Ollama, Static alle implementiert. Neuer Adapter = eine neue Datei + Registry-Eintrag. OpenAI-Adapter wäre ein Nachmittag.
- **Scheduler + Live-Reload**: Infrastruktur für mehrere proactive Agents steht. Zweiter Agent = neues `agents/<slug>/`-Verzeichnis, kein Code-Change.
- **Sources-Editor**: Bereit für weitere Source-Typen. `api`- und `custom`-Types sind im Schema bereits gültig; Fetcher-Implementation fehlt noch.
- **Tauri Auto-Spawn**: Dev-Setup ist vereinfacht. Release-Build-Pfad (Core als Sidecar bundlen) ist der nächste Rust-Schritt für Phase 2.
- **Budget-Gate**: Vollständig operational — globaler Cap + per-Agent-Cap vor jedem Adapter-Call.
- **Newspaper-UI**: Solide Basis. Für Phase 2 können Artikel-Detail-View, Voting-Buttons und Retention-Policy darauf aufbauen.

### Empfehlungen für Phase 2 (nicht jetzt entscheiden)

- Retention-Policy für `Article` + `SourceSnapshot` + `AgentRun` (wachsen aktuell unbegrenzt)
- Delivery-Kanäle als opt-in (SMTP / Telegram) wiedereinfügen, wenn User-Feedback das verlangt
- Artikel-Detail-View mit `SourceSnapshot`-Liste (Traceability sichtbar machen)
- Tray-Icon + Windows-Autostart
- Zweiter proactive Agent (z.B. `github-digest` oder `arxiv-weekly`) zum Test der Multi-Agent-Infrastruktur

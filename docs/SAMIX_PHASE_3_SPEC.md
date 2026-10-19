# Samix — Phase 3 Spec: Reaktive Agenten, erster Agent „Frag deine Zeitung“

**Stand:** 2026-10-19 · **Bezug:** `SAMIX_ABOUT.md` (Werte), `SAMIX_ROADMAP.md` (Phase 3), ADR 002/007
**Status:** Entwurf, Zuschnitt vom Auftraggeber bestätigt (siehe §1)

> Kennzeichnung wie im Rest des Projekts: Aussagen, die ich nicht prüfen konnte, stehen als **[Unverified]** / **[Inference]** da.

---

## 1. Entscheidungen

| Frage | Entscheidung |
|---|---|
| Erster reaktiver Agent | **„Frag deine Zeitung“**: beantwortet Fragen zu allem, was Samix gesammelt hat (Artikel, Zusammenfassungen, gecachte Volltexte), mit Quellenangabe je Aussage |
| Bedienung | **Eigener Bereich „Fragen“** neben der Zeitung. Die Zeitung bleibt die Startseite; kein Chat als Hauptansicht (`SAMIX_ABOUT.md`: „Kein Chatbot“) |
| Zurückgestellt | **3b Projekt-Assistent** (liest einen lokalen Ordner, nur lesen) und **3c Coding-Agent** (ändert Dateien / führt Befehle aus). Voraussetzungen siehe §9 |

Warum zuerst dieser Agent: Er braucht **keinen Zugriff auf Dateien oder Shell**, nutzt nur Daten, die Samix ohnehin lokal hält, passt zum Zweck („Wissen sammeln und zugänglich machen“) und liefert trotzdem die ganze neue Infrastruktur, die 3b/3c später brauchen: Tool-Aufrufe im Adapter, eine Gesprächsschleife mit Budget-Gates, Konversationen, Quellenpflicht.

## 2. Ziel und Nicht-Ziele

**Ziel:** Der Nutzer stellt eine Frage in natürlicher Sprache („Was gab es diese Woche zu offenen Sprachmodellen?“, „Was stand zu Thema X im Chip-Ressort?“). Samix sucht in den eigenen Artikeln, liest bei Bedarf Volltexte und antwortet **nur auf Grundlage des Gefundenen**, mit nummerierten Quellen, die im Reader geöffnet werden können. Wenn nichts Passendes gesammelt wurde, sagt es das.

**Nicht-Ziele (Phase 3, erster Agent):**
- Kein Dateizugriff, keine Shell, keine Schreib-Tools.
- Kein freies Web-Browsen: Das Modell kann **keine beliebige URL** abrufen (§5.3).
- Kein Streaming der Antwort (Antwort kommt am Stück; Schritte werden nachträglich gezeigt).
- Keine Antworten aus dem „Allgemeinwissen“ des Modells (§6).
- Kein Orchestrator, kein agentenübergreifendes Gedächtnis (Phase 4).
- Keine Semantik-/Vektorsuche; Suche ist Stichwort-basiert (§5.2).

## 3. Werte-Check

| Wert | Konsequenz in dieser Phase |
|---|---|
| Local-first | Fragen, Antworten, Verlauf und Tool-Daten bleiben lokal. Ans Modell gehen die Frage, die letzten Gesprächszüge und die **von den Tools gelieferten Artikelauszüge** — dieselbe Art Daten wie bei den Läufen. Das wird im UI offen gesagt |
| Model-agnostic | Tool-Aufrufe sind im `ModelAdapter`-Interface normalisiert (§4); Agenten-Code kennt keinen Anbieter. Modelle ohne Tool-Unterstützung (Ollama/Llama 3, Perplexity, static) werden **abgelehnt**, nicht still schlechter bedient |
| Source-traceable | Jede Aussage trägt eine Quellennummer; die Nummern werden gegen die in **dieser Frage** tatsächlich gelieferten Artikel geprüft (§6). Antworten ohne belegbare Quelle werden nicht als Antwort angezeigt |
| Budget-disciplined | Jeder Modellaufruf in der Schleife läuft durch dieselben Gates (pro Agent, global, pessimistische Vorab-Schätzung). Zusätzlich: höchstens 6 Modellaufrufe und 3 Volltext-Abrufe pro Frage; Kosten je Frage stehen an der Antwort |
| Architecture-first | Neuer Baustein `ConversationRunner` neben dem bestehenden `runAgent`; gemeinsame Gate-Funktionen werden herausgezogen statt kopiert |
| Transparent operations | Jede Frage ist ein `AgentRun` (Tokens, Kosten, Fehler); die Tool-Schritte werden gespeichert und sind unter „Wie kam das zustande?“ sichtbar |
| Skills are data | Der Agent ist `agents/frag-die-zeitung/{SKILL.md,manifest.yaml}`; welche Tools er nutzen darf, steht im Manifest (`tools:`). Die Tool-**Implementierungen** sind Code, die **Auswahl** ist Daten |
| Honest AI | „Dazu habe ich nichts gesammelt“ ist eine gültige, erwünschte Antwort; Antworten tragen das Modell, die Kosten und die Schritte |

## 4. Adapter: Tool-Aufrufe normalisieren

Heute: `NormalizedRequest.tools?: unknown[]`, `NormalizedResponse.toolCalls: unknown[]`, Nachrichtenrollen nur `system|user|assistant`.

```ts
interface ToolSpec { name: string; description: string; inputSchema: JsonSchema }
interface ToolCall { id: string; name: string; input: unknown }

NormalizedMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string; isError?: boolean }

NormalizedRequest.tools?: ToolSpec[]
NormalizedResponse.toolCalls: ToolCall[]; stopReason bleibt der Anbieterwert
```

- **ClaudeAdapter:** `tools` → `{name, description, input_schema}`; Assistenten-Nachricht mit `tool_use`-Blöcken; aufeinanderfolgende `tool`-Nachrichten werden zu **einer** `user`-Nachricht mit `tool_result`-Blöcken zusammengefasst (Anbieter-Regel). Die Formen sind gegen die Typen des installierten SDK 0.32.1 geprüft; gegen die echte API **[Unverified]** (kein Netz, kein Schlüssel).
- **DeepSeekAdapter** (OpenAI-kompatibel): `tools: [{type:'function', function:{name, description, parameters}}]`, Antwort `message.tool_calls[]` mit `arguments` als JSON-String, `tool`-Nachrichten mit `tool_call_id`. **[Unverified]**: Ob und wie zuverlässig `deepseek-chat` Funktionsaufrufe unterstützt, konnte ich nicht prüfen (Doku nicht erreichbar). Der Adapter setzt `supportsTools = true` erst, wenn die Anfrage-/Antwortform getestet ist (mit Fake-HTTP); echtes Verhalten ist offen.
- **Ollama, Perplexity, static:** `supportsTools = false`. Der `ConversationRunner` bricht mit `model_without_tools` ab, bevor etwas bezahlt wird. Auch ein deklarierter **Fallback** muss Tools können, sonst zählt er nicht.
- Malformed `arguments` (kein gültiges JSON) werden als Tool-Fehler an das Modell zurückgegeben, nicht als Absturz.

## 5. Tools (nur lesen, nur lokale Daten)

Alle Tools laufen im Core, prüfen ihre Eingaben mit Zod und begrenzen ihre Ausgabe (Zeichenlimit je Ergebnis, damit kein Treffer das Budget sprengt).

### 5.1 `list_ressorts()`
Titel und Kennung der Ressorts (proaktive Agenten) mit Anzahl Artikel. Hilft dem Modell, `ressort` richtig zu setzen.

### 5.2 `search_articles({ query, ressort?, since?, limit? })`
Stichwort-Suche über Titel, Zusammenfassung, Thema und (wenn gecacht) Volltext der **eigenen** Artikel. Ganze Wörter, ohne Groß-/Kleinschreibung, Unicode-bewusst (dieselbe Logik wie der Webseiten-Filter); Treffer-Ranking nach Trefferzahl in Titel > Zusammenfassung > Volltext, dann Aktualität. Liefert je Treffer: `articleId`, Titel, Quelle, Datum, Ressort, **Kurzfassung** (keine Volltexte). `limit` ≤ 10. Die Menge durchsuchter Artikel ist begrenzt (neueste 2000). **[Inference]** Für eine persönliche Sammlung dieser Größe reicht das; Volltextindex (SQLite FTS5) und Vektorsuche sind Folgeschritte, falls die Treffergüte in der Praxis nicht genügt.

### 5.3 `get_article({ articleId, maxChars? })`
Titel, Quelle, Datum, Zusammenfassung, „Warum wichtig“ und — falls bereits gecacht — den Anfang des Volltextes (≤ `maxChars`, Standard 4000). **Holt nichts aus dem Netz.**

### 5.4 `fetch_full_text({ articleId })`
Lädt den Volltext eines **bereits gesammelten** Artikels über die vorhandene Extraktion (`ensureArticleContent`, also `safeFetch`, SSRF-Schutz, Größenlimit). Das Modell übergibt eine `articleId`, **nie eine URL**; so kann es das Netz nicht zum Abfragen beliebiger Adressen benutzen. Höchstens 3 Abrufe pro Frage.

## 6. Gesprächsschleife und Quellenpflicht

`ConversationRunner` (neu, `runner/converse.ts`), pro Frage:

1. **Vorab-Gates** wie bei `runAgent`: Agent aktiv, Tageslimit des Agenten, globales Limit; Modell muss `supportsTools` haben.
2. Nachrichten: System-Prompt (aus `SKILL.md`) + die letzten 6 Gesprächszüge (nur Frage/Antwort-Text, keine alten Tool-Daten) + neue Frage.
3. **Schleife** (≤ 6 Modellaufrufe): Modell antwortet mit Tool-Aufrufen → Core führt sie aus → Ergebnisse als `tool`-Nachrichten zurück. Vor **jedem** Aufruf greifen die Budget-Gates erneut; bei Überschreitung endet die Frage mit `budget_exceeded` (bis dahin angefallene Kosten werden gebucht).
4. **Erst suchen:** Antwortet das Modell im ersten Schritt ohne Tool-Aufruf, wird es einmal daran erinnert. Tut es das nicht, endet die Frage als `partial: ungrounded` (**keine** Antwort aus Allgemeinwissen wird angezeigt).
5. **Endformat:** Die Schlussantwort ist JSON `{ "answer": "Text mit [1], [2]", "sources": ["articleId", …] }` (Fences werden wie bisher entpackt; ungültiges JSON erhält **eine** Korrekturaufforderung).
6. **Zitierprüfung im Code** (nicht im Prompt): Jede `articleId` in `sources` muss in den Tool-Ergebnissen **dieser Frage** vorgekommen sein; erfundene werden verworfen. Die Nummern `[n]` im Text müssen auf verbleibende Quellen zeigen. Bleibt keine belegbare Quelle, und die Antwort ist nicht ausdrücklich „nichts gefunden“ (`"sources": []` mit `"answer"` die das sagt, siehe Prompt), dann `partial: no_valid_citations` — der Text wird nicht als Antwort ausgegeben.
7. **Speichern:** `AgentRun` (Kosten, Tokens, Modell, Status, `output` = Schrittprotokoll), `ConversationMessage` für Frage und Antwort.

Fehlerfälle als Status, nie als Absturz: `model_without_tools`, `budget_exceeded`, `global_budget_exceeded`, `agent_disabled`, `already_running` (eine Frage je Agent gleichzeitig, wie bei Läufen), `partial` (ungrounded / no_valid_citations / invalid_output), `failed` (Anbieterfehler, mit Fallback-Versuch nur auf einem tool-fähigen Modell).

## 7. Sicherheit

- **Nur lesen.** Keines der Tools hat Nebenwirkungen außer dem Cachen eines Volltexts (gleiches Verhalten wie das Öffnen des Readers).
- **Prompt-Injection** [Inference: realistisch]: Artikeltexte sind Fremdinhalt und können Anweisungen enthalten. Gegenmaßnahmen: Tool-Ergebnisse werden klar als Daten abgegrenzt, der System-Prompt sagt, dass Inhalte darin nie Anweisungen sind; es gibt kein Tool, das etwas verschickt, schreibt oder beliebige Adressen lädt; die Quellenprüfung (§6) verhindert, dass eingeschleuste „Fakten“ ohne Beleg erscheinen. Ein Restrisiko bleibt: das Modell kann durch Fremdtext eine irreführende, aber **belegte** Antwort geben.
- **Keine URL-Parameter** an Tools (§5.4).
- **Eingabegrenzen:** Fragelänge ≤ 2000 Zeichen, Tool-Argumente per Zod, Ausgaben begrenzt, höchstens 6 Modellaufrufe / 3 Abrufe pro Frage.
- **Datenschutz (sichtbar im UI):** „Frage und gefundene Artikelauszüge werden an <Modell> gesendet.“

## 8. Datenmodell, API, Oberfläche

**Prisma (neue Migration):**
```
Conversation        id, agentId → Agent, title, createdAt, updatedAt
ConversationMessage id, conversationId → Conversation (Cascade), role 'user'|'assistant',
                    content, citations JSON?, agentRunId → AgentRun?, createdAt
```
`AgentRun.output` bekommt für Fragen das Schrittprotokoll (`steps: [{tool, input, resultCount, ms}]`). Konversationen dürfen **gelöscht** werden (reine Nutzerdaten, keine Quellen-Historie wie bei Agenten).

**API (alles mit Token):**
- `POST /ask` `{ question, conversationId?, agent? }` → `{ conversationId, status, answer?, citations[], trace[], costUsd, model, runId, error? }` (`citations`: Nummer, `articleId`, Titel, Quelle, Datum, URL)
- `GET /conversations?agent=`, `GET /conversations/:id`, `DELETE /conversations/:id`
- Reaktive Agenten erscheinen nicht in der Ressort-Verwaltung (wie `hello-world`).

**UI „Fragen“:** Eingabefeld, Verlauf der Gespräche (Seitenleiste), Antwort mit nummerierten Quellen, die den **Reader** öffnen und danach zurückkehren; einklappbar „Wie kam das zustande?“ (Tool-Schritte, Modell, Kosten); Hinweis auf den Datenfluss zum Anbieter; verständliche Texte für jeden Fehlerstatus.

## 9. Folgeschritte (nicht in diesem Umfang)

- **3b Projekt-Assistent (nur lesen):** erlaubte Ordner pro Projekt ausdrücklich freigeben (Datenfluss zum Anbieter bestätigen), Pfad-Allowlist mit Schutz gegen `..`/Symlinks, Ausschlüsse (`.git`, `node_modules`, `.env`, Schlüsseldateien), Größenlimits, Zitat mit Datei und Zeile. Baut auf denselben Adapter-/Schleifen-Bausteinen auf.
- **3c Coding-Agent:** zusätzlich Schreib-/Ausführ-Tools nur mit **Freigabe je Aktion** im UI (Diff-Ansicht, Befehl anzeigen), Sandbox/Arbeitskopie, Wiederherstellung. Eigenes Spec, weil das Risikoprofil ein anderes ist.
- Streaming der Antwort; Volltext-/Vektorsuche; Fragen aus dem Tray.

## 10. Akzeptanzkriterien und wie sie geprüft werden

| # | Kriterium | Prüfung |
|---|---|---|
| 1 | Adapter-Nachrichten/Tools werden für Claude und DeepSeek korrekt in die Anbieterform übersetzt und zurück | Tests gegen Fake-HTTP bzw. Fake-Client; **nicht** gegen die echte API |
| 2 | Modell ohne Tool-Unterstützung wird abgelehnt, bevor ein Aufruf stattfindet; Fallback ohne Tools zählt nicht | Test |
| 3 | Tools: Suche (Ganzwort, Unicode, Ressort-/Datumsfilter, Limit), `get_article` ohne Netz, `fetch_full_text` nur per `articleId`, Limit 3 | Tests |
| 4 | Schleife: Tool-Aufrufe werden ausgeführt und zurückgegeben; ≤ 6 Aufrufe; Budget-Gate vor **jedem** Aufruf; Kosten aller Aufrufe gebucht | Tests mit skriptgesteuertem Fake-Modell + Mutationstest |
| 5 | Erfundene `articleId` in der Antwort wird verworfen; ohne belegbare Quelle keine Antwort | Tests + Mutationstest |
| 6 | Antwort ohne vorherige Suche wird nicht als Antwort ausgegeben | Test |
| 7 | Gesprächsverlauf: Folgefrage sieht die letzten Züge; Löschen entfernt alles | Tests |
| 8 | UI „Fragen“: Frage → Antwort mit Quellen → Reader → zurück; Fehlertexte | im Browser mit Fake-Modell angesehen |
| 9 | **Antwortqualität und Tool-Nutzung mit einem echten Modell** | ❌ **nicht prüfbar** in der Entwicklungsumgebung (kein Schlüssel, kein Netz); erster echter Test auf dem Rechner des Nutzers |
| 10 | Prompt-Injection-Verhalten realer Modelle | ❌ nicht prüfbar; nur die Code-Schranken (§7) sind getestet |

## 11. Umsetzungsreihenfolge

1. **A** Adapter-Tool-Calling (Typen, Claude, DeepSeek) + Tests
2. **B** Tools + Tests
3. **C** `ConversationRunner`, Datenmodell, API + Tests
4. **D** UI „Fragen“, im Browser geprüft
5. **E** Doku, Status gegen §10

# Samix — Phase 4 Spec: Orchestrator und sichtbares Gedächtnis

**Stand:** 2026-10-19 · **Bezug:** `SAMIX_ABOUT.md` (Werte), `SAMIX_ROADMAP.md` (Phase 4), `SAMIX_PHASE_3_SPEC.md`
**Status:** umgesetzt (Abnahme in `SAMIX_ROADMAP.md`, „Status 4“); Zuschnitt vom Auftraggeber bestätigt (§1)

> Kennzeichnung wie im Rest des Projekts: Aussagen, die ich nicht prüfen konnte, stehen als **[Unverified]** / **[Inference]** da.

## 1. Entscheidungen

| Frage | Entscheidung |
|---|---|
| Orchestrator | **Ein Eingang, leitet weiter.** „Fragen“ spricht künftig mit dem Orchestrator; der wählt genau **eine** Aktion: an einen Agenten delegieren (heute „Frag deine Zeitung“), die Notizen zeigen oder ein Ressort-Update **vorschlagen** |
| Gedächtnis | **Sichtbare Notizen des Nutzers.** Lokale, einsehbare und löschbare Liste; nur der Nutzer schreibt sie. Agenten dürfen sie per Tool lesen, wenn ihr Manifest das erlaubt |
| Zurückgestellt | Mehrstufige Planung mit Teilaufgaben; automatisch gelernte Gedächtniseinträge; Notizen als Kontext der Ressort-Läufe (`personalize`); Delegation an 3b/3c-Agenten (gibt es noch nicht) |

[Inference] Mit nur einem Antwort-Agenten bringt der Router heute wenig Mehrwert über „Fragen“ hinaus; Phase 4 baut den Mechanismus, den 3b/3c später brauchen. Das ist ein bewusst in Kauf genommener Vorlauf.

## 2. Ziel und Nicht-Ziele

**Ziel:** Der Nutzer tippt in „Fragen“ („Was gab es zu Chips?“, „Was hast du dir über mich gemerkt?“, „Aktualisiere das Chip-Ressort“). Der Orchestrator entscheidet mit **einem** Modellaufruf, was zu tun ist; das Ergebnis kommt aus dem gewählten Baustein, nicht aus freiem Modelltext.

**Nicht-Ziele:**
- Der Orchestrator schreibt **keinen eigenen Antworttext**. Angezeigt wird nur, was der gewählte Baustein liefert (die geprüfte Antwort des Agenten, die Notizliste, ein Vorschlag).
- Keine Aktion mit Kosten oder Nebenwirkung **auf Zuruf des Modells**: ein Ressort-Lauf ist nur ein Vorschlag mit Knopf; ausgeführt wird er erst nach Klick des Nutzers.
- Kein Schreiben ins Gedächtnis durch das Modell. Keine Ketten (Delegat ruft Delegat).
- Keine Planung über mehrere Schritte.

## 3. Werte-Check

| Wert | Konsequenz |
|---|---|
| Local-first | Notizen liegen nur lokal. Ans Modell gehen sie **nur**, wenn ein Agent sie per Tool liest (Manifest-Opt-in); der Schritt steht im Ablauf, die UI sagt es |
| Model-agnostic | Routing ist normales Tool-Calling über den Adapter (wie Phase 3); ein Modell ohne Tools wird abgelehnt |
| Source-traceable | Antworten kommen unverändert vom Delegaten samt seiner geprüften Quellen; der Router kann keine Quellen hinzufügen |
| Budget-disciplined | Der Routing-Aufruf läuft durch Agent- und globales Gate; der Delegat hat sein **eigenes** Budget und seine eigenen Gates. Genau **ein** Routing-Aufruf je Frage, kein zweiter Modellaufruf zum „Zusammenfassen“ |
| Architecture-first | Router ist ein weiterer Runner neben `runAgent`/`askAgent`; `askAgent` bekommt `history`/`ephemeral` statt kopiert zu werden |
| Transparent operations | Jede Frage = `AgentRun` des Orchestrators (Kosten, Wahl, Argumente) + `AgentRun` des Delegaten; die UI zeigt „Weitergeleitet an …“ |
| Skills are data | `agents/orchestrator/`: welche Aktionen (`routes:`) und welche Delegaten (`delegates:`) erlaubt sind, steht im Manifest |
| Honest AI | Versteht der Router die Frage nicht, sagt ein **fester** Text, was möglich ist; kein erfundener Ersatz |

## 4. Gedächtnis: Notizen

`MemoryNote { id, text (1–500 Zeichen), createdAt }`, höchstens 100.
API: `GET /notes`, `POST /notes {text}`, `DELETE /notes/:id`. UI: Bereich „Notizen“ in „Fragen“ (hinzufügen, löschen, Hinweis zum Datenfluss).
Tool `read_notes` (Registry, nur lesen, keine Argumente) → alle Notizen, begrenzt. Es liefert **keine** `articleId`s: Notizen sind **nicht zitierbar** und stützen keine Tatsachenbehauptung über Artikel. Der Prompt von „Frag deine Zeitung“ sagt: Notizen nur nutzen, um die Suche an die Interessen anzupassen.

## 5. Orchestrator

`agents/orchestrator/{SKILL.md,manifest.yaml}` (reaktiv). Manifest: `routes: [delegate, show_notes, propose_refresh]`, `delegates: [frag-die-zeitung]`.

`runner/orchestrate.ts` (`routeQuestion`), pro Frage:
1. **Vorab-Gates** wie `askAgent` (Agent aktiv, Tool-fähiges Modell, Tageslimit, globales Limit, eine Frage je Agent gleichzeitig, Fragelänge ≤ 2000).
2. **Ein** Modellaufruf mit System-Prompt, den letzten 6 Zügen und der Frage; angeboten werden die Aktionen als Tools:
   - `delegate { agent (Enum aus `delegates:`), question }`
   - `show_notes {}`
   - `propose_refresh { ressort }`
3. Das Modell muss **genau ein** Tool wählen. Antwortet es mit Text, kommt **eine** Erinnerung; danach `partial: no_route` mit festem Text. Weitere Tool-Aufrufe im selben Schritt werden ignoriert (und im Ablauf vermerkt).
4. Ausführung durch den Core:
   - `delegate`: `askAgent` des Delegaten (`ephemeral`: kein eigenes Gespräch, aber eigener `AgentRun`, eigene Gates und Kosten), mit den Gesprächszügen als `history` und der **vom Modell formulierten** Frage. Ergebnis (Status, Antwort, Zitate, Ablauf) wird übernommen. Delegat ≠ Eintrag in `delegates:` → Fehler `delegate_not_allowed`.
   - `show_notes`: Core formatiert die Notizliste (fester Text, kein Modell).
   - `propose_refresh`: Core prüft, dass das Ressort existiert und aktiv ist; liefert `proposals: [{kind:'refresh', ressort, title}]`. **Nichts wird gestartet.**
5. Speichern: `AgentRun` des Orchestrators (Kosten nur des Routing-Aufrufs, Ablauf inkl. `delegateRunId`); Gesprächsnachrichten im Gespräch des **Orchestrators**; Zitate/Vorschläge an der Antwortnachricht. `costUsd` der Antwort = Routing + Delegat.

Fehler als Status: `model_without_tools`, `budget_exceeded`/`global_budget_exceeded`, `agent_disabled`, `already_running`, `no_route`, `invalid_routes` (Manifest bietet keine nutzbare Aktion an), `delegate_unavailable` (Delegat fehlt), `unknown_ressort` (fehlt oder aus), plus alle Status des Delegaten unverändert. Wählt das Modell einen Agenten, der nicht in `delegates:` steht, bekommt es das als Tool-Fehler zurück und hat einen weiteren Versuch (insgesamt höchstens 2 Routing-Aufrufe); danach `no_route`.

## 6. Sicherheit

- **Prompt-Injection:** Der Router sieht nur Frage und Verlauf des Nutzers, **keine** Artikeltexte. Der Delegat behält die Schranken aus Phase 3. Eine Nebenwirkung (Ressort-Lauf) gibt es nur nach Klick; das Modell kann nichts löschen, schreiben oder verschicken.
- Notizen sind Nutzerdaten, aber an einen Anbieter gesendet, sobald `read_notes` läuft; der Nutzer kann sie jederzeit löschen. [Inference] Ein Modell könnte Notizinhalte in eine Antwort übernehmen; sie bleiben ohne Quelle und werden nicht als belegt gezeigt, weil Zitate nur aus Artikeln kommen.
- Der Delegat wird **nie** aus Modellausgabe frei gewählt, sondern nur aus der Manifest-Liste.

## 7. API, Oberfläche

- `POST /ask` Standard-Agent wird `orchestrator` (Fallback `frag-die-zeitung`, wenn dieser fehlt/aus ist); Antwort zusätzlich `route: {kind, agent?}`, `proposals[]`.
- `GET /conversations/:id` liefert je Antwort `route`, `proposals`.
- Neue Spalte `ConversationMessage.extra` (JSON: route, proposals).
- UI: Zeile „Weitergeleitet an …“, Vorschlagsknopf („Chip jetzt aktualisieren“, ruft `POST /agents/:slug/run`, zeigt Ergebnis), Bereich „Notizen“, Datenfluss-Hinweis nennt Router- und Delegat-Modell.

## 8. Akzeptanzkriterien

| # | Kriterium | Prüfung |
|---|---|---|
| 1 | Notizen: anlegen/lesen/löschen, Längen- und Mengenlimit; `read_notes` liefert sie ohne `articleId`s | Tests |
| 2 | Router wählt genau ein Tool; Text ohne Tool → eine Erinnerung, dann `no_route` mit festem Text | Tests mit skriptgesteuertem Modell |
| 3 | Ein Routing-Aufruf; kein zweiter Modellaufruf des Orchestrators; Gate davor | Tests + Mutationstest |
| 4 | `delegate`: nur Agenten aus `delegates:`; Delegat läuft mit eigenem Run, eigenen Gates und Kosten; Antwort/Zitate unverändert übernommen; Verlauf wird weitergereicht | Tests + Mutationstest |
| 5 | `propose_refresh` startet **nichts**; unbekanntes/ausgeschaltetes Ressort → Fehler | Test (Zähler der Läufe) |
| 6 | `show_notes` ohne Modelltext | Test |
| 7 | Modell ohne Tools abgelehnt; Delegat ohne Tools ergibt dessen Fehlerstatus | Tests |
| 8 | UI: Frage → „Weitergeleitet an“ → Antwort mit Quellen; Vorschlag → Klick → Lauf; Notizen verwalten | im Browser mit Fake-Modell |
| 9 | **Routing-Qualität und Tool-Wahl mit echtem Modell** | ❌ nicht prüfbar (kein Schlüssel, kein Netz) |
| 10 | Prompt-Injection-Verhalten realer Modelle | ❌ nicht prüfbar |

## 9. Umsetzungsreihenfolge

A Notizen (Modell, API, `read_notes`) · B `askAgent`: `history`/`ephemeral` · C Orchestrator-Runner, Agent, API · D UI · E Doku

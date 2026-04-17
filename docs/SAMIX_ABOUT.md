# Samix — About, Identity & Values

**Type:** Reference document
**Audience:** Tom (primary), future contributors, AI assistants working on the project
**Purpose:** Explain where the name comes from, what the project stands for, and which values guide every decision
**Last updated:** 2026-04-17

> Dieses Dokument ist der Anker des Projekts. Wenn in einer späteren Entscheidung unklar ist "was würde Samix tun?", lies hier nach. Technische Specs veralten — Werte veralten nicht.

---

## Part 1 — The Name

### Why "Samix"?

Der Name verbindet drei Dinge: persönliche Wurzeln, konzeptionelle Klarheit und technische Ästhetik.

**Die Wurzel:** *Sami*, als Hommage an **Sami Frashëri** — einen albanischen Universalgelehrten des späten 19. Jahrhunderts, der in seinem Leben eine der größten enzyklopädischen Leistungen seiner Zeit vollbrachte. Er sammelte verstreutes Wissen aus vielen Sprachen und Feldern und machte es in strukturierter Form zugänglich. Genau das ist, was Samix als Software tut: verstreute Informationen aus vielen Quellen sammeln, strukturieren und zugänglich machen.

**Die Endung:** *-x* gibt dem weichen "Sami" eine technische Kante. In der Software-Welt signalisiert das Suffix "-x" Werkzeug, System, Protokoll (Linux, Unix, Netflix, Suffix). Das Wort klingt dadurch wie ein Produkt, nicht wie ein Vorname.

**Die Aussprache:** *"sa-mix"* — wie "sa" + "mix". Eindeutig, international problemlos.

### Who was Sami Frashëri?

[Unverified — überprüfen vor Veröffentlichung] Sami Frashëri (1850–1904) war einer der bedeutendsten albanischen Intellektuellen der Rilindja Kombëtare (albanische nationale Wiedergeburt). Er war Schriftsteller, Philosoph, Lexikograf und Enzyklopädist und arbeitete hauptsächlich im Osmanischen Reich — unter dem Namen *Şemseddin Sami*.

Seine bedeutendsten Werke, so weit mir bekannt:

- **Kamus-ül Âlâm** — eine sechsbändige Enzyklopädie, die Personen, Orte und Ereignisse aus vielen Kulturen und Epochen versammelte. Eine der ersten großen Enzyklopädien in osmanisch-türkischer Sprache.
- **Kamus-ı Türkî** — ein umfassendes Wörterbuch der türkischen Sprache, das als Grundlage für die Standardisierung des modernen Türkischen diente.
- **Shqipëria — ç'ka qenë, ç'është e ç'do të bëhet?** ("Albanien — was es war, was es ist und was es werden wird") — eine politisch-philosophische Schrift über die albanische Nation.

Er war Teil eines außergewöhnlichen Brüder-Trios — zusammen mit dem Dichter-Philosophen **Naim Frashëri** und dem politischen Aktivisten **Abdyl Frashëri**.

### Why he fits Samix conceptually

Sami Frashëri war im Kern **ein menschlicher Aggregator von Wissen**. In einer Zeit ohne Internet, ohne Datenbanken, ohne Suchmaschinen hat er manuell getan, was Samix als Software automatisieren soll:

1. **Aus vielen Quellen sammeln** — Sami las in mehreren Sprachen (Osmanisch, Türkisch, Arabisch, Persisch, Griechisch, Albanisch, Französisch, Italienisch). Samix liest RSS, Perplexity-Ergebnisse, APIs.
2. **Strukturieren und indizieren** — Sami ordnete seine Einträge lexikografisch. Samix strukturiert Agenten-Output in Artikel, Citations, Topics.
3. **Zugänglich machen** — Sami zielte auf ein breites Lesepublikum. Samix zeigt dir täglich, was du wissen musst, in verdaulicher Form.

Der Name ist also keine dekorative Hommage. Die Metapher ist strukturell: *Samix ist, was Sami Frashëri getan hätte, wenn er Software gebaut hätte.*

### Personal connection

Für den Autor (Tom Karaqi, albanische Wurzeln): Der Name verwurzelt das Projekt in der eigenen kulturellen Geschichte, ohne es eng oder exklusiv zu machen. Außenstehende müssen die Herkunft nicht kennen, um den Namen zu mögen — für Insider ist es eine Ebene mehr.

### What Samix is *not* named after

Zur Klarstellung, falls jemand fragt:

- **Nicht** die Sámi (indigenes Volk Skandinaviens) — rein lautliche Überschneidung, keine thematische Verbindung
- **Nicht** der arabische Vorname *Sami* — das ist ein anderer Bedeutungsstrang
- **Nicht** eine Abkürzung (kein Akronym, keine gezwungene Rückdeutung wie "Self-Aware Multi-Intelligent X")

Samix ist ein Eigenname mit Geschichte, nicht ein Akronym oder Wortwitz.

---

## Part 2 — Project Identity

### What Samix is

Samix ist eine **lokale Desktop-Anwendung**, die ein hierarchisches Multi-Agenten-System beherbergt. Zu Phase 1 gehören:

- **Proaktive Agenten**, die zeitgesteuert laufen und ausgewählte Themen für den User beobachten, kuratieren und in einer täglichen Darstellung präsentieren
- **Reaktive Agenten** (ab Phase 3), die auf Anfrage reagieren — etwa ein Coding-Assistent mit projekt-spezifischem Kontext

Alles wird zusammengehalten von einer modellagnostischen Abstraktionsschicht, die es erlaubt, Claude, OpenAI, Perplexity oder lokale Ollama-Modelle je nach Aufgabe zu nutzen.

### What Samix is *not*

Diese Abgrenzungen sind wichtig, weil sie spätere Feature-Kriege vermeiden:

- **Kein SaaS.** Samix läuft lokal. Es gibt keine geteilte Cloud-Instanz, an der User sich anmelden.
- **Kein Chatbot.** Obwohl Samix mit LLMs arbeitet, ist das Primär-Interface nicht ein Chat-Fenster — es ist ein kuratierter Informationsraum mit täglichem Output.
- **Kein AI-Wrapper.** Samix ist ein System *mit* AI als Werkzeug, nicht *über* AI als Produkt. Die AI-Funktionalität ist im Dienst der Aggregations-Aufgabe.
- **Kein Framework.** Samix ist kein LangChain-Konkurrent, kein generisches Agenten-Framework für andere Entwickler. Es ist eine spezifische Anwendung, die zufällig eine interne Agenten-Abstraktion hat.
- **Kein Newsletter-Service.** Die Newsletter-Agenten sind *ein* Anwendungsfall, nicht das Produkt selbst. Samix ist der Rahmen, in dem verschiedene Wissens-Arbeiter-Agenten koexistieren.

### Who Samix is for (today)

**Phase 0–4: Nur für Tom.** Samix ist ein Personal Agent System. Alle Designentscheidungen bevorzugen persönliche Nutzung vor Produkt-Skalierbarkeit. Das ist Absicht — Tools, die für einen einzigen Menschen perfekt funktionieren, sind oft später für viele wertvoll. Umgekehrt selten.

**Phase 5+: Möglicherweise für andere.** Wenn Samix in der persönlichen Nutzung reift, ist eine öffentliche Veröffentlichung denkbar — aber als **installierbare Desktop-App pro Nutzer**, nicht als SaaS. Jeder Nutzer bekommt seine eigene lokale Instanz mit seiner eigenen Datenhoheit.

---

## Part 3 — Values & Principles

Diese acht Werte sind die Leitplanken für jede zukünftige Entscheidung. Wenn ein neues Feature, eine neue Library oder eine neue Architektur-Idee einem dieser Werte widerspricht, muss der Konflikt offen diskutiert werden — nicht still übergangen.

### 1. Local-first

**Prinzip:** Samix-Daten gehören dem Nutzer und leben auf seinem Gerät. Es gibt keine Cloud-Datenbank im Kernpfad.

**Warum:** Weil "local-first" nicht nur Privatsphäre bedeutet, sondern auch *Kontrolle*, *Unabhängigkeit von Anbietern*, *Offline-Verfügbarkeit* und *geringere wiederkehrende Kosten*. Der Nutzer bleibt Herr seiner Informationslandschaft.

**Ausnahme:** LLM-API-Calls gehen zwingend an externe Anbieter (Claude, OpenAI, Perplexity). Das ist akzeptiert, aber explizit markiert als die einzige nicht-lokale Komponente. Lokale Modelle (Ollama) werden als Alternative unterstützt.

**Konsequenz für Entscheidungen:** Jedes Feature, das Cloud-Speicherung erfordert, muss sich rechtfertigen. Defaultantwort ist "nein".

### 2. Model-agnostic

**Prinzip:** Kein Agent ist an einen einzigen LLM-Anbieter gebunden. Jeder Skill deklariert Präferenz und Fallback. Wechsel zwischen Anbietern geschieht per Config, nicht per Rewrite.

**Warum:** LLM-Anbieter kommen, gehen, werden teurer, ändern ihre Policies. Ein System, das auf einen einzigen Anbieter angewiesen ist, ist zerbrechlich. Vendor-Lock-in ist ein Anti-Feature.

**Konsequenz:** Der `ModelAdapter`-Abstraktionslayer darf nicht "leaken". Agent-Code ruft niemals direkt die Anthropic-API oder OpenAI-API auf — immer über den Adapter.

### 3. Source-traceable

**Prinzip:** Jede Aussage, die Samix präsentiert, hat eine Quelle mit URL und Datum. Keine unbelegten Behauptungen. Keine "laut einer Studie..."-Formulierungen ohne Link.

**Warum:** LLMs halluzinieren. Quellenangaben sind die einzige Verteidigung — sowohl für Wahrheit als auch für rechtliche Korrektheit (Urheberrecht, Plagiatsvermeidung).

**Konsequenz:** Output ohne Citations wird abgelehnt. Ein Newsletter-Item ohne Quell-URL und Datum ist fehlerhaft und gelangt nicht in die DB.

### 4. Budget-disciplined

**Prinzip:** Jeder Agent hat einen harten Tages-USD-Cap. Es gibt einen globalen Tages-Cap über alle Agenten. Budget-Überschreitung stoppt Ausführung, nicht "warnt".

**Warum:** API-Kosten skalieren unsichtbar. Ein fehlerhafter Agent kann in einer Nacht hunderte Euro verbrennen. Einfacher Schutz: harte Schwellen, keine weichen.

**Konsequenz:** Das `BudgetLedger`-Modell ist keine Optimierung — es ist Infrastruktur. Jeder Run *muss* durch das Ledger.

### 5. Architecture-first (over speed-to-MVP)

**Prinzip:** Wenn Architektur-Sauberkeit und Time-to-MVP kollidieren, gewinnt Architektur — aber nur in bestimmten Kategorien: Abstraktionsgrenzen, Datenmodell, Naming, Sprach-Konsistenz.

**Warum:** Ein schnell zusammengehackter Prototyp hat niedrige Grenzkosten beim Erweitern nur bis zu einem Punkt — dann blockiert jede Erweiterung Monate. Ein sauber abstrahiertes System ist in Woche 1 langsamer, aber in Monat 6 schneller. Samix soll Monate und Jahre überleben.

**Konsequenz:** Die Frage "kann ich das mit einer zweiten API-Methode lösen, die den gleichen Code dupliziert?" wird mit "nein" beantwortet. Refactor kommt jetzt, nicht später.

### 6. Transparent operations

**Prinzip:** Jeder Agent-Run landet mit Input, Output, Token-Verbrauch, Kosten und Fehler-Info in der DB. Jede HTTP-Anfrage hat eine Correlation-ID. Nichts passiert im Dunkeln.

**Warum:** Multi-Agenten-Systeme sind inhärent schwer zu debuggen. Ohne strukturierte Logs ist jedes Problem eine Stunde Detektivarbeit.

**Konsequenz:** Neuen Code ohne passendes Logging zu committen ist ein Anti-Pattern. Ein Pino-Child-Logger pro Run ist Standard.

### 7. Skills are data, not code

**Prinzip:** Einen neuen Agenten zu erstellen heißt: zwei Files schreiben (`SKILL.md` + `manifest.yaml`) und das System lädt ihn automatisch. Kein neuer Sourcecode, kein Redeployment.

**Warum:** Skill-Vermehrung soll reibungslos sein. Wenn man für jeden neuen Newsletter-Agenten Backend-Code schreiben müsste, würde das System in der Praxis zehn Agenten haben und da steckenbleiben. Mit Skills-as-Data sind es hundert.

**Konsequenz:** Die Skill-Abstraktion muss reich genug sein, dass 95 % aller Agenten deklarativ spezifizierbar sind. Nur 5 % brauchen wirklich neuen Code (Tool-Integrationen, Spezial-Logik).

### 8. Honest AI

**Prinzip:** Wenn Samix (oder ein sein System entwickelnder AI-Assistent) etwas nicht weiß, wird das markiert. Halluzination ist schlimmer als Unwissen. Unsicherheiten werden explizit als `[Inference]`, `[Unverified]`, oder `[Speculation]` gekennzeichnet.

**Warum:** Weil du (Tom) selbst diese Werte für deine Interaktion mit Claude festgelegt hast, und sie genauso für das Produkt gelten müssen. Ein System, das mit Selbstvertrauen halluziniert, ist schädlicher als eines, das ehrlich mit "ich weiß nicht" antwortet.

**Konsequenz:** Agent-Prompts enthalten explizite Anweisungen zur Unsicherheits-Markierung. Output-Validation rejected Aussagen ohne Quellenangabe. Claude-Adapter wird mit einer Post-Prozess-Regel ergänzt, die vor der Persistierung auf nicht-belegte Behauptungen prüft.

---

## Part 4 — Supporting Values (secondary)

Diese sind keine erzwungenen Prinzipien, aber starke Default-Präferenzen.

### Mobile-ready by design

Obwohl Phase 0 Desktop-only ist, soll nichts in der Architektur ausschließen, dass später ein Flutter-Mobile-Client mit demselben Core spricht. Alle UI-Core-Interaktionen gehen über HTTP; keine Business-Logik wandert in den Tauri-Rust-Shell.

### TypeScript-first

Eine Sprache für UI, Core, Skill-Config. Vermeidung des "wir haben eine Python-Backend-und-TS-Frontend-und-eine-Dart-Mobile-App"-Chaos, das Solo-Entwickler lähmt. Zweite Sprache nur bei zwingender Notwendigkeit (Rust für Tauri-Shell, weil vorgegeben).

### Extensibility over features

Wenn eine Wahl steht zwischen "ein Feature mehr" und "eine Abstraktion flexibler", gewinnt die Abstraktion. Ein Feature bleibt ein Feature. Eine Abstraktion wird zu zehn Features.

### Privacy-respecting of others

Newsletter-Agenten und andere News-Summarizer dürfen keine Volltexte Dritter speichern oder anzeigen. Nur eigene Zusammenfassungen plus Quellen-Link. Urheberrecht respektieren, nicht "riskieren".

### Personal before public

Samix ist erst für Tom. Wenn es später öffentlich wird, ist das ein neues Projekt-Stadium mit eigenen Entscheidungen. Features werden nicht für "mögliche zukünftige Nutzer" gebaut, sondern für den aktuellen einzigen Nutzer.

---

## Part 5 — Domain Decision

### Why `samix.app` instead of `samix.com`

`samix.com` ist von einer bestehenden Firma in einer nicht-Software-Branche belegt. Statt einen verfremdeten Namen zu wählen, wurde `samix.app` registriert.

**Das ist keine Notlösung, sondern die bessere Wahl:**

- `.app` ist eine Google-betriebene TLD, die automatisch HTTPS erzwingt (HSTS preloaded) — eine Sicherheitsgarantie, die `.com` nicht gibt
- `.app` signalisiert explizit Software, was `samix.com` nicht kann
- `.app` ist das Standard-TLD für moderne Tools (linear.app, raycast.app, arc.app, posthog.app)
- Für eine Desktop-App ohne SaaS-Komponente ist der Webpräsenz-Zweck hauptsächlich: Landing Page, Doku, Downloads — dafür ist `.app` ideal

**Markenrechtliche Überlegung:** [Unverified] Die bestehende `samix.com`-Firma operiert vermutlich in einer anderen Waren-/Dienstleistungsklasse. Parallele Existenz als "Samix" in der Software-Welt dürfte rechtlich unproblematisch sein — aber wenn Samix je ein ernsthaftes Produkt wird, ist ein Markenanwaltsblick in den Software-Markenklassen (9 und 42 nach Nizza-Klassifikation) empfehlenswert.

---

## Part 6 — Reference Card

Eine komprimierte Version zum Weiterreichen (z. B. an Claude Code beim Onboarding oder in Projekt-READMEs).

### Who

Samix is a local-first desktop application hosting a hierarchical multi-agent system for knowledge aggregation and work automation.

### Named after

Sami Frashëri (1850–1904), Albanian encyclopedist and polymath who aggregated scattered knowledge into structured, accessible form — the human predecessor of what Samix does as software.

### Core values (in order of primacy)

1. **Local-first** — user data lives on user's device
2. **Model-agnostic** — no vendor lock-in; adapter layer is strict
3. **Source-traceable** — every claim has a citation
4. **Budget-disciplined** — hard USD caps, enforced pre-run
5. **Architecture-first** — clean abstractions over fast hacks
6. **Transparent operations** — every run logged and queryable
7. **Skills are data** — new agents ship as `SKILL.md` + `manifest.yaml`, no code
8. **Honest AI** — uncertainty is marked, hallucinations are bugs

### Identity boundaries

- Not a SaaS
- Not a chatbot
- Not a framework
- Not a newsletter service
- Not built for others yet — built for one user first

### Stack at a glance

- **Platform:** Desktop (Windows first, Tauri v2)
- **UI:** React + Vite + TypeScript + Tailwind + shadcn/ui
- **Core:** Node.js + Fastify + Prisma + SQLite
- **Agents:** Declarative Skills (`SKILL.md` + `manifest.yaml`)
- **Scheduling:** `node-cron`
- **Models:** Claude, OpenAI, Perplexity, Ollama — via ModelAdapter abstraction
- **Domain:** `samix.app`

---

## Changelog

- **2026-04-17:** Initial version. Name, identity, values, domain documented after Phase 0 spec finalization.

---

*This document exists to keep the project honest with itself. When a decision feels ambiguous, re-read this — the answer is usually here.*

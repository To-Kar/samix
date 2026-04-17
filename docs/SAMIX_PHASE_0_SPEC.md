# Samix — Phase 0 Architecture Spec (v3, final for kickoff)

**Version:** 0.3 (Phase 0, named)
**Status:** Approved for implementation
**Last updated:** 2026-04-17
**Replaces:** JARVIS_PHASE_0_SPEC_v2.md
**Prioritization:** Architektur-Sauberkeit > Kosten-Effizienz > Time-to-MVP

---

## 0. Naming Context

**Product name:** Samix
**Repo name:** `samix`
**Domain:** `samix.app` (reserviert, keine Pflicht für MVP)
**Origin:** Hommage an Sami Frashëri (1850–1904), albanischer Universalgelehrter und Enzyklopädist. Das "x" gibt dem weichen "Sami" eine technische Kante. Ausgesprochen *"sa-mix"*.

*Warum relevant:* Der Name ist personal-culture-anchored und signalisiert Wissensaggregation — genau das, was das System tut. Kein zufälliges Branding.

---

## 1. Goal

Ein erweiterbares, lokal laufendes Multi-Agent-System als Desktop-App. Zwei Agenten-Klassen:

- **Reactive Agents** — auf User-Anfrage, Chat-basiert (z. B. Coding-Agent, ab Phase 3)
- **Proactive Agents** — zeitgesteuert, schreiben Output in DB (z. B. tägliche Newsletter, ab Phase 1)

Beide teilen dieselbe Skill-Abstraktion, Modell-Adapter und Budget-Logik. Orchestrator (hierarchisch delegierender Router) kommt erst in Phase 4.

Kein Cloud-Dienst, keine Authentifizierung, Single-User. Später optional Mobile-Client (Flutter), der den Agent-Core per HTTP anspricht — entweder lokal im gleichen Netzwerk oder auf einem Mini-VPS.

---

## 2. Core Principles

1. **Local-first** — keine Cloud-Abhängigkeit im Kernpfad. Ausnahme: LLM-API-Calls (zwingend extern).
2. **Model-agnostic by default** — jeder Agent muss mit mindestens zwei Providern lauffähig sein.
3. **UI und Core sind entkoppelt** — Core ist ein eigenständiger Node-Prozess mit HTTP-API. Tauri-App ist ein Client.
4. **Agent-Isolation** — ein fehlerhafter Agent reißt nichts anderes mit. Jeder Run ist atomar.
5. **Hard budget caps** — kein Agent überschreitet sein tägliches USD-Limit.
6. **Source traceability** — jede News-Aussage hat URL + Datum.
7. **Skill = declarative** — der Skill beschreibt *was*, der Adapter übersetzt in *wie*.
8. **Mobile-ready by design** — alle UI-Core-Interaktionen gehen über HTTP. Ein Flutter-Client kann später dieselbe API nutzen.

---

## 3. Confirmed Decisions

| Entscheidung | Wert |
|---|---|
| Produktname | Samix |
| Repo | `samix` (privat) |
| Domain | `samix.app` (für später) |
| Plattform | Desktop, Windows-first |
| Desktop-Framework | Tauri v2 |
| UI-Stack | React + Vite + TypeScript + Tailwind |
| UI-Komponenten | shadcn/ui |
| Agent-Core-Runtime | Node.js (separater Prozess, Alternative D) |
| Agent-Core-Sprache | TypeScript |
| HTTP-Framework (Core) | Fastify |
| Core ↔ UI | HTTP auf `127.0.0.1` + Shared-Secret-Token |
| DB | SQLite (via Prisma + better-sqlite3) |
| Scheduling | `node-cron` im Core-Prozess |
| Secrets-Storage | OS-Keychain (Phase 1, wenn erster echter Key nötig) |
| Multi-User | Nein |
| Auth | Nur UI↔Core-Token |
| Package-Manager | pnpm |
| Build-Tooling | Turborepo **nicht** verwendet — nur pnpm-Workspaces |

---

## 4. High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│  User's Desktop (Windows)                                │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Samix App (samix-app)                             │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │  Rust Shell (src-tauri/)                     │  │  │
│  │  │  - Window / Tray                             │  │  │
│  │  │  - Core-Prozess spawnen                      │  │  │
│  │  │  - Port + Token an UI übergeben              │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │  React UI (src/) — WebView                   │  │  │
│  │  └──────────┬───────────────────────────────────┘  │  │
│  └─────────────┼─────────────────────────────────────┘  │
│                │ HTTP + Bearer Token                     │
│  ┌─────────────▼────────────────────────────────────┐   │
│  │  Samix Core (samix-core) — Node.js               │   │
│  │  Fastify · AgentRunner · SkillLoader · Scheduler │   │
│  │  ModelAdapter · BudgetLedger · Pino Logging      │   │
│  │  Prisma + SQLite (%APPDATA%/samix/samix.db)      │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
         │ (optional)
         ▼
    LLM APIs (Claude, OpenAI, Perplexity)
```

---

## 5. Project Structure

```
samix/
├── app/                          # Tauri + React UI
│   ├── src-tauri/                # Rust shell (minimal)
│   │   ├── src/main.rs
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json
│   ├── src/                      # React UI
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── pages/
│   │   └── lib/api.ts
│   ├── package.json
│   └── vite.config.ts
│
├── core/                         # Node.js Agent-Core
│   ├── src/
│   │   ├── server.ts
│   │   ├── agents/
│   │   ├── adapters/
│   │   ├── runner/
│   │   ├── skills/
│   │   ├── scheduler/
│   │   └── db/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── package.json
│   └── tsconfig.json
│
├── agents/                       # Skill definitions (data)
│   ├── _registry.yaml
│   └── hello-world/
│       ├── SKILL.md
│       └── manifest.yaml
│
├── docs/
│   ├── SAMIX_PHASE_0_SPEC.md     # dieses Dokument
│   └── decisions/
│
├── package.json                  # Root
└── pnpm-workspace.yaml
```

---

## 6. UI ↔ Core Communication

### Start-Flow

1. User startet Samix (Tauri-App).
2. Rust-Shell generiert zufälliges Token (UUID) und wählt freien Port (z. B. aus Range 51234–51999).
3. Rust-Shell spawnt Core-Prozess mit ENV: `SAMIX_PORT=<port>`, `SAMIX_TOKEN=<uuid>`.
4. Core startet, bindet sich **nur auf 127.0.0.1**, loggt `ready`.
5. Rust-Shell übergibt `port` und `token` an WebView via Tauri `invoke`.
6. React-UI initialisiert HTTP-Client mit `http://127.0.0.1:<port>` und `Authorization: Bearer <token>`.

### Security-Properties

- Loopback-only Bindung
- Token pro Session neu
- [Inference] Für Single-User-Local-Setup ausreichend

### Späterer Mobile-Zugriff

Core kann in Phase 5+ zusätzlich auf LAN/VPS lauschen. **Kein** Core-Refactor nötig, nur Config-Erweiterung.

---

## 7. Skill Format (SKILL.md + manifest.yaml)

### Beispiel: `agents/hello-world/SKILL.md`

```markdown
---
name: hello-world
description: Phase 0 smoke test agent — returns static greeting
---

You are the hello-world agent. This is a Phase 0 pipeline test.
When triggered, respond with:

"Hello from Samix. Agent pipeline is operational."

Do nothing else.
```

### Beispiel: `agents/hello-world/manifest.yaml`

```yaml
id: hello-world
type: reactive
version: 1.0

model:
  primary: static       # no LLM call, returns static string
  # Phase 0: echter Model-Adapter optional (hello-world prüft die Pipeline, nicht das Modell)

budget:
  daily_usd_max: 0.00
  tokens_per_run_max: 0
  halt_on_budget_exceeded: false

output:
  format: text
```

*Begründung für den static-"Model":* Hello-World soll die Pipeline validieren ohne API-Kosten und ohne externe Abhängigkeit. Phase-0-Tests brauchen keinen echten LLM-Call.

### Newsletter-Beispiel (Phase 1, zur Referenz)

```yaml
# agents/newsletter-ai/manifest.yaml (Phase 1, nicht Phase 0)
id: newsletter-ai
type: proactive
version: 1.0

model:
  primary: claude-haiku-4-5
  fallback: gpt-4o-mini
  routing:
    research: perplexity-sonar
    summarize: claude-haiku-4-5

budget:
  daily_usd_max: 0.50
  tokens_per_run_max: 50000
  halt_on_budget_exceeded: true

schedule:
  cron: "0 6 * * *"
  timezone: Europe/Berlin
  jitter_seconds: 30
  catchup_on_startup: true

sources:
  - type: rss
    urls: [...]
  - type: perplexity_search
    queries: [...]

output:
  format: newsletter_items
  schema: ./schema.json
  min_items: 5
  max_items: 10
```

---

## 8. Core Type System

```typescript
// core/src/types.ts

export type AgentType = 'reactive' | 'proactive';
export type ModelId = 'static' | 'claude-haiku-4-5' | 'claude-sonnet-4-5' |
  'gpt-4o-mini' | 'perplexity-sonar' | 'ollama-llama3';

export interface Skill {
  id: string;
  type: AgentType;
  version: string;
  skillMdPath: string;
  manifest: Manifest;
}

export interface Manifest {
  id: string;
  type: AgentType;
  version: string;
  model: ModelPreference;
  budget: BudgetSpec;
  schedule?: ScheduleSpec;
  sources?: SourceSpec[];
  output: OutputSpec;
}

export interface ModelPreference {
  primary: ModelId;
  fallback?: ModelId;
  routing?: Record<string, ModelId>;
}

export interface BudgetSpec {
  dailyUsdMax: number;
  tokensPerRunMax: number;
  haltOnBudgetExceeded: boolean;
}

export interface ScheduleSpec {
  cron: string;
  timezone: string;
  jitterSeconds?: number;
  catchupOnStartup?: boolean;
}

export interface SourceSpec {
  type: 'rss' | 'perplexity_search' | 'arxiv' | 'api' | 'custom';
  config: Record<string, unknown>;
}

export interface OutputSpec {
  format: string;
  schemaPath?: string;
  minItems?: number;
  maxItems?: number;
}

export interface RunContext {
  runId: string;
  triggeredBy: 'manual' | 'schedule' | 'catchup' | 'orchestrator';
  input?: unknown;
  now: Date;
}

export interface RunResult {
  status: 'success' | 'failed' | 'partial';
  output: unknown;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  error?: string;
  citations: Citation[];
}

export interface Citation {
  url: string;
  title?: string;
  publishedAt?: Date;
  accessedAt: Date;
}

// ModelAdapter-Interface
export interface ModelAdapter {
  readonly name: ModelId;
  readonly supportsTools: boolean;
  readonly supportsSearch: boolean;
  readonly pricing: {
    inputPerMillionTokens: number;
    outputPerMillionTokens: number;
  };
  generate(req: NormalizedRequest): Promise<NormalizedResponse>;
}
```

---

## 9. Prisma Schema (SQLite)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Agent {
  id         String   @id @default(uuid())
  slug       String   @unique
  type       String
  skillPath  String
  config     String?
  enabled    Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  runs       AgentRun[]
  budget     BudgetLedger[]
}

model AgentRun {
  id            String    @id @default(uuid())
  agentId       String
  agent         Agent     @relation(fields: [agentId], references: [id])
  status        String
  trigger       String
  input         String?
  output        String?
  tokensInput   Int       @default(0)
  tokensOutput  Int       @default(0)
  costUsd       Float     @default(0)
  error         String?
  startedAt     DateTime  @default(now())
  completedAt   DateTime?

  articles      Article[]

  @@index([agentId, startedAt])
}

model Article {
  id            String    @id @default(uuid())
  agentRunId    String
  agentRun      AgentRun  @relation(fields: [agentRunId], references: [id])
  title         String
  summary       String
  sourceUrl     String?
  sourceName    String?
  publishedAt   DateTime?
  topic         String?
  metadata      String?
  createdAt     DateTime  @default(now())

  @@index([topic, createdAt])
}

model BudgetLedger {
  id           String   @id @default(uuid())
  agentId      String
  agent        Agent    @relation(fields: [agentId], references: [id])
  period       DateTime
  tokensInput  Int      @default(0)
  tokensOutput Int      @default(0)
  costUsd      Float    @default(0)

  @@unique([agentId, period])
}
```

---

## 10. Environment Variables

```bash
# Core
SAMIX_PORT=<auto, von Rust-Shell gesetzt>
SAMIX_TOKEN=<auto, von Rust-Shell gesetzt>
DATABASE_URL=file:./data/samix-dev.db    # Dev
# Production: file:%APPDATA%/samix/samix.db (Windows)

# Globale Budget-Caps
SAMIX_GLOBAL_DAILY_USD_MAX=5.00

# API-Keys (Phase 1+)
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
PERPLEXITY_API_KEY=...

# Logging
SAMIX_LOG_LEVEL=info    # debug | info | warn | error
```

---

## 11. Phase 0 Deliverables

### Core
- [ ] pnpm-Workspace mit `core/` und `app/`
- [ ] Prisma-Schema + Migration erzeugt SQLite-File
- [ ] `core/src/types.ts`
- [ ] SkillLoader: liest `agents/*/manifest.yaml` + `SKILL.md`, validiert mit zod, persistiert in DB
- [ ] `StaticAdapter` (returns literal string — für hello-world)
- [ ] `ClaudeAdapter` als Referenz-Implementierung (noch nicht aktiv genutzt in Phase 0)
- [ ] `AgentRunner`: führt Skill aus, persistiert `AgentRun`, aktualisiert `BudgetLedger`
- [ ] Fastify-Server: `GET /agents`, `POST /agents/:slug/run`, `GET /runs/:id`, `GET /health`
- [ ] Token-Auth-Middleware
- [ ] Strukturiertes Logging (Pino) mit Run-IDs
- [ ] `hello-world`-Skill end-to-end ausführbar

### Tauri-App
- [ ] Tauri v2 Projekt initialisiert
- [ ] Rust-Shell spawnt Core-Child mit Port + Token
- [ ] Rust-Shell killt Core bei App-Exit
- [ ] UI zeigt Agent-Liste (GET /agents)
- [ ] Run-Button für hello-world, zeigt Ergebnis
- [ ] Disconnect-Banner wenn Core nicht erreichbar
- [ ] `/health`-Polling alle 10 s

### Dokumentation
- [ ] ADRs für Tauri, Node-separat, SQLite
- [ ] `README.md` mit Setup-Anleitung

### Akzeptanzkriterium

```
1. pnpm dev:core       → Core läuft, Logs zeigen "ready"
2. pnpm dev:app        → Tauri-Fenster öffnet, UI lädt Agent-Liste
3. Click "Run"         → Response: "Hello from Samix. Agent pipeline is operational."
4. SQLite: AgentRun-Eintrag mit status='success'
5. Core kill manuell   → UI zeigt Connection-Error, crasht nicht
```

---

## 12. Out of Scope for Phase 0

- Echter Newsletter-Agent (Phase 1)
- Newspaper-UI (Phase 1)
- Echte LLM-API-Calls (Phase 1)
- Perplexity/OpenAI/Ollama Adapter (Phase 1+)
- OS-Keychain-Secret-Storage (Phase 1)
- Tray-Icon + Autostart (Phase 1)
- Tool-Use (Phase 2+)
- Orchestrator (Phase 4)
- Coding-Agenten (Phase 3)
- Voice (Phase 5+)
- Cross-Agent-Memory (Phase 4+)
- Mobile-Client (Phase 5+)
- Cross-Platform-Builds (Phase 4+)
- Code Signing / Installer (Phase 5+)

---

## 13. Risks & Mitigations

| Risiko | Impact | Mitigation |
|---|---|---|
| API-Kosten explodieren | hoch | Daily-Cap pro Agent, globaler ENV-Cap |
| LLM-Halluzination | mittel | Pflicht-Citation mit URL + Datum |
| Provider-Outage | mittel | Fallback-Modell; Retry mit Backoff |
| News-Scraping rechtlich | hoch | Nur Summary + Quell-Link, keine Volltexte |
| App zur Cron-Zeit aus | mittel | `catchup_on_startup` |
| SQLite-Korruption | niedrig | WAL-Modus, Backups |
| Secrets in Git | hoch | `.gitignore`, Pre-Commit mit `gitleaks` |
| Core crashed silently | mittel | `/health`-Polling, UI-Banner |
| Thesis-Konflikt (Aug 2026) | hoch | Phase 0 jetzt, Phase 1–2 parallel begrenzt, Rest nach Thesis |

---

## 14. Open for Phase 1 (nicht jetzt entscheiden)

- Newsletter-Layout-Details (Karten vs. Spalten)
- Delivery-Kanäle (nur UI oder auch Mail/Telegram)
- Retention-Policy für Articles
- Personalisierung via Up/Down-Voting
- Source-Config-UI vs. nur YAML

---

## 15. Changelog

**v3 (diese Version):**
- Umbenennung JARVIS → Samix
- Alle ENV-Variablen `JARVIS_*` → `SAMIX_*`
- Alle Pfade `jarvis/` → `samix/`
- shadcn/ui als UI-Library-Wahl fixiert
- `hello-world`-Skill nutzt `static`-Adapter statt echtem LLM (spart API-Kosten in Phase 0)

**v2 (ersetzt):**
- Shift von Web zu Desktop (Tauri + Node-separat)
- SQLite statt Postgres
- Removal Cloud-Services

**v1 (initial):**
- Web-Stack, Cloud-Services

---

*Diese Spec ist Phase-0-begrenzt. Phase 1+ werden separat spezifiziert.*

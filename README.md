# Samix

Local-first desktop application hosting a hierarchical multi-agent system for knowledge aggregation.

Named after Sami Frashëri (1850–1904), Albanian encyclopedist. Pronounced *sa-mix*.

> This repository is at **Phase 1**. Real model calls (Claude, Perplexity, local Ollama), RSS/arXiv/Perplexity sources, cron scheduling, budget caps and JSON-schema output validation are implemented and running. Results are delivered through the in-app newspaper view; no email or messenger delivery is built.

For the full project values and non-negotiables, see [`docs/SAMIX_ABOUT.md`](docs/SAMIX_ABOUT.md).
For the current architecture, see [`docs/SAMIX_PHASE_1_SPEC.md`](docs/SAMIX_PHASE_1_SPEC.md) and the honest status in [`docs/SAMIX_PHASE_1_REPORT.md`](docs/SAMIX_PHASE_1_REPORT.md).
Architecture decisions are recorded as ADRs in [`docs/decisions/`](docs/decisions/).

---

## What works

- **Agents are data, not code.** An agent is a directory under `agents/`: a `SKILL.md` holding the system prompt and a `manifest.yaml` declaring model, budget, schedule, sources and output schema. Adding an agent means adding a directory.
- **Model-agnostic adapters.** Claude (Haiku, Sonnet), Perplexity Sonar, local Ollama and a `static` test adapter sit behind one interface. A new provider is one file plus one registry entry.
- **Declared fallback.** If the primary adapter throws, the runner retries once against the manifest's `fallback:` model and prices the run against whichever adapter actually served it.
- **Two budget gates before any provider call.** A per-agent daily cap and a global daily cap, checked against a deliberately pessimistic pre-call cost estimate. A misconfigured agent cannot spend unbounded money.
- **Schema-validated output.** Output that violates the agent's JSON schema marks the run `partial`: no rows are written to the knowledge store, the raw response is kept for diagnosis, and the spend is still booked.
- **Source traceability.** Every fetched item is persisted as a `SourceSnapshot` row keyed to the run.
- **Secrets in the OS keychain.** API keys never touch the filesystem; the Tauri shell injects them into the core process at spawn time.

## Not built yet

No automated tests, no CI. No email or messenger delivery (dropped deliberately, see the Phase 1 report). No release installer or tray icon. Windows auto-spawn is written but untested. Verification so far is manual, against the acceptance criteria in the Phase 1 report.

---

## Prerequisites

- **Node.js** ≥ 20 LTS
- **pnpm** ≥ 10 (`npm install -g pnpm`)
- **Rust toolchain** (for Tauri) — install via [rustup.rs](https://rustup.rs)
- **Git**
- Platform-specific Tauri prerequisites — see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

Developed on macOS. Windows is the shipping target; no code is Mac-specific, but the Windows auto-spawn path is untested.

---

## First-time setup

```bash
pnpm install
pnpm --filter samix-core prisma migrate deploy
```

The SQLite dev DB is created at `core/data/samix-dev.db`.

---

## Running in dev

One command. The Tauri shell spawns the core itself with a generated port and token, and injects the API keys from the OS keychain.

```bash
pnpm dev:app
```

**First run:**

1. Open **Settings**, enter an Anthropic API key (Perplexity optional), save.
2. Restart the app so the keys reach the core process at spawn time.
3. Hit **Run** on `newsletter-ai`. Articles appear in the newspaper view.

**Configuring sources (optional):** the **Sources** page edits RSS URLs, arXiv categories and Perplexity queries. Saving rewrites `manifest.yaml` on disk and re-registers the scheduled job without a restart.

---

## Project structure

```
samix/
├── app/           # Tauri v2 + React + Vite (the desktop shell)
│   ├── src/       # React UI
│   └── src-tauri/ # Rust shell — minimal, just exposes get_core_config
│
├── core/          # Node.js HTTP core
│   ├── src/       # Fastify server, runner, adapters, skill loader
│   └── prisma/    # SQLite schema + migrations
│
├── agents/        # Skill definitions (data, not code)
│   ├── hello-world/        # smoke-test agent (static adapter)
│   └── newsletter-ai/
│       ├── SKILL.md        # system prompt + frontmatter
│       ├── manifest.yaml   # model, fallback, budget, schedule, sources
│       └── schema.json     # output contract enforced by the runner
│
├── docs/
│   ├── SAMIX_ABOUT.md              # values anchor — read first
│   ├── SAMIX_PHASE_1_SPEC.md       # current architecture
│   ├── SAMIX_PHASE_1_REPORT.md     # what passes, what was dropped
│   └── decisions/                  # ADRs
│
└── pnpm-workspace.yaml
```

---

## Scripts

| Script              | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `pnpm dev:core`     | Run the Node core (Fastify, auto-reloads on source save). |
| `pnpm dev:app`      | Run the Tauri app (opens the desktop window).             |
| `pnpm build:core`   | Build the core to `core/dist/`.                           |
| `pnpm build:app`    | Bundle the desktop app (release build).                   |
| `pnpm db:migrate`   | Apply a new Prisma migration in dev mode.                 |
| `pnpm db:studio`    | Open Prisma Studio to inspect the SQLite DB.              |

---

## Verifying a working install

1. `pnpm dev:app` opens the window and the core logs `adapter_ready` for each configured model.
2. Run `newsletter-ai` → `status: success` and at least five articles with source URLs.
3. `pnpm db:studio` → `AgentRun`, `Article` and `SourceSnapshot` rows for that run.
4. Set the global cap to `0.01` → the next run refuses with `global_budget_exceeded` and costs nothing.
5. Kill the core → the window shows a red "Samix Core disconnected" banner within ~10 s.
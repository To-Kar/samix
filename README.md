# Samix

Local-first desktop application hosting a hierarchical multi-agent system for knowledge aggregation.

Named after Sami Frashëri (1850–1904), Albanian encyclopedist. Pronounced *sa-mix*.

> This repository is at **Phase 0** — pipeline validation only. No real LLM calls, no newsletter, no newspaper UI. The goal is to prove that the skill-loader → runner → DB → HTTP → UI path works end-to-end, using a `static` model adapter that returns a literal string.

For the full project values and non-negotiables, see [`docs/SAMIX_ABOUT.md`](docs/SAMIX_ABOUT.md).
For the Phase 0 architecture, see [`docs/SAMIX_PHASE_0_SPEC.md`](docs/SAMIX_PHASE_0_SPEC.md).

---

## Prerequisites

- **Node.js** ≥ 20 LTS
- **pnpm** ≥ 10 (`npm install -g pnpm`)
- **Rust toolchain** (for Tauri) — install via [rustup.rs](https://rustup.rs)
- **Git**
- Platform-specific Tauri prerequisites — see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

Phase 0 is being developed on macOS. Windows support is the Phase 1+ shipping target; no code is Mac-specific.

---

## First-time setup

```bash
pnpm install
pnpm --filter samix-core prisma migrate deploy
```

The SQLite dev DB is created at `core/data/samix-dev.db`.

---

## Running in dev (Phase 0: two terminals)

The Rust shell does **not** auto-spawn the core in Phase 0. Start each process manually.

**Terminal 1 — core:**

```bash
SAMIX_TOKEN=testtok SAMIX_PORT=4000 pnpm dev:core
```

Logs should end with `ready` and `Server listening at http://127.0.0.1:4000`.

**Terminal 2 — app:**

```bash
SAMIX_TOKEN=testtok SAMIX_PORT=4000 pnpm dev:app
```

The Rust shell reads these same env vars and exposes them to the WebView via the `get_core_config` Tauri command. Keep the tokens consistent between the two terminals.

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
│   └── hello-world/
│       ├── SKILL.md        # system prompt + frontmatter
│       └── manifest.yaml   # model, budget, schedule, output
│
├── docs/
│   ├── SAMIX_ABOUT.md              # values anchor — read first
│   ├── SAMIX_PHASE_0_SPEC.md       # Phase 0 architecture
│   ├── SAMIX_PHASE_0_CLAUDE_CODE_HANDOFF.md  # implementation handoff
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

## Phase 0 acceptance check

1. `pnpm dev:core` → logs show `ready` and one `skill loaded` entry for `hello-world`.
2. `pnpm dev:app` → a Samix window opens listing the `hello-world` agent.
3. Click **Run** → the result card shows the SKILL.md body, `status: success`, `cost: 0.0000`.
4. `pnpm db:studio` → the `AgentRun` table has a row with `status='success'`.
5. Ctrl-C the core terminal → within ~10 s the window shows a red "Samix Core disconnected" banner.

If all five pass, Phase 0 is done.

---

## What Phase 0 is *not*

No real LLM calls, no RSS fetching, no newsletter agent, no newspaper UI, no cron triggering, no tray icon, no installer, no multi-platform build. Those are explicitly scheduled for Phase 1+. See `docs/SAMIX_PHASE_0_SPEC.md` §12 for the full out-of-scope list.

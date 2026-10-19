# Samix

Local-first desktop application hosting a hierarchical multi-agent system for knowledge aggregation.

Named after Sami Frashëri (1850–1904), Albanian encyclopedist. Pronounced *sa-mix*.

> Built so far: the newspaper (proactive agents with RSS/arXiv/website sources, full-text reader, votes, Ressorts), a bundled desktop app for macOS and Windows, **Phase 3a "Frag deine Zeitung"** (questions answered only from the collected articles, with checked citations) **Phase 3b** (read-only questions about released project folders) and **Phase 4** (an orchestrating entry point plus visible notes). Real-model behaviour and the macOS/Windows builds are not verified from the development environment; see `docs/SAMIX_ROADMAP.md` for the honest status of each phase.

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

- **A newspaper, not a feed.** Each run is an edition: a lead story with the opening of the original text, article blocks, and short notices, ordered by the model's importance rating (with its stated reason). Click an article to read the full original text inside the app, with images. If the text can't be fetched (paywall, JavaScript-only page, blocked) the reader says so and offers the browser.
- **Websites as sources.** Enter `chip.de`, optionally with keywords: Samix finds the newest articles via the site's feed, its sitemap, or its headline links, without site-specific code. A preview in the Sources page shows what would be fetched.
- **Ressorts.** Create your own sections: a name, a topic ("AI in everyday life"), sources (e.g. `chip.de` with the keyword `KI`) and a schedule. Each has its own budget, front page tab, model and run history. A 👍/👎 on articles teaches the ranking what you like (opt-in per Ressort; the Ressorts page shows exactly what is sent and can reset it). Stories already published are not shown again.
- **Safe fetching.** Links in feeds are third-party input. Every fetch (pages, images, feeds) refuses loopback, private and link-local addresses, checks each redirect, and caps size. Page text becomes structured blocks, never raw HTML; images are downloaded by the core and shown from the local cache.

## Not built yet

No email or messenger delivery (dropped deliberately, see the Phase 1 report). Everything the roadmap marks as unverified is untested on real macOS/Windows machines, real runners and live sites: the Tauri shell and installers, CI workflows, website sources, and real-model behaviour (including tool use in "Fragen"). The UI is verified in Chromium, not in the Tauri WebViews. The `semantic` keyword filter is not implemented. Core logic has automated tests (`pnpm --filter samix-core test`); UI and the Tauri shell are verified manually. Phase 3b (read-only project assistant) and 3c (coding agent) are specified, not built. See `docs/SAMIX_ROADMAP.md` for the plan.

---

## Prerequisites

- **Node.js** ≥ 22.13 (the version in `.node-version` is what CI and the shipped app use; `node:sqlite` needs ≥ 22.13)
- **pnpm** ≥ 10 (`npm install -g pnpm`)
- **Rust toolchain** (for Tauri) — install via [rustup.rs](https://rustup.rs)
- **Git**
- Platform-specific Tauri prerequisites — see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

Developed on macOS. Windows is the shipping target; no code is Mac-specific, but the Windows auto-spawn path is untested.

---

## First-time setup

```bash
pnpm install
```

That is all. `postinstall` generates the Prisma client, and the core creates `core/data/samix-dev.db` and applies the migrations itself on start. `core/.env` is optional (see `core/.env.example`).

```bash
pnpm --filter samix-core test        # unit + integration tests (temp SQLite DB per file)
pnpm --filter samix-core typecheck
```

---

## Running in dev

One command. The Tauri shell spawns the core itself with a generated port and token, and injects the API keys from the OS keychain.

```bash
pnpm dev:app
```

**First run:**

1. Open **Settings**, enter an API key for the model you use (Anthropic, or DeepSeek; Perplexity optional), save. To use DeepSeek, set `model.primary: deepseek-chat` in `agents/newsletter-ai/manifest.yaml`; check its price and model name first (see `core/src/adapters/deepseek.ts`).
2. Restart the app so the keys reach the core process at spawn time.
3. Hit **Run** on `newsletter-ai`. Articles appear in the newspaper view.

**Configuring sources (optional):** the **Sources** page edits RSS URLs, arXiv categories and Perplexity queries. Saving rewrites `manifest.yaml` on disk and re-registers the scheduled job without a restart.

---

## Building the installable app

```bash
pnpm install
pnpm build:app
```

This downloads the pinned official Node.js binary (checksum-verified), bundles the core into a single file with the Prisma engine for **this** platform, and runs `tauri build` with `src-tauri/tauri.release.conf.json`. Build on the platform you target (macOS Apple Silicon, Windows x64): the bundle contains a native library. `.github/workflows/release.yml` does this on GitHub runners.

The result is unsigned. On macOS, open it the first time via right-click → Open. On Windows, SmartScreen will warn. Data lives in the OS app-data folder (`app.samix`); the log is `core.log` in the OS log folder (Settings → *Show log file*). See `docs/decisions/007-bundled-core-sidecar.md`.

To check a core bundle without the app: `pnpm --filter samix-core bundle` then
`node core/scripts/verify-bundle.mjs app/src-tauri/resources/core app/src-tauri/binaries/node-<triple>`.

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
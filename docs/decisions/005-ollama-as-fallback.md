# ADR 005 — Ollama as fallback, not OpenAI

**Status:** Accepted
**Date:** 2026-04-18
**Context doc:** `docs/SAMIX_PHASE_1_SPEC.md` §8

## Decision

Use a locally-running Ollama model (`ollama-llama3`) as the fallback slot in the skill routing. Do not introduce an OpenAI adapter in Phase 1.

## Rationale

- **Local-first.** A local fallback is the most credible form of vendor independence — no second paid vendor, no second API-key to rotate, no traffic leaves the device when the primary provider is down.
- **Zero marginal cost.** Fallback runs don't add to `SAMIX_GLOBAL_DAILY_USD_MAX` pressure.
- **Model-agnostic stress-test.** The first time the adapter abstraction actually pays off is when two *structurally different* backends (SaaS API + local HTTP) share the same interface. OpenAI-as-fallback would stress the abstraction less.
- **Scope discipline.** The project values prefer "extensibility over features." Adding OpenAI now would be a feature without an abstraction win.

## Consequences

- Users who want Ollama fallback must install it themselves (one-line on macOS: `brew install ollama && ollama pull llama3`). README documents this as a Phase 1 prereq.
- If Ollama is not reachable at core startup, the adapter removes itself from the registry and logs a warning. Skills that request it in their routing get a documented failure path — no silent degradation.
- OpenAI is not forbidden — it's deferred to Phase 2+ if a concrete need appears (e.g., a tool-use pattern Claude doesn't support well). At that point it gets its own ADR.
- Routing semantics: `fallback` fires when the primary adapter throws or hits a rate limit. Not a quality fallback (output isn't necessarily good), just a continuity fallback.

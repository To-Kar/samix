# ADR 006 — JSON Schema for output validation, not zod

**Status:** Accepted
**Date:** 2026-04-18
**Context doc:** `docs/SAMIX_PHASE_1_SPEC.md` §§9, 15

## Decision

Validate agent output against a JSON Schema file (`schema.json`) that lives next to `SKILL.md` and `manifest.yaml`. Use Ajv as the runtime validator. Do not use zod for skill output validation.

(Zod remains the right choice inside the core's own TypeScript code — e.g. `manifest.yaml` parsing — where the schema is consumed only by TS.)

## Rationale

- **Skills are data, not code.** One of the eight non-negotiable values. A JSON Schema file is data — it travels with the skill and ships without touching the core's TypeScript. A zod schema would force every new skill to add a `.ts` file and a rebuild.
- **Reusable across skills.** Ten newsletter-style skills can share the same schema file without any core changes.
- **Cross-language.** If a future Samix component is written in another language (e.g., a mobile client previewing output shape), JSON Schema is readable out of the box. Zod schemas are not.
- **Standard tooling.** Ajv is the mainstream Node validator; JSON Schema has wide editor support.

## Consequences

- Ajv gets added as a core dependency; `ajv-formats` for `format: "uri"`, `format: "date-time"`.
- A failed validation does not discard the run — the raw output is kept in `AgentRun.output`, `status` becomes `partial`, no `Article` rows are created, no delivery is sent. This keeps the failure debuggable.
- Schema errors in the LLM response become a first-class class of problem: source-traceability is enforced by refusing to persist articles without a valid `sourceUrl`.
- Schema files are authored by hand for Phase 1. If they proliferate, a schema-generation helper (e.g., from TypeScript types) can be introduced later without breaking existing skills.

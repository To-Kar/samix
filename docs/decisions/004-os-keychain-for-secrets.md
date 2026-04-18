# ADR 004 — OS Keychain for secrets

**Status:** Accepted
**Date:** 2026-04-18
**Context doc:** `docs/SAMIX_PHASE_1_SPEC.md` §6

## Decision

Store all runtime secrets (Anthropic + Perplexity API keys, SMTP credentials, Telegram bot token) in the user's OS keychain via the Rust `keyring` crate. The Tauri shell reads them at startup and passes them to the Node core as environment variables on process spawn. The core never reads the keychain directly; the UI never reads secret values back.

## Rationale

- **Local-first.** No cloud secret manager. No secret-at-rest in repo or user dotfiles.
- **Platform-native.** `keyring` maps to macOS Keychain, Windows Credential Manager, and Linux Secret Service — the OS handles process isolation and user-auth prompts.
- **One trust boundary.** Rust reads secrets, injects them on spawn, never exposes them back to the WebView. The UI shows only "configured yes/no" booleans.
- **Simple mental model for the user.** "Same place macOS stores my Mail passwords."

## Consequences

- Rust shell grows a thin `keychain.rs` module (`set_secret`, `has_secret`, `delete_secret`).
- No `get_secret` Tauri command — secrets only leave Rust via the spawn environment.
- First-run UX: a Settings page in the app; no `.env` editing required.
- Changing a secret requires a core restart (to re-read the keychain). Acceptable for a single-user desktop app; surfaced as an "app restart needed" hint after save.
- If the keychain is locked (typical on macOS after login), the user gets a one-time OS prompt. Logged but not treated as a core failure.

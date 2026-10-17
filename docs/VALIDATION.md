# Validation — 2026-10-17

Target: macOS OpenChamber 2.4.0, bundled OpenCode 2.0.32; matching SDK versions pinned.

| Layer | Evidence | Result |
| --- | --- | --- |
| Build | Node ESM plugin, browser IIFE, TypeScript 6.0.3 | Passed |
| Unit | Decimal operations/errors, tool allowlist, official manifest parser, deployment preservation/backups | Four groups passed |
| Installed binary | Isolated XDG paths and local OpenAI-compatible fixture | Passed |
| Model tool surface | Captured outbound Chat and Build requests | Exactly `chat_calculate`, `question`, `webfetch`, `websearch` |
| Execution | Actual calculator call through OpenCode | `0.3` returned to model |
| Negative execution | Fixture forces unadvertised shell call | No tool named shell; sentinel unchanged |
| Permission API | Chat and Build in Chat Location | FS/Shell/code/subagents/skills/browser/unknown tools denied |
| Isolation | Ordinary coding Location on same server | Read and coding tools retained |
| Attachments | Native TXT/PNG data URIs through real binary | Reached fixture without enabling read |
| Desktop | Installed configuration and local plugin | Active; no higher-priority authored policy in observed config sources |
| Live permission API | Ten prohibited actions × Chat/Build | 20 denials |
| Live model | OpenCode Go DeepSeek V4.1 Flash, high | Calculator, URL fetch, search and primary-source fetch succeeded |
| UI | Project, selector, official extension panel | 聊天模式, Chat, current-project state and native history visible |
| App integrity | codesign --verify --deep --strict | Passed; app bundle untouched |

The first live attempt with `opencode/deepseek-v4.1-flash-free` returned an upstream 403 free-tier restriction. The successful run used the available OpenCode Go provider, without bypassing that restriction.

Tests inspect the real permission endpoint and model request payloads, not refusal prose. Production credentials are not logged. Test server passwords are random and redacted from diagnostics. Private captures/session identifiers are ignored under `.local/`.

## Limits

- Image transport is tested; live vision understanding is not.
- UI status is selection information, not proof of effective policy.
- This is not an OS sandbox. Native config/persistence and trusted plugin code retain host access.
- Higher-priority policies, later hooks, replacement tools and session relocation require renewed review.
- Other app versions, remote hosts, general PDF extraction, image generation and long-term memory are outside this delivery.
- Catalog endpoints may return an initially empty snapshot while plugins settle; integration waits for activation.

`npm run check` reproduces build, type checking, unit tests and isolated installed-binary tests. It does not silently make live account/model calls.

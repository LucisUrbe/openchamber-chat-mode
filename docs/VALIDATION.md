# Validation — 2026-11-11

Target: macOS OpenChamber 2.7.0 and bundled OpenCode 2.2.6. The isolated server uses a local model and callback fixture. The checks exercise both Chat and Build in the Chat Location, retain the default-deny policy, and verify that general code execution, shell, file tools, scheduled tasks, knowledge and image generation remain unavailable.

The fixture registers Web and Memory behind Code Mode, as OpenChamber does. The test verifies that the prompt-time transform makes them directly callable, that their actual tool calls reach the callback, and that a test memory can be saved in one session and read in another. It exercises short action aliases while preserving the native tool's list of allowed actions. Render is also called directly. An ordinary coding Location remains separate.

An additional isolated run used a copy of the OpenChamber 2.7.0 managed plugin for Web, Memory and Render with the local callback fixture and an existing Chat configuration. The Desktop UI displayed the three Chat permissions as allowed. A temporary Desktop session's permission endpoint confirmed those allowances and denials for shell, read, execute, scheduling and image generation; both Chat plugins reported active.

In temporary Desktop sessions using a tool-capable model, a read-only `memory.list`, `render.page`, and browser open, snapshot and close on `https://example.com` returned `ok: true`. An initial unqualified browser action failed schema validation; after adding aliases, live calls using `list`, `open` and `close` returned `ok: true` and resolved to the corresponding native actions. No memory was written in the live check. The sessions were deleted afterwards; the rendered page was not visually inspected in Desktop.

To repeat the isolated test with an installed generated plugin, set `OPENCODE_TEST_MANAGED_PLUGIN` to its directory and run `node scripts/integration.mjs`; `OPENCODE_TEST_CHAT_CONFIG` optionally selects a JSON configuration to test in isolation.

# Historical validation — 2026-10-30

Target: macOS OpenChamber 2.5.3, bundled OpenCode 2.2.0; plugin and SDK dependencies remain pinned in the lockfile.

This pair was tested with the earlier implementation. The deployment and server-plugin version gates accept valid semantic versions with major version 2, including prerelease and build metadata, and reject malformed versions or other majors. This policy does not establish that every 2.x release works. `engines.openchamber: 2.0.0` is a minimum-version declaration and does not itself prevent an extension from starting on 3.x.

The previous plugin refused to activate on OpenCode 2.2.0 because it required 2.0.32. As a result, its `chat` → `Chat` agent-name transform and calculator registration did not run. In an isolated server using the current bundled binary and a local model fixture, `npm run check` verifies:

- Plugin activation, `chat` as the stable ID, and `Chat` as the agent name.
- Existing Chat and Build permission denials, the four-tool model allowlist, and the separate coding-location control.
- Calculator schema and actual tool results for legacy arithmetic, expressions, weighted and sample statistics, matrix multiplication and exact large integers.
- Native text/image attachment transport and rejection of a forced unadvertised shell call.

Unit tests also cover expression precedence, invalid or oversized inputs, decimal precision, population versus sample statistics, matrices and integer division. These checks do not make a real account-backed model request or exercise live image understanding.

The integration test can also use an existing JSON-format configuration: set `OPENCODE_TEST_CHAT_CONFIG` to its path. The fixture replaces model/provider settings in the isolated copy and never writes to the original.

On the local installation, deployment preserved the modified configuration byte-for-byte and backed up the previous managed files. After the watchdog update, OpenChamber's plugin settings showed both the `chat` plugin package and `chat-watch.js` as loaded, and the visible agent selector showed `Build`, `Chat`, and `Plan`. This Desktop check did not send an account-backed model request.

## Major-version and watchdog checks

The checks below were run on the current 2.5.3 / 2.2.0 installation. They do not establish compatibility with other 2.x releases.

| Area | Check to run | Status |
| --- | --- | --- |
| Version parsing | `npm run check`: valid stable/prerelease/build 2.x, majors 1 and 3, and malformed/missing values. | Passed |
| Extension metadata | `engines.openchamber: 2.0.0` is a lower bound; deployment checks OpenChamber and the plugin checks OpenCode. The manifest cannot enforce an OpenChamber upper bound at runtime. | Passed |
| Watcher warning and recovery | Isolated installed binary: setup and syntax failures, missing core, Chat/Build/Plan and custom agents, and recovery after a location reload. | Passed at API level |
| Permission and scope | Extension capabilities remain `sessions`; isolated Chat/Build/Plan permission checks stay denied on core failure. | Passed |
| Legacy deployment and rollback | Temporary fixtures exercise legacy-marker migration, occupied watchdog refusal, preservation, and rollback followed by reinstallation. | Passed |
| Desktop failure warning | The real app's normal selector and its use of agent display names were inspected. Failure rendering still needs an actual OpenChamber UI test: its temporary test project required explicit trust to run local plugins, which was not granted. | Not yet verified |

The SDK cannot guarantee that the watcher runs when its own path, the broader OpenCode plugin runtime, the OpenChamber UI, or the extension fails. For plugin load details, inspect **OpenChamber Settings → Plugins**. The warning is a bounded in-Location signal, not comprehensive failure monitoring.

# Historical validation — 2026-10-17

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
| Live model | Tool-capable model | Calculator, URL fetch, search and primary-source fetch succeeded |
| UI | Project, selector, official extension panel | 聊天模式, Chat, current-project state and native history visible |
| App integrity | codesign --verify --deep --strict | Passed; app bundle untouched |

Tests inspect the real permission endpoint and model request payloads, not refusal prose. Production credentials are not logged. Test server passwords are random and redacted from diagnostics. Private captures/session identifiers are ignored under `.local/`.

## Limits

- Image transport is tested; live vision understanding is not.
- UI status is selection information, not proof of effective policy.
- This is not an OS sandbox. Native config/persistence and trusted plugin code retain host access.
- Higher-priority policies, later hooks, replacement tools and session relocation require renewed review.
- Other app versions, remote hosts, general PDF extraction, image generation and long-term memory are outside this delivery.
- Catalog endpoints may return an initially empty snapshot while plugins settle; integration waits for activation.

`npm run check` reproduces build, type checking, unit tests and isolated installed-binary tests. It does not silently make live account/model calls.

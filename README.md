# OpenChamber Chat Mode

English | [中文](README.zh.md)

A dedicated conversational project for **OpenChamber 2.4.0 / OpenCode 2.0.32** on macOS. The agent displays as **Chat**; its stable configuration/session ID is `chat`.

Keeps native conversations, model selection, explicit attachments and history. Model-visible tools are exactly `websearch`, `webfetch`, `question` and `chat_calculate`. No general local files, shell, code execution, browser automation, skills or subagents.

## Build and install

Requires Node.js 22+, npm, and `/Applications/OpenChamber.app` 2.4.0 with bundled OpenCode 2.0.32. SDKs and libraries are pinned in the lockfile.

```sh
npm ci --ignore-scripts
npm run check
npm run deploy
```

`check` builds, checks types and runs unit tests plus the **installed OpenCode binary** against isolated XDG storage and a local model fixture. No paid model calls. `OPENCODE_TEST_BINARY` can explicitly override the test binary; it does not expand the supported version range.

Deployment creates only `~/.local/share/openchamber-chat/`:

```text
location/opencode.jsonc
location/.opencode/plugins/chat/{package.json,index.js}
extension/package.json
extension/panel/{index.html,main.js}
.chat-mode-install.json
backups/                         # previous managed files on upgrades
```

1. Add the deployed `location` directory as a separate OpenChamber project, named “Chat Mode” or “聊天模式”. Keep it outside coding repositories.
2. Settings → Extensions: install the deployed `extension` folder and approve **sessions only**.
3. Open the Chat panel and bind the deployed project. The choice persists in `host.storage`.
4. Select that project, use native **New session**, confirm **Chat**, and select a working model.

OpenCode's `default_agent` supplies the default. OpenChamber may retain an earlier choice; set the project's default agent to `chat` if needed. Build and Plan remain subject to the Chat Location policy. OpenCode Go is optional.

The official UI-kit panel subscribes to native history and uses `host.openSession`. It does not certify server policy. SDK 2.4.0 cannot specify an agent in `host.startSession`, so creation uses the native UI. No extra service, shadow transcript or replacement renderer is installed.

## Boundary and features

- Agent permissions deny everything, then allow four actions. Independent location `tool.use` policies deny other actions even when Build or broad session permissions are selected.
- The local plugin makes allowed tools directly callable (`codemode: false`) and strips other tool definitions before model requests. It sets **Chat** as the display name without changing the ID.
- `chat_calculate`: two decimal strings (up to 256 characters each), add/subtract/multiply/divide, decimal.js, 50 significant digits, half-even rounding. Execution calls `ctx.permission.assert`. Division by zero, nonfinite values and code are rejected; there is no expression evaluator.
- Explicit text and image attachments use native input, separately from `read` permissions. Vision requires a suitable model. General PDF extraction, image generation and persistent memory are not implemented.
- Web search uses native providers. `random` selects a provider; it does not aggregate independent searches. Configure providers through native settings when needed.

This is **model/tool isolation, not an OS sandbox**. OpenCode still reads configuration and saves native session state. Trusted plugin code retains host privileges; code that bypasses permission checks is not sandboxed by policies. Global, managed or Console policy has higher priority. Later plugin hooks can change tool visibility. Moving a session outside the Chat Location leaves this boundary. Revalidate after configuration/plugin changes or upgrades; an assistant's refusal is not enforcement evidence.

## Validation

See [VALIDATION.md](docs/VALIDATION.md). The installed binary passed outbound-tool, permission, calculator, attachment-transport, forced-shell-rejection and coding-isolation checks. Actual Desktop validation used `opencode-go/deepseek-v4.1-flash` at `high` for calculation, URL fetch and search; Chat, the project and native history were visible. Image transport was tested with a fixture, not a live vision model. Private captures are ignored under `.local/`.

## Upgrade, rollback and removal

Repeat the build/check/deploy commands. Deployment refuses unmanaged directories, target symlinks and modified managed files, preserving user edits. Reconcile intentional edits before upgrading. Previous managed files and the install marker are backed up under `backups/<timestamp>/`.

To roll back, close OpenChamber, restore the six managed files and `.chat-mode-install.json` from a selected backup to the same relative paths, then reopen. Keep the location path unchanged to retain history associations. To stop using Chat, disable/remove the extension and remove the project from the sidebar; keep the directory for later reopening. Do not delete the OpenCode database.

SDK `engines.openchamber` means a minimum version, not an exact-version lock. Deployment checks OpenChamber 2.4.0; the plugin checks OpenCode 2.0.32. App upgrades require fresh compatibility validation.

Uses official [OpenCode plugin](https://dev.opencode.ai/v2/docs/build/plugins/), [policy](https://dev.opencode.ai/v2/docs/policies/), [permission](https://dev.opencode.ai/v2/docs/permissions/) and [OpenChamber SDK](https://docs.openchamber.dev/sdk/) APIs. No upstream fork, app patch, global config edit, search broker or additional MCP server.

# OpenChamber Chat Mode

English | [中文](README.zh.md)

A dedicated conversational project for **OpenChamber/OpenCode 2.x** on macOS. The current isolated test uses OpenChamber **2.7.0** with bundled OpenCode **2.2.6**; other 2.x versions pass the major-version gate but need validation. The agent displays as **Chat**; its stable configuration/session ID is `chat`.

Keeps native conversations, model selection, explicit attachments and history. Chat permits search, page fetching, calculation, and OpenChamber's browser, memory and interactive rendering tools when available.

## Build and install

Requires Node.js 22+, npm, and an OpenChamber 2.x installation with bundled OpenCode 2.x. SDKs and libraries are pinned in the lockfile. The validation record identifies the exact app and server versions exercised.

```sh
npm ci --ignore-scripts
npm run check
npm run deploy
```

`check` builds, checks types and runs unit tests plus the **installed OpenCode binary** against isolated XDG storage and local model fixtures, including the watchdog lifecycle check. No paid model calls. `OPENCODE_TEST_BINARY` can explicitly override the test binary; it does not expand the supported version range.

Deployment creates only `~/.local/share/openchamber-chat/`:

```text
location/opencode.jsonc
location/.opencode/plugins/chat/{package.json,index.js}
location/.opencode/plugins/chat-watch.js
extension/package.json
extension/panel/{index.html,main.js}
.chat-mode-install.json
backups/                         # previous managed files on upgrades
```

1. Add the deployed `location` directory as a separate OpenChamber project, named “Chat Mode” or “聊天模式”. Keep it outside coding repositories.
2. Settings → Extensions: install the deployed `extension` folder and approve **sessions only**.
3. Open the Chat panel and bind the deployed project. The choice persists in `host.storage`.
4. Select that project, use native **New session**, confirm **Chat**, and select a working model.
5. In Settings → General → OpenChamber Tools, enable **Agent memory tool** and check that **OpenChamber Web tool** and **Agent render tool** are enabled. These tools require the OpenCode server managed by OpenChamber.

OpenCode's `default_agent` supplies the default. OpenChamber may retain an earlier choice; set the project's default agent to `chat` if needed. Build and Plan remain subject to the Chat Location policy.

The official UI-kit panel subscribes to native history and uses `host.openSession`. It does not certify server policy. SDK 2.4.0 cannot specify an agent in `host.startSession`, so creation uses the native UI. No extra service, shadow transcript or replacement renderer is installed.

## Boundary and features

- Agent permissions deny everything, then allow `websearch`, `webfetch`, `question`, `chat_calculate`, `openchamber_web`, `openchamber_memory` and `openchamber_render`. Independent location `tool.use` policies deny other actions even when Build or broad session permissions are selected. Disabled or uninstalled native tools do not appear in model requests.
- The local core plugin makes allowed tools directly callable and strips other tool definitions before model requests. A prompt-time transform also makes Web and Memory direct when their managed plugin loads later, without enabling the general-purpose `execute` tool. It accepts the short action names, such as `open` and `list`, that the native service already resolves. The watcher sets **Chat** as the display name without changing the ID.
- `websearch` and `webfetch` retrieve pages; `openchamber_web` drives the OpenChamber browser panel and can access signed-in pages. Browser captures save screenshots in the project. Sending messages, transactions and changes to external data require user authorization in the task.
- `openchamber_memory` reads and maintains memories across conversations. The project knowledge panel can display them. OpenChamber's “About you” scope is shared across projects; project memories stay with their project. The memory setting affects the whole OpenChamber instance. The prompt instructs the agent not to save passwords or tokens.
- `openchamber_render` presents interactive pages and forms in chat. The native renderer can load local images by absolute path; the prompt limits this to paths the user provided or authorized.
- A separate server-side watcher at `location/.opencode/plugins/chat-watch.js` warns in the Chat Location when the core Chat plugin explicitly fails to load, remains missing, or its status cannot be confirmed. It prefixes each visible primary/all Agent display name with a prominent warning and removes the warning after the core plugin recovers. It does not add permissions to the extension.
- `chat_calculate` supports decimal arithmetic, restricted numeric expressions (including powers and the remainder operator), square roots, aggregate and sample/population statistics, weighted means, vector dot products, matrix multiplication, and exact integer operations. Percentage calculations can be expressed with ordinary arithmetic. Decimal inputs can use scientific notation; results use 50 significant digits by default, or a requested precision from 1 to 256, with half-even rounding. Integer division truncates toward zero. The tool checks permissions, limits input and work sizes, and rejects code, invalid or out-of-bounds numbers, and division by zero.
- Explicit text and image attachments use native input, separately from `read` permissions. Vision requires a suitable model. Image generation needs a separately configured image model; its native tool can read images and write files by path, so Chat does not allow it by default.
- Web search uses native providers. `random` selects a provider; it does not aggregate independent searches. Configure providers through native settings when needed.

This is **model/tool isolation, not an OS sandbox**. OpenCode still reads configuration and saves native session state. Trusted plugin code retains host privileges; code that bypasses permission checks is not sandboxed by policies. Global, managed or Console policy has higher priority. Later plugin hooks can change tool visibility. Moving a session outside the Chat Location leaves this boundary. Revalidate after configuration/plugin changes or upgrades; an assistant's refusal is not enforcement evidence.

## Validation

See [VALIDATION.md](docs/VALIDATION.md) for version-specific evidence and pending checks. Integration uses an isolated OpenCode server and a local model fixture; actual account-backed and Desktop results are identified separately. Image transport was tested with a fixture, not a live vision model. Private captures are ignored under `.local/`.

The version gate accepts valid semantic versions on major version 2, including prerelease and build metadata, and rejects malformed versions or other majors. The extension manifest's `engines.openchamber: 2.0.0` is a minimum-version declaration; by itself it does not prevent the extension from starting on 3.x. The runtime guards and recorded app/server versions are described separately in the validation record.

## Upgrade, rollback and removal

Repeat the build/check/deploy commands. Deployment refuses unmanaged directories, target symlinks and modified managed files, preserving user edits. Reconcile intentional edits before upgrading. Previous managed files and the install marker are backed up under `backups/<timestamp>/`. Deployment can safely upgrade an install carrying the older six-file marker; the new watchdog is included in the current managed file set.

If the only modified managed file is `location/opencode.jsonc`, `npm run deploy -- --preserve-modified-config` explicitly leaves that file byte-for-byte unchanged while updating the other managed files. Its prompts, permissions and policies are therefore not updated; review and merge any needed changes separately. The original marker hash is retained so a later normal deployment will still flag the local edit. Other modified or missing files still prevent deployment.

To roll back, close OpenChamber and restore the managed files and `.chat-mode-install.json` from a selected backup to the same relative paths. A backup made before the watchdog was added will not contain `location/.opencode/plugins/chat-watch.js`: first confirm that this file has no user edits, then remove that managed file before restoring the older marker. If it has user edits, preserve and reconcile them before proceeding. Restore only files in the selected backup; do not blindly delete other files or user data. Keep the location path unchanged to retain history associations. To stop using Chat, disable/remove the extension and remove the project from the sidebar; keep the directory for later reopening. Do not delete the OpenCode database.

The current isolated validation covers OpenChamber 2.7.0 / OpenCode 2.2.6; other 2.x releases still need validation. App upgrades require fresh checks. If the core plugin fails to load, its calculator and tool-filtering hook are unavailable; the watcher reports the condition when its own monitoring path is running.

The watcher is not comprehensive failure monitoring. The SDK cannot guarantee that it can monitor its own failure, the whole OpenCode plugin runtime, the OpenChamber UI, or failure of the extension to start. For details, inspect the plugin status in **OpenChamber Settings → Plugins**.

Uses official [OpenCode plugin](https://dev.opencode.ai/v2/docs/build/plugins/), [policy](https://dev.opencode.ai/v2/docs/policies/), [permission](https://dev.opencode.ai/v2/docs/permissions/) and [OpenChamber SDK](https://docs.openchamber.dev/sdk/) APIs. No upstream fork, app patch, global config edit, search broker or additional MCP server.

# OpenChamber 聊天模式

[English](README.md) | 中文

专用于 macOS **OpenChamber 2.4.0 / OpenCode 2.0.32**。智能体显示为 **Chat**，内部配置和会话标识保持 `chat`。

沿用原生对话、模型选择、用户主动上传的附件和历史记录。模型只看到 `websearch`、`webfetch`、`question`、`chat_calculate` 四个工具，不提供普通本地文件读写、Shell、代码执行、浏览器自动化、技能或子智能体工具。

## 构建与安装

需要 Node.js 22+、npm，以及 `/Applications/OpenChamber.app` 2.4.0 和随附 OpenCode 2.0.32。依赖版本已锁定。

```sh
npm ci --ignore-scripts
npm run check
npm run deploy
```

`check` 完成构建、类型检查、单元测试，以及真实 OpenCode 二进制的隔离集成测试；使用本地测试模型，不调用付费模型。可通过 `OPENCODE_TEST_BINARY` 指定待测二进制，不代表自动支持其他版本。

部署仅写入 `~/.local/share/openchamber-chat/`：

```text
location/opencode.jsonc
location/.opencode/plugins/chat/{package.json,index.js}
extension/package.json
extension/panel/{index.html,main.js}
.chat-mode-install.json
backups/                         # 更新时备份原有托管文件
```

1. 在 OpenChamber 添加上述 `location` 目录为独立项目，命名“聊天模式”。不要选代码仓库或其子目录。
2. 设置 → 扩展，从上述 `extension` 文件夹安装，只批准会话权限。
3. 打开“聊天模式”面板，绑定已部署项目；选择使用 `host.storage` 持久化。
4. 进入该项目，通过原生“新建会话”创建聊天，确认 Agent 为 **Chat**，选择可用模型。

`default_agent` 提供默认值；OpenChamber 可能记住上次选择，必要时将项目默认智能体设为 `chat`。即使选择 Build 或 Plan，聊天目录策略仍禁止非聊天动作。OpenCode Go 是可选供应商。

面板使用官方 UI kit，订阅原生历史并通过 `host.openSession` 打开会话。它显示项目和 Agent 状态，不代表已检查有效策略。当前 SDK 的 `host.startSession` 不能指定 Agent，因此使用原生新建流程，没有伪造接口、增加本地服务或另一套对话界面。

## 功能与边界

- Agent 权限先拒绝全部，再放行四个动作；Location `tool.use` 策略独立拒绝其他动作。切换 Build 或添加宽松会话权限不应绕过该层。
- 局部插件设置 `codemode: false`，让四个工具直接可用，并在模型调用前删除其他工具定义。显示名为 **Chat**，内部标识不变。
- 计算器只接受两个最长 256 字符的十进制数，以及加、减、乘、除。decimal.js 使用 50 位有效数字和半偶数舍入；执行前调用原生权限检查。拒绝除零、非有限数与代码，不提供表达式求值器。
- 文字和图片附件沿用原生输入路径，与 `read` 权限分开；图片理解需要视觉模型。未实现通用 PDF 提取、图片生成与长期记忆工具。
- 搜索复用原生供应商；`random` 选择可用供应商，不是多引擎聚合。需要凭据时通过原生设置配置。

这是**模型与工具权限隔离，不是操作系统沙箱**。OpenCode 仍读取自己的配置并保存会话。可信插件代码具有宿主权限，不调用权限检查的插件代码不会被 Policy 自动沙箱化。更高优先级的全局、受管或 Console 策略可以覆盖 Location 策略，后加载的 Hook 也可能改变工具列表。会话移出聊天目录后不再受该目录策略保护。修改配置、插件或升级后须重新验收，不能以模型口头拒绝代替安全证据。

## 验证

详见[验证记录](docs/VALIDATION.md)。真实 OpenCode 二进制已通过出站工具清单、权限、计算器、附件传递、强制 Shell 调用拒绝和普通编程目录隔离测试。实际 Desktop 使用 `opencode-go/deepseek-v4.1-flash`、`high` 完成计算、网页读取和搜索；界面可见 Chat、聊天项目、面板和原生历史。图片只验证了测试模型的输入传递，尚未用真实视觉模型验收。本机运行记录留在 Git 忽略的 `.local/`。

## 更新、回滚与停用

再次运行构建、检查、部署即可更新。安装器拒绝覆盖无托管标记的目录、目标符号链接和被修改的托管文件，保留用户编辑。先备份并合并有意修改的配置，再升级。更新会将六个托管文件及标记备份到 `backups/<时间戳>/`。

回滚时关闭 OpenChamber，将选定备份中的六个文件及 `.chat-mode-install.json` 按原相对路径恢复，再打开 App。保持 `location` 路径不变以保留历史关联。停用时禁用/移除扩展，并从侧栏移除项目；保留目录可供之后重开，不要删除 OpenCode 数据库。

SDK 的 `engines.openchamber` 只表示最低版本，不是精确版本锁。部署命令检查 OpenChamber 2.4.0，插件检查 OpenCode 2.0.32；App 升级后需要重新验证兼容性。

实现使用 [OpenCode V2 Plugin](https://dev.opencode.ai/v2/docs/build/plugins/)、[Policy](https://dev.opencode.ai/v2/docs/policies/) 和 [OpenChamber SDK](https://docs.openchamber.dev/sdk/) 正式接口，不修改或 Fork 上游，不修改全局配置、不增加检索代理或 MCP。

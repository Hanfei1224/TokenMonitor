# Codex 额度读取渠道调研

- 调研日期：2026-08-31
- 目标：为 Windows + Electron 桌面磁贴选择 Codex 额度读取方式
- 初始结论：优先调用本机已登录的 `codex app-server --stdio`，不在 TokenMonitor 内读取或保存 Codex Token，也不把实际模型请求当作额度探针。后续产品决策改为由 TokenMonitor 自己完成 ChatGPT OAuth 登录，因此以下 app-server 建议保留为备选调研结果。

## 结论先行

1. **首选官方 app-server RPC。** 通过 JSONL/stdin/stdout 调用 `account/rateLimits/read`，由本机 Codex CLI 负责认证、账号选择和 Token 生命周期。官方支持 stdio；WebSocket 运输仍被标为 experimental/unsupported。[官方 app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
2. **额度 RPC 要求 ChatGPT backend 认证。** 官方 processor 在请求前检查 `auth.uses_codex_backend()`；未登录或 API key 认证都会返回错误，不能把 OpenAI API key 当作 ChatGPT/Codex 套餐额度凭证。[官方 account processor](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/account_processor.rs)
3. **不要默认直连私有接口。** `GET [chatgpt.com/backend-api/wham/usage](https://chatgpt.com/backend-api/wham/usage)` 确实是官方后端客户端在 ChatGPT backend-api 路由下使用的路径，但它不是面向第三方的公开稳定 API；协议或字段变化会直接影响应用。[官方 backend client](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client.rs) · [官方路径测试](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets_tests.rs)
4. **不要使用 `responses` probe。** `jasonmit/opencode-codex-usage` 会 POST 一个真实的 `reply ok` 模型请求，再从 SSE/响应头提取额度；这不是零消耗读取方式。[probe 源码](https://github.com/jasonmit/opencode-codex-usage/blob/main/lib/codex-usage-probe.ts)
5. **对当前项目，最小改动是在 Electron main process 增加 app-server 桥接。** 当前应用已经在主进程轮询供应商数据，Windows x64 打包也已存在；renderer 不应接触 Token 或子进程。[`src/main/usage.ts`](../../src/main/usage.ts) · [`src/main/index.ts`](../../src/main/index.ts) · [`src/electron-builder.yml`](../../src/electron-builder.yml)

## 官方接口

### 运输

官方 app-server 支持以下运输方式：

- `stdio`：默认方式，使用 newline-delimited JSON/JSONL。
- WebSocket：`--listen ws://...`，当前为 experimental/unsupported，不适合作为本项目的默认依赖。
- Unix socket：面向本地控制面客户端，Windows 桌面应用不需要采用它。

来源：[官方 app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) · [官方 app-server 文档](https://developers.openai.com/codex/app-server)

最小 RPC 顺序：

```text
initialize
initialized
account/read                 # 可选，读取登录状态和计划类型
account/rateLimits/read      # 读取额度窗口
```

请求本身不包含 Token。app-server 进程从 Codex 的现有认证配置加载凭证，调用方只消费 JSON-RPC 结果。Windows 方案 [CodexStatus](https://github.com/mmm1h/codex-status/blob/main/src/app_server.rs) 和 [Codex Usage Tray](https://github.com/alex-indi/codex-usage-tray/blob/main/src/codex_usage_tray/app_server.py) 都采用了这个模型。

### 认证边界

官方协议暴露的账户类型至少包括 `apiKey`、`chatgpt` 和 `amazonBedrock`。[账户协议源码](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/account.rs)

但 `account/rateLimits/read` 的实现有更严格的条件：

- 没有认证：返回 `codex account authentication required to read rate limits`。
- API key 或其他不使用 Codex backend 的认证：返回 `chatgpt authentication required to read rate limits`。
- ChatGPT/Codex backend 认证：创建官方 `BackendClient` 并读取额度。

来源：[官方 account processor](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/account_processor.rs) · [官方额度测试](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/suite/v2/rate_limits.rs)

### 返回字段

`account/rateLimits/read` 返回：

- `rateLimits`：兼容旧客户端的单个额度快照。
- `rateLimitsByLimitId`：按 `limitId` 区分的多个额度快照，当前默认主桶通常为 `codex`。
- `rateLimitResetCredits`：可选的 earned reset 数量和详情。
- `accountId`、`rateLimitUpsell`：后端在可用时提供。

每个 `RateLimitWindow` 包含：

- `usedPercent`
- `windowDurationMins`
- `resetsAt`，Unix timestamp seconds

因此客户端应优先使用 API 返回的窗口时长和重置时间，不要把所有 primary/secondary 桶硬编码为固定的 5 小时/7 天。来源：[官方响应协议](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/account.rs) · [RateLimitSnapshot schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/RateLimitSnapshot.ts) · [RateLimitWindow schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/RateLimitWindow.ts)

### 真实后端路径

官方 `BackendClient` 根据 base URL 选择路径：

- Codex API 风格：`/api/codex/usage`
- ChatGPT backend-api 风格：`/wham/usage`

当 base URL 包含 `/backend-api` 时，客户端选择 ChatGPT backend-api 风格。因此默认 ChatGPT 地址会形成 `https://chatgpt.com/backend-api/wham/usage`。`account/rateLimits/read` 还会并行尝试读取 `/rate-limit-reset-credits` 详情，失败时保留 usage 响应中的数量。[官方 backend client](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client.rs) · [官方 rate-limit 实现](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs) · [官方 account processor](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/account_processor.rs)

### Token 存储和刷新

官方 Codex 的认证存储不是单一固定文件：

- 文件模式使用 `$CODEX_HOME/auth.json`，其中可能包含 `tokens`、`OPENAI_API_KEY` 等敏感材料。
- keyring 模式使用系统 credential store；`auto` 模式优先 keyring，失败再回退文件。
- `auth.json` 的文件模式会写入 access token、refresh token、ID token 和 account ID。
- app-server 的 `account/rateLimits/read` 会获取当前认证；如果认证接近过期，官方 `AuthManager` 可能主动刷新并通过自己的存储后端持久化新 Token。

来源：[官方认证文档](https://developers.openai.com/codex/auth) · [官方 auth storage](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs) · [官方 AuthManager](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs)

这意味着：**TokenMonitor 不应读取、解析或保存 Token，但不能声称调用 app-server 永远不会导致 Codex 自己刷新凭证。** 这是两个不同的写入边界。

### 是否消耗额度

官方没有在 app-server 文档中承诺“读取额度绝对零消耗”。从源码可确认：`account/rateLimits/read` 走 GET usage/credits 读取路径，不启动 model turn；它与 `turn/start` 或 `/codex/responses` 的实际模型生成不同。[官方 app-server 文档](https://developers.openai.com/codex/app-server) · [官方 account processor](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/account_processor.rs) · [官方 rate-limit 实现](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)

产品文案应写成“**不发起模型生成请求**”，不要写成未经官方保证的“绝对不计费”。

## 候选项目对比

| 项目 | 数据通道 | 监控程序读 Token | 监控程序保存/刷新 Token | 模型额度风险 | Windows 适配 | 许可/维护信号（截至 2026-08-31） |
| --- | --- | --- | --- | --- | --- | --- |
| 官方 `codex app-server` | 本地 JSONL RPC | 否，交给 Codex CLI | app-server 可能按官方策略自动刷新并持久化 | 不启动 model turn；不承诺绝对零消耗 | **适合** | OpenAI Codex 官方仓库，Apache-2.0，持续发布 [仓库](https://github.com/openai/codex) · [最新 release](https://github.com/openai/codex/releases/latest) |
| [CodexBar](https://github.com/steipete/CodexBar) | OAuth API、CLI app-server、可选 Web | 是，OAuth 路径读取 `auth.json` | 自身不发布刷新 Token；CLI 路径可由 Codex CLI 刷新 | GET usage/CLI read，不是模型生成 | 不适合，主应用要求 macOS 14+ | MIT；v0.56.1，仓库近期仍有提交 [CodexBar release](https://github.com/steipete/CodexBar/releases/latest) |
| [codex-quota](https://github.com/deLiseLINO/codex-quota) | 直接 GET private `wham/usage` | 是，读取 Codex/OpenCode auth | **会**刷新，并同步写 managed/Codex/OpenCode 多处凭证 | 读取路径无模型 turn；刷新是认证操作 | Go 理论可构建，但未定位到 Windows 一等支持 | MIT；v0.5.1，维护节奏低于其他候选 [release](https://github.com/deLiseLINO/codex-quota/releases/latest) |
| [opencode-codex-usage](https://github.com/jasonmit/opencode-codex-usage) | OpenCode auth + models GET + responses POST | 读取 OpenCode `auth.json` | 不保存/刷新 Token；安装器只改 OpenCode 插件配置 | **会发起真实 `responses` 模型请求** | Node/OpenCode 可运行，但不是独立 tray | MIT；package v1.2.2，2026-08-29 有提交 [package](https://github.com/jasonmit/opencode-codex-usage/blob/main/package.json) |
| [CodexStatus](https://github.com/mmm1h/codex-status) | 本地官方 app-server RPC | 否 | 监控程序不处理 Token；Codex CLI 仍可能刷新 | 不启动模型 turn | **Windows 10/11 x64 一等支持** | MIT；v0.8.6 [release](https://github.com/mmm1h/codex-status/releases/latest) |
| [Codex Usage Tray](https://github.com/alex-indi/codex-usage-tray) | 本地官方 app-server RPC | 否 | 监控程序不处理 Token；Codex CLI 仍可能刷新 | 不启动模型 turn | **Windows 10/11 x64 一等支持** | MIT；v0.1.0，早期项目 [release](https://github.com/alex-indi/codex-usage-tray/releases/latest) |

## 候选项目核验

### CodexBar

- 默认 app source 优先使用 OAuth API，其次是 `codex -s read-only -a never app-server`；CLI RPC 顺序包含 `initialize`、`account/read`、`account/rateLimits/read`。[CodexBar Codex 文档](https://github.com/steipete/CodexBar/blob/main/docs/codex.md)
- OAuth 路径读取 `~/.codex/auth.json` 或 `$CODEX_HOME/auth.json`，对 `wham/usage` 发起 GET，并发送 Bearer 与可选 `ChatGPT-Account-Id`。[OAuth fetcher](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Providers/Codex/CodexOAuth/CodexOAuthUsageFetcher.swift)
- CodexBar 明确声明不会把刷新后的 native Token 发布回 `auth.json`；过期 native 凭证交给 Codex CLI 恢复，外部来源按只读处理。[Codex OAuth credentials](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Providers/Codex/CodexOAuth/CodexOAuthCredentials.swift) · [CodexBar Codex 文档](https://github.com/steipete/CodexBar/blob/main/docs/codex.md)
- 主应用是 macOS 14+ 菜单栏应用，不是 Windows 实现；其 CLI 有 macOS/Linux 构建，但不能直接解决 Windows tray UI。[CodexBar README](https://github.com/steipete/CodexBar/blob/main/README.md)

**借鉴价值：** fallback 顺序、超时/子进程清理、窗口动态字段映射。**不应照搬：** Electron 中直接扫描或维护第三方 `auth.json`。

### codex-quota

- `internal/api/client.go` 直接 GET `https://chatgpt.com/backend-api/wham/usage`，使用 Bearer 和 `ChatGPT-Account-Id`。[API client](https://github.com/deLiseLINO/codex-quota/blob/main/internal/api/client.go)
- 它扫描 OpenCode 的 `openai.access` 和 Codex 的 `tokens.access_token`，并支持从多个本地路径加载。[paths](https://github.com/deLiseLINO/codex-quota/blob/main/internal/config/paths.go) · [account loader](https://github.com/deLiseLINO/codex-quota/blob/main/internal/config/loader.go)
- 过期或未授权时会 POST 到 `https://auth.openai.com/oauth/token`；成功后 `SyncAccountEverywhere` 会把刷新后的凭证写入 managed store、Codex auth 和 OpenCode auth。[token refresh](https://github.com/deLiseLINO/codex-quota/blob/main/internal/auth/token.go) · [fetch flow](https://github.com/deLiseLINO/codex-quota/blob/main/internal/ui/fetch.go) · [sync](https://github.com/deLiseLINO/codex-quota/blob/main/internal/config/sync.go)
- README 只给出 Homebrew/Go 安装和 TUI 使用方式，没有把 Windows tray 作为产品边界；因此不适合作为本项目的直接 UI 基础。[README](https://github.com/deLiseLINO/codex-quota/blob/main/README.md)

**结论：** 能验证私有 GET 的字段形状，但凭证写入范围过大；不适合嵌入 TokenMonitor。

### opencode-codex-usage

- Windows 下默认读取 `%LOCALAPPDATA%\opencode\auth.json`，仅取 `openai.access` 和 `openai.accountId`。[auth path](https://github.com/jasonmit/opencode-codex-usage/blob/main/lib/auth-path.ts)
- 先 GET `.../codex/models` 选择模型，再 POST `.../codex/responses`，请求体包含 `reply ok`，并设置 `store: false`、`stream: true`；随后读取 SSE usage 和 `x-codex-*` 响应头。[probe](https://github.com/jasonmit/opencode-codex-usage/blob/main/lib/codex-usage-probe.ts)
- CLI 的文件写入只用于 OpenCode 插件安装/卸载和刷新信号文件，不是 Token 持久化；`loadCredentials` 本身只读 auth 文件。[CLI](https://github.com/jasonmit/opencode-codex-usage/blob/main/lib/codex-usage-cli.ts)
- README 将其定位为 OpenCode 插件，`/codex-usage` 可在没有 assistant turn 的情况下显示 toast，但底层 probe 仍会发送实际 Responses 请求。[README](https://github.com/jasonmit/opencode-codex-usage/blob/main/README.md)

**结论：** UI 集成思路可参考，probe 运输不能用于本项目的额度读取。

### CodexStatus

- 明确定位为 Windows tray，要求 Windows 10/11 x64 和已经登录的 Codex CLI 或 Codex app。[README](https://github.com/mmm1h/codex-status/blob/main/README.md)
- 每次刷新启动 `codex app-server --stdio`，发送 `initialize`、`account/read`、`account/rateLimits/read`，然后关闭进程树；实现没有读取 Codex credential file 的代码。[app-server client](https://github.com/mmm1h/codex-status/blob/main/src/app_server.rs)
- README 明确写出“不抓取 Token、不访问 private endpoints”，只把解析后的非敏感快照保存到 `%LOCALAPPDATA%`。[README](https://github.com/mmm1h/codex-status/blob/main/README.md)

**结论：** 是 Windows 原生 transport 和进程生命周期的最佳参考；其 Rust/Win32 UI 不应移植到 Electron。

### Codex Usage Tray

- 定位为 Windows 10/11 x64 portable tray，要求本机已安装并登录官方 Codex runtime。[README](https://github.com/alex-indi/codex-usage-tray/blob/main/README.md)
- 只启动 `codex app-server --stdio`，调用 `account/rateLimits/read`、`account/usage/read` 并监听 `account/rateLimits/updated`；不直接读取 Codex credential files。[README](https://github.com/alex-indi/codex-usage-tray/blob/main/README.md) · [app-server client](https://github.com/alex-indi/codex-usage-tray/blob/main/src/codex_usage_tray/app_server.py)
- 项目声明没有 telemetry、credential 或 usage history 收集；本地设置写入 `%LOCALAPPDATA%\CodexUsageTray\settings.json`。[README](https://github.com/alex-indi/codex-usage-tray/blob/main/README.md)

**结论：** 是 Python 版本的同一官方运输方案；可以参考请求/事件处理，但不需要为 Electron 引入 Python runtime。

## 初始实现建议（app-server 方案，未采用）

### 推荐流程

在 Electron main process 中实现一个最小的单次读取流程：

1. 用 Node `child_process.spawn` 启动本机 `codex`，参数为 `app-server`、`--stdio`；不要使用 shell，不要把 Token 放进参数、环境变量或 renderer IPC。
2. 通过 stdin 写 JSONL：`initialize`、`initialized`、`account/read`（`refreshToken: false`）和 `account/rateLimits/read`。
3. 从 stdout 按行解析 JSON，匹配 request id；只取 `rateLimits`/`rateLimitsByLimitId` 中的 `usedPercent`、`windowDurationMins`、`resetsAt`、`planType` 和必要的 credits。
4. 设置短超时；超时关闭 stdin 并杀掉子进程，避免后台留下 Codex 子进程。Windows 原生候选均采用短生命周期进程；[CodexStatus 实现](https://github.com/mmm1h/codex-status/blob/main/src/app_server.rs) 可作为参考。
5. 遇到 `chatgpt authentication required` 时显示“请先登录 Codex/ChatGPT”，不要回退到 API key 或实际模型 probe。

当前项目的 60 秒轮询已经集中在 `src/main/index.ts`，因此无需新建常驻后台服务；先把读取函数接入现有 `fetchMultiPlanUsage` 即可。[`src/main/usage.ts`](../../src/main/usage.ts) · [`src/main/index.ts`](../../src/main/index.ts)

### 初始方案明确不做

- 不读取 `$CODEX_HOME/auth.json`、OpenCode `auth.json` 或浏览器 cookie。
- 不实现 OAuth 登录、Token refresh、Token rotation 或账号切换；这些属于 Codex CLI/用户操作边界。
- 不调用 `account/rateLimitResetCredit/consume`，只读取额度。
- 不调用 `/codex/responses`、`turn/start` 或其他会产生模型输出的接口。
- 不把 `account/usage/read` 当作本地“今日 Token”来源；当前项目已有本地统计，官方 account usage 是另一种账号级活动数据。[官方账户协议](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/account.rs)

### 初始方案风险处理

- **CLI 不存在或路径不对：** 返回未配置状态，不自动下载或安装 Codex。
- **API key 登录：** 额度 RPC 会拒绝，文案应区分“API key 可调用模型”和“ChatGPT 套餐额度不可读”。
- **Token 自动刷新：** 说明是“TokenMonitor 不接触 Token”；若 Codex CLI 自己刷新并写入其存储，这是官方运行时行为。
- **协议变化：** 以官方 app-server schema 和 method 名称为准；对未知窗口保留原始时长和名称，不猜测窗口含义。
- **私有 endpoint 变化：** 仅作为调试 fallback，不作为默认生产通道；如果未来官方 app-server 不可用，应先重新核验官方协议，而不是静默复制新的网页请求。

## 后续产品决策：应用自助 OAuth

- 用户明确要求不依赖官方 Codex 客户端登录，由 TokenMonitor 直接打开 ChatGPT OAuth 网页完成授权。
- TokenMonitor 使用 PKCE 和本地回调，仅把 refresh token 通过 Electron `safeStorage` 加密保存；access token 只保留在主进程内存。
- 额度读取使用 `GET https://chatgpt.com/backend-api/wham/usage`，仅发起 usage GET，不发送模型生成请求；私有接口变化风险由 UI 错误状态暴露。

## 来源索引

### OpenAI 官方

- [Codex App Server 文档](https://developers.openai.com/codex/app-server)
- [Codex Authentication 文档](https://developers.openai.com/codex/auth)
- [app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [account processor](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/account_processor.rs)
- [rate-limit reset processor](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/account_processor/rate_limit_resets.rs)
- [account protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/account.rs)
- [rate-limit schemas](https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol/schema/typescript/v2)
- [backend client](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client.rs)
- [rate-limit backend client](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)
- [auth storage](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs)
- [auth manager](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs)

### 开源实现

- [steipete/CodexBar](https://github.com/steipete/CodexBar)
- [deLiseLINO/codex-quota](https://github.com/deLiseLINO/codex-quota)
- [jasonmit/opencode-codex-usage](https://github.com/jasonmit/opencode-codex-usage)
- [mmm1h/codex-status](https://github.com/mmm1h/codex-status)
- [alex-indi/codex-usage-tray](https://github.com/alex-indi/codex-usage-tray)

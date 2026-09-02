# Changelog

本项目的所有重要变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.3.4] - 2026-09-02

### Changed
- 将本地 SQLite 统计查询移至独立 Node worker，并改为按日期与模型聚合，避免大体积 OpenCode 数据库占用 Electron 主进程内存。
- JSONL 统计改为有界流式聚合，跳过未变化文件，并在退出时清理统计 worker 与定时器。
- 打包时内置独立 Node runtime，确保安装版仍可正常读取本地 SQLite 统计数据。
- 轮询请求改为单飞调度，超时会真实取消底层网络请求。

### Fixed
- 修复 OpenCode 数据库较大时主进程内存持续升高、占用达到 GB 级的问题。
- 修复多次手动刷新、保存配置或 OAuth 操作可能产生重叠请求的问题。
- 修复 Google OAuth 登录长期未完成时本地回调服务不释放的问题。
- 修复 ZCode 缺少模型名时统计归类不一致的问题。

## [1.3.3] - 2026-09-01

### Fixed
- 修复覆盖安装后 Electron `Local State` 未保留，导致 GPT 加密授权无法解密的问题。
- 升级时保留安装目录内的配置、统计缓存和 provider 缓存，避免更新后用量数据从空缓存开始。
- 修复置顶磁贴被 `Win+D` 显示桌面操作最小化到后台的问题。
- 主窗口和用量日历改为 Windows 工具窗口样式，隐藏任务栏按钮并继续通过托盘唤回。

## [1.3.1] - 2026-08-31

### Added
- **GPT（ChatGPT Plus / Pro）额度通道**：支持应用内 ChatGPT OAuth 登录，按账号套餐显示 `Plus`、`Pro 5x` 或 `Pro 20x` 及实际额度窗口，不依赖官方 Codex 客户端。
- GPT 授权使用 PKCE，本地仅通过 Electron `safeStorage` 加密保存 refresh token，access token 只在主进程内存中使用。

### Changed
- GPT 页面默认选中，页面标题改为 `GPT`，套餐标识统一使用绿色，并按官方 `plan_type` 针对性显示：`plus` 为 `Plus`、`prolite` 为 `Pro 5x`、`pro` 为 `Pro 20x`。
- 所有标准时间窗口统一为 `5H余额`、`本周余额`、`本月余额`；重置倒计时统一为 `X时X分` 或 `X天X时`。
- 发布配置仅保留 Windows x64 NSIS 安装版，移除绿色便携版构建目标。
- README、安装包文件名和版本号更新至 `1.3.1`。

### Fixed
- 增加 OAuth 登录超时、重复回调保护、额度响应格式校验和过期请求结果丢弃，避免登录或轮询状态卡死。
- 修复 NSIS 升级时清理旧安装目录导致 `config.json` 丢失的问题，并隔离开发版与安装版的配置文件。
- GPT 授权统一写入 `config.json`，首次启动时会迁移旧的 `codex-auth.dat` 并清理旧文件。
- 将 Electron 的 `userData` 固定到安装目录或开发版 `.dev-data`，避免程序数据散落到其他位置。

---

## [1.3.0] - 2026-08-30

### Added
- **品牌全新升级为 TokenMonitor**：从单一套餐监控升级为面向 Vibe Coding 的全能多源 AI 用量与配额桌面监控磁贴。
- **多通道 Coding Plan 自由轮播**：
  - **OpenCode Go**：支持 5 小时 / 本周 / 本月三环剩余额度与重置倒计时。
  - **DeepSeek 官方 API**：实时查询账户可用余额（如 `¥48.65`），以每日首次启动为基准动态计算今日消耗百分比。
  - **Google Gemini Pro**：支持 Google 官方 OAuth 网页一键授权登录，独立解析 **Gemini 模型池** 与 **Claude 模型池** 的真实剩余百分比与精确到秒的重置时间。
  - 支持左右微光箭头切换与指示点快速跳页，自动持久化记忆最后停留的通道。
- **精准 60 秒同步调度引擎**：以同时发出请求的时刻为严格时间基准点进行周期递进，消除时钟漂移与各自异步轮询的割裂感。
- **独立生命周期用量日历**：月度日历窗口按需创建居中展示，关闭时彻底销毁释放 Chromium DOM 及渲染上下文，后台常驻内存维持在 ~30MB 极低水平。
- **设置面板精准联动**：在未配置卡片点击“去配置”可直接定位并高亮打开对应的配置 Tab（OpenCode / DeepSeek / Gemini）。

### Changed
- **统一圆环视觉规范**：三大通道采用统一规格的高级发光圆环仪表盘（剩余模式统一展示“还剩百分之几”，DeepSeek 展示“今日消耗百分之几”）。
- **优化 Google 邮箱与重置时间排布**：邮箱采用自然换行去除被截断省略号，重置倒计时留足充足行高，彻底消除文字截断与缺失。
- **恢复 DirectComposition 硬件级 Alpha 通道混色**：移除禁用 GPU 参数，彻底解决 Windows 透明无边框窗口的黑框与失焦变黑闪烁问题。

### Fixed
- 修复打包版因 ESM 环境缺失 `__dirname`、无法初始化 `sql.js` 而长期显示旧统计缓存的问题。
- 将 `sql-wasm.wasm` 解包到真实文件系统并显式定位，开发版与安装版统一读取 SQLite 数据。
- 修复 JSONL 增量扫描重复累计历史记录，并让已打开的用量日历自动刷新最新缓存。

---

## [1.2.1] - 2026-08-19

### Changed
- 本地 token 统计扩展为 OpenCode、Claude Code、pi、ZCode、Codex 五数据源综合采集。
- main.py 拆分为 `core/` 多文件包（高内聚低耦合）。

## [1.2.0] - 2026-08-15

### Added
- 综合 token 采集装置：合并 opencode 本地库 + Claude Code 会话记录。
- 用量统计月份列表仅展示有消耗的月份。

## [1.1.3] - 2026-08-14

### Added
- 主窗口环图下方新增今日 token 统计分块。
- 新增每日 token 统计日期图独立窗口。

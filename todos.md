# TODOs

## 项目目标
- [x] 初始化 `free-codex` Electron + Vue 项目。
- [x] 使用 Electron + WebContentsView 集成 ChatGPT 网页。
- [x] 改为 Node.js 架构，不再依赖 `codex-mcp-go` / Go MCP。
- [x] 直接复用 `codex-mcp` 的 HTTP server、OAuth、downstream MCP hub 和 tools 能力。
- [ ] 打通 ChatGPT Remote MCP → Node `codex-mcp` → 下游 MCP 的完整公网调用链路。

## 当前进度
- [x] 完整移植 FreeHub 的 UI 技术栈（Tailwind v4 + shadcn-vue + lucide + vue-router + vue-sonner）与自定义标题栏。
- [x] 标题栏功能：项目选择面板（搜索 + 历史 + 打开文件夹）、设置页（MCP 服务器 / 技能 / 配置说明 三区块）、暗/亮主题切换（localStorage 持久化 + 主进程向 ChatGPT 注入 CSS 同步）、窗口控制（min/max/close + 最大化状态）。
- [x] 项目管理：`~/.free-codex/projects.json` 历史（20 条）+ 激活项目持久化 `config.projectRoot` 并同步网关（运行中返回警告）。
- [x] MCP 服务器管理：读写 `~/.codex-mcp/mcp.json`（`mcp:list/set/delete`）。
- [x] 技能管理：扫描 `~/.agents/skills` + 项目 `.agents/skills`（`skills:list/create/update/delete/read/setEnabled`，开关存 `~/.freehub/skill-overrides.json`）。
- [x] ChatGPT 视图显隐控制：`browser:hideViews/hideForOverlay/showActiveView`（设置页/浮层时挂载卸载原生视图）。
- [x] Ctrl+R 拦截（主窗口 + ChatGPT 视图）→ 打开项目选择面板。
- [x] 右面板精简为 Tools / Logs 两页（下游 MCP 工具 + 实时日志）。
- [x] codex-mcp 配置体系归 Free Codex 自持：不再读写 `~/.codex-mcp/config.json` / `mcp.json`，全部配置存入 `userData/config.json`（`autoStart` / `ui` / `mcpServers` / `tunnelName` 等），旧 mcp.json 启动时一次性迁移。
- [x] NodeMcpGateway 重构：不读 codex-mcp 配置，下游 hub / UI 偏好 / goal 存储全部注入 free-codex 配置；本地模式无需密码直接启动，公网模式缺域名/Tunnel 明确报错。
- [x] 设置页完整可视化：连接配置（Host/Port）、公网配置（域名/cloudflared/Tunnel）、ChatGPT 界面偏好（工具/状态卡片）、连接密码（OAuth）、自动启动开关、下游服务器管理。
- [x] Gateway 自动启动：应用启动时若 `autoStart && projectRoot` 自动拉起（已实测重启后自动运行）。
- [x] @ 文件触发：chatView preload 注入 MENTION_SCRIPT（输入 @ 检测 + `__freehubInsertText`），FilePalette 选择后插入 `@file:相对路径`。
- [x] / 技能触发：消息开头输入 / 打开 SkillPalette，选择后插入 `/skill:名称`。
- [x] Diff：HTTP 层旁路拦截 tools/call（monkey-patch res.write/end 捕获 SSE 响应），从引擎 `structuredContent.diff` 提取 unified diff；RightPanel 新增 Diff 页 + DiffViewer，支持整文件撤回/确认。
- [x] Webview 代理：设置页新增「Webview 代理」区块（启用开关 + 代理地址），`session.setProxy` 应用，修改后自动刷新 ChatGPT 页面（已实测生效与持久化）。
- [x] Electron 宿主与 ChatGPT WebContentsView 已保留。
- [x] `free-codex` 通过 `file:../codex-mcp` 依赖本地 Node `codex-mcp`。
- [x] 新增 `NodeMcpGateway`，直接在 Electron 主进程内创建 `codex-mcp` HTTP server。
- [x] 直接复用 `DownstreamMcpHub`，从 `~/.codex-mcp/mcp.json` 发现并连接下游 MCP。
- [x] 直接复用 `codex-mcp` 的 Streamable HTTP、OAuth 和 CloudflaredSidecar 实现。
- [x] 去掉原来的 Go client + 手写 MCP Proxy 链路；旧文件仅保留兼容导出，不再参与运行时。
- [x] MCP 页面改为 Node Gateway 配置，并展示下游 MCP 工具。
- [x] `npm install` 完成依赖安装。
- [x] `npm run build` 通过。
- [x] `npm start` 冒烟启动通过；当前环境只出现 Electron cache/GPU cache 权限警告，没有再出现 ESM 加载崩溃。
- [ ] 完成真实 ChatGPT Remote MCP OAuth 登录/授权验证。
- [ ] 完成 Cloudflare Named Tunnel 公网端到端验证。
- [x] Tool 调用拦截（Tools 面板实时记录、按会话归属）、Diff UI（整段撤销/撤回/确认）、实时 Logs 已完成。
- [ ] Permission UI（引擎权限审批弹窗 + 授权管理）未集成：codex-mcp PermissionManager 以空配置创建，无审批界面。
- [x] 打包安装包验证：release/Free Codex-0.1.0-Setup.exe 已产出，npm run dist:dir 构建链路验证通过。

## 约束
- 本项目不启用 Goal 模式。
- 优先在 `free-codex` 项目目录内实现。
- MCP 核心实现使用 Node.js `codex-mcp`，不再引入 Go MCP 服务。

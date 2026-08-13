# codex-mcp v0.7.0 → free-codex 迁移评估

> 生成于 2026-08-13。目的：列出新下载的 codex-mcp v0.7.0 的全部能力，
> 标注 free-codex 已集成 / 未集成，供选择迁移。在下方勾选要迁移的项。

## 一、codex-mcp v0.7.0 概览

纯 Node.js MCP server（无 Electron/GUI 代码）：
CLI 注册项目 → 单实例守护进程（daemon）→ Express 承载 MCP（Streamable HTTP）
+ 内置 OAuth（Argon2id + PKCE + private_key_jwt）+ Cloudflare Tunnel 侧车。
共注册 **62 个 MCP 工具**。运行时依赖 Node >= 22。

## 二、已集成到 free-codex 的能力 ✅

| 能力 | 集成方式 |
|---|---|
| HTTP 网关 / MCP server | `src/main/mcp-gateway.ts` 动态 import + `createHttpServer` |
| OAuth 连接密码 | `src/main/auth.ts` 封装 password-store（has/set/generate） |
| 下游 MCP 服务器 | `DownstreamMcpHub` 注入 + 设置页增删改 |
| 内置工具清单 | `registerAllTools` 探针 + RightPanel Tools 页 |
| Cloudflare Tunnel | `CloudflaredSidecar` + 一键向导（cloudflared 自动下载） |
| UI 偏好 | `UiSettingsStore` 注入 |
| goal 存储目录 | `goalStorageDir` 注入 `userData/goals`（仅存储，无 UI） |
| diff 拦截 | HTTP 旁路抓取 `structuredContent.diff` + DiffViewer 撤回/确认 |

## 三、未集成、可迁移的候选 ⬜

### 1. 权限审批系统（推荐优先）
- codex-mcp 侧：`src/permissions/`（types / manager / runtime / store），
  工作区外 write/exec 授权，档位 once / session / permanent。
- 现状：`createHttpServer` **未注入 `permissionStore`**，会回落到 `~/.codex-mcp/config.json`，
  与"配置归 free-codex 自持"的约束冲突，且应用内无审批 UI。
- 迁移：注入 `permissionStore`（内存/自持配置）+ 权限审批弹窗 + 授权管理界面。
- 依据：`todos.md` 明确待办「完善 Diff / **Permission UI**」。
- [ ] 迁移

### 2. 引擎侧 Skills 注册
- 现状：`/skill:名称` 只是纯文本插入；`createHttpServer` 未传 `skills` 选项，
  引擎侧 `SkillRegistry` 为空（http-server.ts 用 `SkillRegistry.empty()`）。
- 迁移：`SkillRegistry.discover([用户级, 项目级])` 注入网关，ChatGPT 才能真正调用技能。
- [ ] 迁移

### 3. 多项目 daemon 绑定
- codex-mcp 侧：`src/daemon/`（control/state）、`src/projects/`（registry/bindings）、
  `src/server/project-router.ts`（会话绑定）、`workspace_projects` 工具。
- 现状：free-codex 是「单活跃项目」模型（projectRoot = 网关 cwd），未用多项目注册/绑定。
- 迁移：项目注册表 + 会话绑定 + workspace_projects 工具（改动较大）。
- [ ] 迁移

### 4. 外部能力来源（capabilities）
- codex-mcp 侧：`src/capabilities/`，来源 Agent Skills / Codex / Claude Code，
  MCP + Skills 探测，watch 热刷新（400ms 防抖）。
- 现状：free-codex 只自己扫描 `~/.agents/skills` + 项目 `.agents/skills`。
- 迁移：探测导入 Codex / Claude Code 的 MCP 与 Skills。
- [ ] 迁移

### 5. Goals 管理 UI ⚠️ 与现约束冲突
- codex-mcp 侧：`src/goals/store.ts` + goal_* 工具（start/status/update/verify/finish/cancel），
  按项目持久化，finish 强制任务全过。
- 现状：`goalStorageDir` 已注入但无 UI；`todos.md` 约束「**本项目不启用 Goal 模式**」。
- 迁移需先确认改掉该约束。
- [ ] 迁移（需改 todos 约束）

### 6. managed tools 管理 UI
- codex-mcp 侧：`src/managed-tools/`（ripgrep 15.2.0 / cloudflared 的下载+sha256+原子替换）。
- 现状：仅 Tunnel 向导内部调用 `ensureManagedTool('cloudflared')`，无通用管理界面。
- 迁移：安装/版本管理页面。
- [ ] 迁移

### 7. doctor + 自动更新
- codex-mcp 侧：`src/doctor/`（环境诊断 index + update）。
- 现状：free-codex 无诊断入口、无自更新。
- 迁移：环境诊断面板 + 应用自更新。
- [ ] 迁移

### 8. 其它零散项
- 只读 git 工具、process 托管、search（ripgrep 回退）等：
  free-codex 通过注入工具清单**已经暴露给 ChatGPT**，无需额外迁移。
- 遥测/审计日志设计（不记录敏感内容）可作为日志增强参考。
- [ ] 迁移

## 四、环境注意事项

- `node_modules/codex-mcp` 是指向 `../codex-mcp` 的软链；当前克隆的 v0.7.0
  **源码仓库还没有 `dist/`**（动态 import 会失败），需先在 codex-mcp 里 `npm run build`。
- free-codex 通过 `new Function('s', 'return import(s)')` 动态加载 codex-mcp，
  主进程打包时不会 bundle 它；electron-builder 默认把 node_modules 打进 asar。

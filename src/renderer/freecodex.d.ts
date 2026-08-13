/**
 * renderer 侧 window.freeCodex API 类型声明
 * （与 src/preload/index.ts 暴露的接口一一对应）
 */

// ---------- 项目（Project）----------

/** 历史项目条目 */
export interface ProjectInfo {
  path: string
  name: string
  lastOpened: number
}

/** 项目状态（active 为当前激活的项目绝对路径） */
export interface ProjectState {
  active: string | null
  history: ProjectInfo[]
}

/** 项目动作结果（打开/激活） */
export interface ProjectActionResult {
  ok: boolean
  /** 用户取消了文件夹选择 */
  canceled?: boolean
  /** 非致命警告（如网关重启失败） */
  error?: string
  /** 网关应用新项目配置的结果（运行中切换项目会自动重启使其立即生效） */
  gateway?: GatewayReloadResult
  state?: ProjectState
}

// ---------- 配置 / 网关 ----------

export interface FreeCodexConfig {
  projectRoot: string
  /** 应用启动时自动拉起 Gateway */
  autoStart: boolean
  gateway: {
    projectRoot: string
    host: string
    port: number
    publicEnabled: boolean
    domain: string
    cloudflaredBin: string
    tunnelId: string
    tunnelName: string
    tunnelConfigPath: string
  }
  cloudflare: {
    enabled: boolean
    executable: string
    hostname: string
    tunnelId: string
    configPath: string
  }
  /** ChatGPT 侧自定义 UI 偏好 */
  ui: {
    tools: boolean
    status: boolean
  }
  /** Webview（ChatGPT 视图）代理 */
  proxy: {
    enabled: boolean
    url: string
  }
  /** 会话清理配置（临时清理保留条数 / 自动清理） */
  chatCleanup: ChatCleanupSettings
  /** 内置工具启用/禁用（禁用后不注册，ChatGPT 连接器不再暴露该工具） */
  toolEnablement: {
    /** 禁用的内置工具短名列表（默认空 = 全部启用） */
    disabledTools: string[]
  }
  /** todos 模式（进程内下游 server + 每轮注入快照 + 未更新提醒） */
  todos: {
    /** 是否启用（启用时启动 todos server 并注入 mcpServers.todos） */
    enabled: boolean
  }
  /** 下游 MCP 服务器（free-codex 自持，不再用 ~/.codex-mcp/mcp.json） */
  mcpServers: Record<string, McpServerEntry>
}

// ---------- todos ----------

/** 任务状态（与 todos-server.ts 一致） */
export type TodosStatus = 'pending' | 'in_progress' | 'done'

/** 单个任务 */
export interface TodosItem {
  id: string
  title: string
  details?: string
  status: TodosStatus
  note?: string
  createdAt: number
  updatedAt: number
}

/** 一个对话的清单 */
export interface TodosList {
  objective?: string
  items: TodosItem[]
  status: 'active' | 'completed' | 'cancelled'
  summary?: string
  cancelReason?: string
  createdAt: number
  updatedAt: number
}

/** todos 状态（右面板 Tab + 事件推送） */
export interface TodosState {
  enabled: boolean
  convId: string | null
  list: TodosList | null
}

// ---------- 会话清理 ----------

/** 对话列表条目（真实删除用） */
export interface ConversationEntry {
  id: string
  title: string
  createTime: number
  updateTime: number
}

/** 会话清理配置 */
export interface ChatCleanupSettings {
  /** 临时清理时保留的最新消息条数 */
  trimKeep: number
  /** 自动清理：消息数超过保留数时自动删旧 DOM（防卡顿） */
  autoTrim: boolean
}

/** 下游 MCP 工具 */
export interface McpToolInfo {
  name: string
  description: string
  server: string
}

/** 网关状态快照 */
export interface GatewayStatus {
  endpoint: string
  publicUrl: string
  running: boolean
  tools: McpToolInfo[]
  servers: unknown[]
}

/** 网关事件（Logs 面板） */
export interface GatewayEvent {
  direction: 'system' | 'request' | 'response'
  method: string
  payload?: unknown
  at: number
}

// ---------- 工具调用记录（Tools 面板按当前对话区分）----------

/** 单次工具调用状态 */
export type ToolCallStatus = 'pending' | 'ok' | 'error'

/** 单次工具调用记录 */
export interface ToolCallRecord {
  /** 全局自增序号 */
  id: number
  /** MCP 会话标识（请求头 mcp-session-id） */
  sessionId: string
  /** 工具名（短名） */
  tool: string
  /** 调用参数键 */
  argsKeys: string[]
  /** 完整调用参数（UI 折叠展示） */
  args?: Record<string, unknown>
  /** 发起时间戳 */
  at: number
  status: ToolCallStatus
  /** 耗时（ms，响应后才有） */
  durationMs?: number
  /** 工具返回结果（成功）或错误详情（失败），UI 折叠展示 */
  result?: unknown
}

/** 某 MCP 会话的工具调用（convId 为该会话归属的对话 ID，null = 新会话/未关联） */
export interface ConversationToolSession {
  convId: string | null
  calls: ToolCallRecord[]
}

/** 工具调用快照（tools:calls） */
export interface ToolCallsSnapshot {
  /** 当前对话 ID（null = 首页/新会话） */
  currentConvId: string | null
  /** sessionId → 会话调用（最新在前） */
  sessions: Record<string, ConversationToolSession>
  /** 全量平铺（最新在前，上限 200） */
  recent: ToolCallRecord[]
}

// ---------- MCP 服务器管理（~/.codex-mcp/mcp.json）----------

/** 下游 MCP 服务器配置项（stdio 或 http 二选一） */
export interface McpServerEntry {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  /** 是否在禁用名单中（list 时从 disabledServers 推导） */
  disabled?: boolean
}

export interface McpListResult {
  mcpServers: Record<string, McpServerEntry>
  /** mcp.json 绝对路径 */
  path: string
  /** 系统 MCP（不可删除，仅开关；如 todos 任务清单） */
  system: Array<{
    name: string
    enabled: boolean
    description: string
  }>
}

// ---------- 技能（~/.agents/skills + 项目 .agents/skills）----------

export interface SkillEntry {
  name: string
  description: string
  /** SKILL.md 正文 */
  instructions: string
  scope: 'user' | 'project'
  path: string
  enabled: boolean
  /** 解析失败信息（如缺 name），仅展示不阻断 */
  invalid?: string
}

export interface SkillLibraryResult {
  skills: SkillEntry[]
  userDir: string
  projectDir: string | null
  projectRoot: string | null
}

// ---------- @ 文件 / / 技能 触发 ----------

export interface ProjectFileEntry {
  path: string
  relPath: string
  name: string
}

export interface ProjectFileListResult {
  files: ProjectFileEntry[]
  noProject: boolean
}

export interface InsertFileReferenceResult {
  ok: boolean
  error?: string
}

// ---------- Diff ----------

/** diff 行类型：新增 / 删除 / 上下文 */
export type DiffLineType = 'add' | 'del' | 'ctx'

export interface DiffLine {
  type: DiffLineType
  text: string
}

/** 文件 diff 块（unified 格式，含起始行号） */
export interface DiffHunk {
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

/** 引擎工具调用产生的文件变更记录（展示用，不含内部 before/absPath） */
export interface FileDiffRecord {
  id: string
  /** 项目内相对路径 */
  path: string
  /** 工具名（如 edit / apply_patch） */
  toolName: string
  /** unified diff 文本（撤销重算后为最新） */
  diffText: string
  /** 按 hunk 解析（DiffViewer 行号 / 整段撤销用） */
  hunks: DiffHunk[]
  additions: number
  deletions: number
  timestamp: number
}

/** 整段撤销请求 */
export interface DiffHunkUndoRequest {
  /** 变更记录 id */
  id: string
  /** 所在 hunk 下标 */
  hunkIndex: number
}

/** 整段撤销结果（diff 为 null 表示该文件已完全恢复原状，应移除记录） */
export interface DiffHunkUndoResult {
  ok: boolean
  error?: string
  diff?: FileDiffRecord | null
}

// ---------- ChatGPT 连接器 ----------

/** 新会话注入内容开关（每会话首条请求注入的上下文块） */
export interface InjectionSettings {
  /** 注入项目路径（相对路径解析基准） */
  projectPath: boolean
  /** 注入项目根目录 AGENTS.md（默认开；文件不存在则不注入） */
  agentsMd: boolean
  /** 注入项目根目录 CLAUDE.md（默认关；文件不存在则不注入） */
  claudeMd: boolean
  /** 自动在对话中激活 mycodex 插件（fetch 层自动 @提及，默认开） */
  autoSelectPlugin: boolean
  /** skills 注入开关（skill 名 → 是否注入；未配置视为开） */
  skills: Record<string, boolean>
}

/** 已安装插件条目（ps/plugins/installed） */
export interface InstalledPlugin {
  id: string
  name: string
  canonicalAppId: string
  status: string
  installedAt?: string
  /** 目录里的显示名（ChatGPT 界面展示的 MCP 名字；内部名是 dev-<appid>） */
  displayName?: string
}

// ---------- Toast 桥（主窗口 → overlay 子窗口）----------

/** 主窗口请求渲染的 toast 内容 */
export interface ToastBridgeInput {
  type: 'success' | 'error' | 'warning' | 'info' | 'message'
  title: string
  description?: string
}

// ---------- 一键创建 Cloudflare Tunnel ----------

/** 一键 Tunnel 向导进度日志 */
export interface TunnelProgressEvent {
  kind: 'info' | 'success' | 'warning' | 'error'
  /** 阶段标识：resolve-bin / login / tunnel / dns / write-config */
  step: string
  message: string
}

/** 一键 Tunnel 向导确认问题（渲染层弹确认框，answerTunnelAsk 回传） */
export interface TunnelAsk {
  id: number
  question: string
  defaultValue: boolean
}

/** 配置保存后 Gateway 的重载结果（运行中 → 自动重启） */
export interface GatewayReloadResult {
  /** 保存时 Gateway 是否在运行（运行中 → 已自动重启） */
  restarted: boolean
  /** 重启后的入口 URL（公网或本地） */
  url?: string
  /** 重启失败原因（配置已保存，但 Gateway 未恢复运行） */
  restartError?: string
}

/** 一键 Tunnel 向导结果 */
export interface TunnelSetupResult {
  domain: string
  cloudflaredBin: string
  tunnelId: string
  tunnelName: string
  /** 写好的 cloudflared.yml 路径 */
  configPath: string
  /** 配置写回后 Gateway 的重载结果（运行中自动重启） */
  gateway?: GatewayReloadResult
}

// ---------- 窗口控制 ----------

export interface FreeCodexWindowControls {
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  /** 订阅最大化状态变化，返回取消订阅函数 */
  onMaximizedChange: (cb: (maximized: boolean) => void) => () => void
}

// ---------- API 聚合 ----------

export interface FreeCodexApi {
  getConfig: () => Promise<FreeCodexConfig>
  /** 保存配置；若 Gateway 运行中会自动停止→应用→重启 */
  saveConfig: (config: FreeCodexConfig) => Promise<GatewayReloadResult>
  /** 运行中可改：自动启动开关（仅影响下次启动） */
  setAutoStart: (value: boolean) => Promise<void>
  /** 运行中可改：ChatGPT UI 偏好（引擎即时生效） */
  saveUi: (ui: { tools?: boolean; status?: boolean }) => Promise<{ tools: boolean; status: boolean }>
  /** 应用 Webview 代理（保存 + 应用 + 刷新 ChatGPT 页面） */
  applyProxy: (proxy: { enabled: boolean; url: string }) => Promise<{ ok: boolean }>
  start: () => Promise<string>
  stop: () => Promise<void>
  status: () => Promise<GatewayStatus>
  /** OAuth 连接密码管理（封装 codex-mcp password-store） */
  auth: {
    hasPassword: () => Promise<boolean>
    setPassword: (password: string) => Promise<{ ok: boolean }>
    generatePassword: () => Promise<string>
  }
  /** 旧版原生文件夹选择器（保留兼容，UI 改用 projects.openFolder） */
  chooseProject: () => Promise<string | null>
  reloadChat: () => Promise<void>
  setPanelCollapsed: (collapsed: boolean) => Promise<void>
  /** 设置 ChatGPT 页面主题（主程序亮/暗主题切换时注入 CSS 同步） */
  setTheme: (dark: boolean) => Promise<{ ok: boolean }>
  /** 隐藏全部平台视图（进入应用页面时调用） */
  hideViews: () => Promise<void>
  /** 浮层（对话框）弹出前隐藏平台视图；返回 true 表示关闭浮层后需恢复 */
  hideForOverlay: () => Promise<boolean>
  /** 浮层关闭后恢复临时隐藏的视图 */
  showActiveView: () => Promise<void>
  /** 订阅"打开项目选择面板"通知（Ctrl+R 快捷键触发），返回取消订阅函数 */
  onOpenProjectPalette: (cb: () => void) => () => void
  /** 订阅"打开文件命令面板"通知（页面输入 @ 触发） */
  onOpenFilePalette: (cb: () => void) => () => void
  /** 订阅"打开技能选择面板"通知（页面消息开头输入 / 触发） */
  onOpenSkillPalette: (cb: () => void) => () => void
  /** 列出当前激活项目的文件（无项目时 noProject=true） */
  listProjectFiles: () => Promise<ProjectFileListResult>
  /** 把文件引用文本插入 ChatGPT 输入框（替换触发的 @） */
  insertFileReference: (text: string) => Promise<InsertFileReferenceResult>
  /** 把 /skill:名称 插入 ChatGPT 输入框（替换触发的 /） */
  insertSkillTrigger: (name: string) => Promise<InsertFileReferenceResult>
  /** 订阅引擎工具调用产生的文件 diff */
  onFileDiff: (cb: (record: FileDiffRecord) => void) => () => void
  /** 订阅网关事件（Logs 面板），返回取消订阅函数 */
  onMcpEvent: (cb: (event: GatewayEvent) => void) => () => void
  /** 工具调用快照（会话分组 + 归属对话 + 当前对话 ID），Tools 面板按当前会话过滤 */
  getToolCalls: () => Promise<ToolCallsSnapshot>
  /** 订阅工具调用发起/完成（实时刷新 Tools 面板），返回取消订阅函数 */
  onToolCall: (cb: (info: { record: ToolCallRecord; direction: 'start' | 'done' }) => void) => () => void
  /** 订阅当前对话切换（刷新 Tools 面板），返回取消订阅函数 */
  onConversationChanged: (cb: (info: { convId: string | null }) => void) => () => void
  listDiffs: () => Promise<FileDiffRecord[]>
  revertDiffFile: (id: string) => Promise<{ ok: boolean; error?: string }>
  confirmDiffFile: (id: string) => Promise<{ ok: boolean; error?: string }>
  /** 整段撤销（恢复该 diff 块为原内容并重算 diff；diff 为 null 表示文件已恢复原状） */
  undoDiffHunk: (request: DiffHunkUndoRequest) => Promise<DiffHunkUndoResult>
  /** 订阅 diff 记录更新（整段撤销后重算），返回取消订阅函数 */
  onDiffUpdated: (cb: (record: FileDiffRecord) => void) => () => void
  /** ChatGPT 连接器（开发者模式 + 插件安装自动化，主进程 net.fetch 走会话代理） */
  chatgpt: {
    /** ChatGPT 登录状态（token 捕获 + /me 验证；插件操作前需已登录） */
    loginStatus: () => Promise<{ loggedIn: boolean; reason?: string }>
    /** 未登录时引导登录：导航 ChatGPT 视图到首页（自动跳登录页） */
    openLogin: () => Promise<{ ok: boolean; error?: string }>
    /** 开发者模式状态（developerMode + lockdownMode） */
    devModeStatus: () => Promise<{ developerMode: boolean; lockdownMode: boolean }>
    /** 确保开发者模式开启（未开启则自动开启） */
    ensureDevMode: () => Promise<{ ok: boolean; developerMode: boolean; message?: string }>
    /** 已安装插件列表 */
    plugins: () => Promise<InstalledPlugin[]>
    /** 按 URL/名称/AppId 查找已安装插件 */
    findPlugin: (by: { url?: string; name?: string; appId?: string }) => Promise<InstalledPlugin | null>
    /** 探测 MCP URL 的 OAuth 配置（安装前置步骤，不实际安装） */
    probeMcp: (url: string) => Promise<{ oauthRequired: boolean; raw: string }>
    /** 列出最近对话（真实删除用） */
    conversations: (limit?: number) => Promise<ConversationEntry[]>
    /** 真实删除一条对话（不可恢复） */
    deleteConversation: (id: string) => Promise<{ ok: boolean; status?: number; error?: string }>
    /** 真实删除全部对话 */
    deleteAllConversations: (limit?: number) => Promise<{ ok: number; failed: number; error?: string }>
    /** 临时清理当前会话 DOM（保留最新 keep 条，防卡顿） */
    trimConversation: (keep?: number) => Promise<{ ok: boolean; removed?: number; total?: number }>
  }
  /** 新会话注入内容（项目路径 / 插件名 / AGENTS.md / CLAUDE.md / skills 开关） */
  injections: {
    get: () => Promise<InjectionSettings>
    save: (patch: Partial<InjectionSettings>) => Promise<InjectionSettings>
  }
  /** 会话清理配置（保留条数 / 自动清理） */
  chatCleanup: {
    save: (patch: Partial<ChatCleanupSettings>) => Promise<ChatCleanupSettings>
  }
  /** 内置工具启用/禁用（保存后网关自动重启，禁用工具从 tools/list 消失） */
  toolEnablement: {
    save: (disabledTools: string[]) => Promise<{ disabledTools: string[]; restarted?: boolean; url?: string; restartError?: string }>
  }
  /** todos 模式（进程内下游 server + 软强制注入） */
  todos: {
    /** 当前状态（enabled + 当前对话清单） */
    get: () => Promise<TodosState>
    /** 开关 todos 模式（启停 server + 重启网关），返回最新状态 */
    setEnabled: (enabled: boolean) => Promise<TodosState & GatewayReloadResult>
    /** 手动改当前对话某任务状态 */
    updateItem: (itemId: string, status: TodosStatus) => Promise<TodosState>
    /** 清空当前对话清单 */
    reset: () => Promise<TodosState>
  }
  /** 订阅 todos 状态变更（开关 / 清单变化 / 工具调用打点），返回取消订阅函数 */
  onTodosChanged: (cb: (state: TodosState) => void) => () => void
  /** 主窗口请求在 overlay 子窗口打开 diff 详情 */
  openDiff: (record: FileDiffRecord) => Promise<void>
  /** overlay 子窗口订阅"打开 diff 详情"，返回取消订阅函数 */
  onOpenDiff: (cb: (record: FileDiffRecord) => void) => () => void
  /** 主窗口订阅 diff 已被撤回/确认（移除列表项），返回取消订阅函数 */
  onDiffRemoved: (cb: (id: string) => void) => () => void
  /** 主窗口请求打开项目选择面板（overlay 子窗口内） */
  openProjectPalette: () => Promise<void>
  /** 主窗口订阅项目激活完成（刷新标题栏项目名），返回取消订阅函数 */
  onProjectChanged: (cb: (state: ProjectState) => void) => () => void
  /** overlay 子窗口订阅主题同步，返回取消订阅函数 */
  onTheme: (cb: (dark: boolean) => void) => () => void
  /** overlay 子窗口上报当前交互模式（none / toast / modal），主进程据此切换穿透 */
  setOverlayState: (mode: 'none' | 'toast' | 'modal') => void
/** overlay 子窗口上报鼠标是否悬停在 toast 上（决定是否临时放开鼠标穿透） */
  setOverlayInteractive: (interactive: boolean) => void
  /** 主窗口请求在 overlay 渲染一个 toast（主窗口没有 Toaster） */
  toast: (input: ToastBridgeInput) => void
  /** overlay 子窗口订阅主窗口发来的 toast，返回取消订阅函数 */
  onToast: (cb: (input: ToastBridgeInput) => void) => () => void
  windowControls: FreeCodexWindowControls
  projects: {
    /** 当前项目状态（active + history） */
    get: () => Promise<ProjectState>
    /** 打开已有文件夹并激活为当前项目 */
    openFolder: () => Promise<ProjectActionResult>
    /** 激活历史中的指定项目 */
    activate: (path: string) => Promise<ProjectActionResult>
  }
  /** MCP 服务器管理（读写 ~/.codex-mcp/mcp.json） */
  mcp: {
    list: () => Promise<McpListResult>
    /** 批量保存全部服务器配置（写 mcp.json，运行中自动重启网关） */
    save: (config: FreeCodexConfig) => Promise<McpListResult & GatewayReloadResult>
    set: (name: string, server: McpServerEntry) => Promise<McpListResult & GatewayReloadResult>
    delete: (name: string) => Promise<McpListResult & GatewayReloadResult>
  }
  /** 一键创建 Cloudflare Tunnel 向导 */
  startTunnelSetup: (input: { domain: string; tunnelName: string }) => Promise<TunnelSetupResult>
  /** 回答向导确认问题（id 来自 onTunnelAsk） */
  answerTunnelAsk: (id: number, approved: boolean) => Promise<unknown>
  /** 取消进行中的向导 */
  cancelTunnelSetup: () => Promise<void>
  /** 订阅向导进度日志，返回取消订阅函数 */
  onTunnelProgress: (cb: (event: TunnelProgressEvent) => void) => () => void
  /** 订阅向导确认问题，返回取消订阅函数 */
  onTunnelAsk: (cb: (ask: TunnelAsk) => void) => () => void
  /** 技能管理（~/.agents/skills + 项目 .agents/skills） */
  skills: {
    list: () => Promise<SkillLibraryResult>
    /** 读取技能正文（SKILL.md 指令） */
    read: (name: string) => Promise<{ instructions: string }>
    create: (input: { name: string; description: string; instructions: string }, scope: 'user' | 'project') => Promise<void>
    update: (name: string, patch: { description?: string; instructions?: string }) => Promise<void>
    delete: (name: string) => Promise<void>
    setEnabled: (names: string[], enabled: boolean) => Promise<void>
  }
  /** 技能面板关闭（未选中技能）→ 主进程把被拦截的消息开头 / 写回 ChatGPT 输入框 */
  skillPaletteClosed: () => void
}

declare global {
  interface Window {
    freeCodex: FreeCodexApi
    electronAPI?: {
      platform: string
    }
  }
}

export {}

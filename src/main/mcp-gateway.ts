import { app } from 'electron'
import path from 'node:path'
import type { Server as NodeHttpServer } from 'node:http'
import type { ServerConfig } from '@meesii/codex-mcp/dist/config/loader.js'
import type { RunningHttpServer } from '@meesii/codex-mcp/dist/server/http-server.js'
import type { UserConfig } from '@meesii/codex-mcp/dist/config/user-config.js'
import type { McpServerConfig, UiPreferences } from './config'
import { captureBefore, createDiffRecord, DIFF_CAPABLE_TOOLS, type FileDiffRecord } from './file-diffs'

/**
 * codex-mcp 运行时模块（宽松类型）。
 * 注：tsc 在多文件 program 下对该包的 d.ts 解析异常（单文件正常），
 * 而 dist 实际导出的 API 以运行时为准，这里用最小接口声明。
 */
type DownstreamHubLike = {
  reloadFromConfig: (config: { mcpServers: Record<string, McpServerConfig> }) => Promise<unknown>
  listServers: () => Array<{ name: string; status: string; error?: string }>
  listReadyServers: () => Array<{ name: string }>
  listTools: (serverName: string) => Promise<{ items: Array<{ name: string; description: string }> }>
  close: () => Promise<void>
}

type CodexMcpModules = {
  config: {
    loadConfig: (options: { projectRoot: string; userConfig: UserConfig; local: boolean }) => ServerConfig
  }
  http: {
    createHttpServer: (config: ServerConfig, options: Record<string, unknown>) => RunningHttpServer
  }
  hub: {
    DownstreamMcpHub: {
      empty: () => DownstreamHubLike
    }
  }
  userConfig: Record<string, never>
  ui: {
    UiSettingsStore: new (persistence: { load: () => UiPreferences; save: (preferences: UiPreferences) => void }) => unknown
  }
  skills: {
    SkillRegistry: {
      empty: () => unknown
      discover: (roots: Array<{ path: string; source: string; scope?: string; workspaceRoot?: string }>) => unknown
    }
  }
  names: {
    TOOL_NAMES: string[]
  }
}

const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>

/** 全部内置工具名（start 时从 codex-mcp tools/names.js 加载；工具白名单过滤用） */
let loadedToolNames: string[] | null = null

async function loadCodexMcp(): Promise<CodexMcpModules> {
  const [config, http, hub, userConfig, ui, skills, names] = await Promise.all([
    nativeImport('@meesii/codex-mcp/dist/config/loader.js'),
    nativeImport('@meesii/codex-mcp/dist/server/http-server.js'),
    nativeImport('@meesii/codex-mcp/dist/downstream/hub.js'),
    nativeImport('@meesii/codex-mcp/dist/config/user-config.js'),
    nativeImport('@meesii/codex-mcp/dist/ui/settings.js'),
    nativeImport('@meesii/codex-mcp/dist/skills/registry.js'),
    nativeImport('@meesii/codex-mcp/dist/tools/names.js'),
  ])
  return { config, http, hub, userConfig, ui, skills, names }
}

/** 进程内收集内置工具所需的引擎模块（宽松类型，运行时以实际导出为准） */
type ToolListingModules = {
  workspace: { WorkspaceRegistry: new (project: unknown) => unknown }
  processSessions: { ProcessSessionManager: new () => unknown }
  permissions: {
    PermissionManager: new (server: unknown, project: unknown, options?: Record<string, unknown>) => unknown
  }
  register: {
    registerAllTools: (
      server: unknown,
      config: unknown,
      options: Record<string, unknown>,
      hub: unknown,
      skills: unknown,
      capabilities: unknown,
      uiSettings: unknown,
      permissions: unknown,
    ) => void
  }
}

async function loadToolListingModules(): Promise<ToolListingModules> {
  const [workspace, processSessions, permissions, register] = await Promise.all([
    nativeImport('@meesii/codex-mcp/dist/workspace/registry.js'),
    nativeImport('@meesii/codex-mcp/dist/lib/process/sessions.js'),
    nativeImport('@meesii/codex-mcp/dist/permissions/manager.js'),
    nativeImport('@meesii/codex-mcp/dist/tools/register.js'),
  ])
  return { workspace, processSessions, permissions, register }
}

export type GatewayConfig = {
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

export type GatewayEvent = {
  direction: 'system' | 'request' | 'response'
  method: string
  payload?: unknown
  at: number
}

/** 单次工具调用记录（按 MCP 会话分组，区分 ChatGPT 不同对话） */
export type ToolCallStatus = 'pending' | 'ok' | 'error'
export type ToolCallRecord = {
  /** 全局自增序号（列表 key 用） */
  id: number
  /** MCP 会话标识（请求头 mcp-session-id，缺失时回退到会话类请求头） */
  sessionId: string
  /** 工具名（短名，去掉服务器前缀） */
  tool: string
  /** 调用参数键 */
  argsKeys: string[]
  /** 完整调用参数（UI 折叠展示，可能较大） */
  args?: Record<string, unknown>
  /** 发起时间戳 */
  at: number
  status: ToolCallStatus
  /** 从发起响应的耗时（ms，响应后才有） */
  durationMs?: number
  /** 工具返回结果（成功时）或错误详情（失败时），UI 折叠展示 */
  result?: unknown
}

/** 工具调用快照（getToolCalls 返回；sessionId → 该会话的全部调用，最新在前） */
export type ToolCallSnapshot = {
  sessions: Record<string, ToolCallRecord[]>
  /** 全量平铺（最新在前，上限 TOOL_CALLS_TOTAL） */
  recent: ToolCallRecord[]
}

/** 从 MCP 请求解析会话标识（ChatGPT 每个对话一条 MCP 连接，mcp-session-id 即区分键） */
function sessionKeyFor(req: { headers: Record<string, string | string[] | undefined> }): string {
  const h = req.headers
  const direct = h['mcp-session-id']
  if (typeof direct === 'string' && direct) return direct
  for (const [k, v] of Object.entries(h)) {
    if (v && /session|conversation|thread/i.test(k) && typeof v === 'string' && v.trim()) return `${k}:${v.trim()}`
  }
  return 'unknown'
}

/**
 * Gateway 运行时依赖：全部来自 free-codex 自持配置，
 * 不再读写 ~/.codex-mcp/config.json 与 ~/.codex-mcp/mcp.json。
 */
export type GatewayDeps = {
  /** 下游 MCP 服务器 */
  getMcpServers: () => Record<string, McpServerConfig>
  /** ChatGPT 侧 UI 偏好 */
  getUiPreferences: () => UiPreferences
  /** UI 偏好变更持久化（写回 free-codex 配置） */
  saveUiPreferences: (ui: UiPreferences) => void
  /** goal 存储目录（free-codex userData 下） */
  goalStorageDir: () => string
  /** 技能目录（用户级 + 项目级，与引擎 SkillRegistry 共享同一约定） */
  getSkillDirs: () => { userDir: string; projectDir: string | null }
  /** 禁用的内置工具短名列表（白名单过滤：不在集合的不注册） */
  getDisabledTools: () => string[]
}

  /** 工具名按 lastIndexOf(':') 取短名（兼容服务器前缀） */
function shortToolName(name: string): string {
  const idx = name.lastIndexOf(':')
  return idx >= 0 ? name.slice(idx + 1) : name
}

/** 增量解析响应流中的 JSON-RPC 响应（单 JSON 或 SSE data 行），返回未消费的剩余文本 */
function consumeJsonRpcResponses(
  text: string,
  onResponse: (resp: { id: unknown; result?: { structuredContent?: { diff?: unknown; path?: unknown }; isError?: boolean }; error?: unknown }) => void,
): string {
  // 单 JSON 响应（整体可解析时）
  try {
    const parsed = JSON.parse(text) as { id?: unknown; result?: unknown; error?: unknown }
    if ('id' in parsed && ('result' in parsed || 'error' in parsed)) {
      onResponse(parsed as never)
      return ''
    }
  } catch {
    // 未完整或非 JSON，继续
  }
  // SSE：按空行切块，处理完整事件块
  let remaining = text
  let idx: number
  while ((idx = remaining.indexOf('\n\n')) >= 0) {
    const block = remaining.slice(0, idx)
    remaining = remaining.slice(idx + 2)
    const dataLine = block.split(/\r?\n/).find((l) => l.startsWith('data:'))
    if (!dataLine) continue
    try {
      const parsed = JSON.parse(dataLine.slice(5).trim()) as { id?: unknown; result?: unknown; error?: unknown }
      if ('id' in parsed && ('result' in parsed || 'error' in parsed)) {
        onResponse(parsed as never)
      }
    } catch {
      // 忽略非 JSON 行
    }
  }
  return remaining
}

/** 诊断：递归收集会话相关字段（session/conversation/thread/chat_id 等键），带路径前缀 */
function collectSessionFields(
  value: unknown,
  prefix = '',
  out: Record<string, unknown> = {},
  depth = 0,
): Record<string, unknown> {
  if (depth > 3 || value === null || value === undefined) return out
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectSessionFields(v, `${prefix}[${i}]`, out, depth + 1))
    return out
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k
      if (/session|conversation|thread|chat\s?_?\s?id/i.test(k)) {
        out[path] = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : '[object]'
      }
      collectSessionFields(v, path, out, depth + 1)
    }
  }
  return out
}

export class NodeMcpGateway {
  private server?: RunningHttpServer
  private hub?: DownstreamHubLike
  private events = new Set<(event: GatewayEvent) => void>()
  private fileDiffListeners = new Set<(record: FileDiffRecord) => void>()
  private toolCallListeners = new Set<(record: ToolCallRecord, direction: 'start' | 'done') => void>()
  private currentConfig?: GatewayConfig

  /** 内置引擎工具缓存（带 TTL） */
  private builtinToolsCache: { tools: { name: string; description: string; server: string }[]; at: number } | null = null
  private readonly BUILTIN_CACHE_TTL_MS = 30_000

  // ---------- 工具调用记录（按 MCP 会话分组）----------
  /** sessionId → 调用列表（最新在前，每个会话上限 TOOL_CALLS_PER_SESSION） */
  private toolCallsBySession = new Map<string, ToolCallRecord[]>()
  /** sessionId → 最近活动时间（超出会话数上限时淘汰最久未活跃的） */
  private sessionLastAt = new Map<string, number>()
  /** JSON-RPC id → 调用记录（响应到达时回填 status/duration） */
  private toolCallById = new Map<unknown, ToolCallRecord>()
  private toolCallSeq = 0
  private readonly TOOL_CALLS_PER_SESSION = 100
  private readonly TOOL_CALLS_MAX_SESSIONS = 24
  private readonly TOOL_CALLS_TOTAL = 200
  /** pending 记录超过该时长视为超时（推送快照时清理，避免"运行中"挂死） */
  private readonly PENDING_TIMEOUT_MS = 5 * 60_000

  constructor(
    private config: GatewayConfig,
    private deps: GatewayDeps,
  ) {}

  /**
   * 进程内收集内置引擎工具（不经 HTTP /mcp，公网模式 OAuth 认证不会拦本地查询）。
   * 复用 RunningHttpServer 暴露的共享实例（project/hub/skills/agents/goals/uiSettings），
   * 用 mock server 记录 registerAllTools 的工具注册，即得名称与描述。
   */
  private async listBuiltinTools(): Promise<{ name: string; description: string; server: string }[]> {
    const srv = this.server
    if (!srv) return []
    try {
      const m = await loadToolListingModules()
      const processes = new m.processSessions.ProcessSessionManager()
      const workspace = new m.workspace.WorkspaceRegistry(srv.project)
      const tools: { name: string; description: string }[] = []
      const allowed = this.allowedToolsSet()
      const mockServer = new Proxy({} as Record<string, unknown>, {
        get: (_target, prop) => {
          if (prop === 'registerTool') {
            return (name: string, cfg?: { title?: string; description?: string }) => {
              // 与真实 server 的 configureToolRegistrationPolicy 一致：禁用的工具不收集
              if (allowed && !allowed.has(name)) return
              tools.push({ name, description: cfg?.description ?? cfg?.title ?? '' })
            }
          }
          return () => undefined
        },
      })
      // v0.7.0：registerAllTools 签名改为 (server, config, { scope, tryScope, allowedTools }, hub, skills, capabilities, uiSettings, permissions)
      const scope = () => ({ project: srv.project, workspace, agents: srv.agents, goals: srv.goals, processes })
      const permissions = new m.permissions.PermissionManager(mockServer, () => srv.project, {})
      m.register.registerAllTools(
        mockServer,
        srv.config,
        { scope, tryScope: scope, allowedTools: this.allowedToolsSet() },
        srv.hub,
        srv.skills,
        srv.capabilities,
        srv.uiSettings,
        permissions,
      )
      return tools.map((t) => ({ ...t, server: 'codex-mcp' }))
    } catch (err) {
      console.warn('[gateway] 进程内收集内置工具失败:', err)
      return []
    }
  }

  /** 允许的工具白名单：全部内置工具名 - 禁用列表；无禁用返回 undefined（不过滤） */
  private allowedToolsSet(): Set<string> | undefined {
    const disabled = new Set(this.deps.getDisabledTools())
    if (disabled.size === 0) return undefined
    if (!loadedToolNames) return undefined
    return new Set(loadedToolNames.filter((n) => !disabled.has(n)))
  }

  update(config: GatewayConfig) {
    if (this.server) throw new Error('MCP Gateway 正在运行，请先停止后再修改配置')
    this.config = config
  }

  onEvent(listener: (event: GatewayEvent) => void) {
    this.events.add(listener)
    return () => this.events.delete(listener)
  }

  /** 订阅引擎工具调用产生的文件 diff（edit/write/apply_patch） */
  onFileDiff(listener: (record: FileDiffRecord) => void) {
    this.fileDiffListeners.add(listener)
    return () => this.fileDiffListeners.delete(listener)
  }

  /** 订阅工具调用（发起 start / 完成 done），用于实时推送渲染层 */
  onToolCall(listener: (record: ToolCallRecord, direction: 'start' | 'done') => void) {
    this.toolCallListeners.add(listener)
    return () => this.toolCallListeners.delete(listener)
  }

  /** 工具调用快照（按会话分组 + 全量平铺），渲染层按当前会话过滤展示 */
  getToolCalls(): ToolCallSnapshot {
    // 超时的 pending 视为 error（abort/超时不会再有响应）
    const now = Date.now()
    for (const list of this.toolCallsBySession.values()) {
      for (let i = list.length - 1; i >= 0; i--) {
        const rec = list[i]
        if (rec.status === 'pending' && now - rec.at > this.PENDING_TIMEOUT_MS) rec.status = 'error'
      }
    }
    const sessions: Record<string, ToolCallRecord[]> = {}
    const recent: ToolCallRecord[] = []
    for (const [sid, list] of this.toolCallsBySession) sessions[sid] = list
    for (const list of Object.values(sessions)) recent.push(...list)
    recent.sort((a, b) => b.at - a.at)
    return { sessions, recent: recent.slice(0, this.TOOL_CALLS_TOTAL) }
  }

  /** 记录一次工具调用发起（响应到达时经 toolCallById 回填状态） */
  private pushToolCall(record: ToolCallRecord) {
    const list = this.toolCallsBySession.get(record.sessionId) ?? []
    list.unshift(record)
    if (list.length > this.TOOL_CALLS_PER_SESSION) list.length = this.TOOL_CALLS_PER_SESSION
    this.toolCallsBySession.set(record.sessionId, list)
    this.sessionLastAt.set(record.sessionId, record.at)
    // 会话数上限：淘汰最久未活跃的会话
    if (this.toolCallsBySession.size > this.TOOL_CALLS_MAX_SESSIONS) {
      let oldest: string | null = null
      let oldestAt = Infinity
      for (const [sid, at] of this.sessionLastAt) {
        if (at < oldestAt) {
          oldestAt = at
          oldest = sid
        }
      }
      if (oldest) {
        this.toolCallsBySession.delete(oldest)
        this.sessionLastAt.delete(oldest)
      }
    }
    for (const listener of this.toolCallListeners) {
      try {
        listener(record, 'start')
      } catch (err) {
        console.warn('[gateway] toolCall 监听器异常:', err)
      }
    }
  }

  private emitToolCallDone(record: ToolCallRecord) {
    for (const listener of this.toolCallListeners) {
      try {
        listener(record, 'done')
      } catch (err) {
        console.warn('[gateway] toolCall 监听器异常:', err)
      }
    }
  }

  get endpoint() {
    return this.server?.getMcpUrl() ?? `http://${this.config.host}:${this.config.port}/mcp`
  }

  get publicUrl() {
    if (this.config.domain) return `https://${this.config.domain}/mcp`
    return ''
  }

  get running() {
    return !!this.server
  }

  async getTools() {
    const tools: { name: string; description: string; server: string }[] = []
    // 下游工具
    for (const server of this.hub?.listReadyServers() ?? []) {
      const listed = await this.hub!.listTools(server.name)
      for (const tool of listed.items) tools.push({ name: tool.name, description: tool.description, server: server.name })
    }
    // 内置引擎工具（进程内收集，带 TTL 缓存）
    // 注意：仅在网关运行中才收集/使用缓存 —— 未运行时不缓存空结果，
    // 否则面板在网关启动完成前刷新会把空列表缓存 30s，启动后仍显示无工具。
    if (this.server) {
      if (!this.builtinToolsCache || Date.now() - this.builtinToolsCache.at > this.BUILTIN_CACHE_TTL_MS) {
        this.builtinToolsCache = { tools: await this.listBuiltinTools(), at: Date.now() }
      }
      tools.push(...(this.builtinToolsCache?.tools ?? []))
    }
    return tools
  }

  getServers() {
    return this.hub?.listServers() ?? []
  }

  /**
   * 热重载下游 MCP 服务器（增删 todos 等下游，无需重启网关/隧道）。
   * hub 的 reloadFromConfig 按槽位重建连接：进行中的调用走旧连接，新调用走新连接。
   * 网关未运行时返回 { ready: 0, error: 0 }（下次 start 时按 getMcpServers 自然生效）。
   */
  async reloadDownstream(): Promise<{ ready: number; error: number }> {
    if (!this.hub) return { ready: 0, error: 0 }
    const result = (await this.hub.reloadFromConfig({
      mcpServers: this.deps.getMcpServers(),
    })) as { ready?: number; error?: number }
    const ready = result?.ready ?? 0
    const error = result?.error ?? 0
    this.emit('system', 'downstream_reloaded', { ready, error })
    return { ready, error }
  }

  async start() {
    if (this.server) return this.publicUrl || this.endpoint

    const modules = await loadCodexMcp()
    loadedToolNames = modules.names.TOOL_NAMES as string[]
    const local = !this.config.publicEnabled

    // 公网模式校验：缺域名 / tunnel 配置时明确报错（本地模式无需任何额外配置）
    if (!local) {
      if (!this.config.domain) throw new Error('公网模式需要填写公网域名（设置 → 公网配置）')
      if (!this.config.tunnelId) throw new Error('公网模式需要 Tunnel ID（设置 → 公网配置）')
      if (!this.config.cloudflaredBin) throw new Error('公网模式需要 cloudflared 可执行文件路径（设置 → 公网配置）')
    }

    // 全部配置来自 free-codex，不再读取 ~/.codex-mcp/config.json
    const userConfig: UserConfig = {
      host: this.config.host,
      port: this.config.port,
      ...(this.config.domain ? { domain: this.config.domain } : {}),
      ...(this.config.cloudflaredBin ? { cloudflaredBin: this.config.cloudflaredBin } : {}),
      ...(this.config.tunnelId ? { tunnelId: this.config.tunnelId } : {}),
      ...(this.config.tunnelName ? { tunnelName: this.config.tunnelName } : {}),
    }
    const codexConfig: ServerConfig = modules.config.loadConfig({
      projectRoot: this.config.projectRoot,
      userConfig,
      local,
    })

    // 下游 hub：配置来自 free-codex（不再 connectFromDefaultConfig 读 ~/.codex-mcp/mcp.json / codex CLI）
    this.hub = modules.hub.DownstreamMcpHub.empty()
    await this.hub.reloadFromConfig({ mcpServers: this.deps.getMcpServers() })

    // 技能注册：用户级 + 项目级（项目级在前，同名时项目级优先，与 Skills 页一致）
    const skillDirs = this.deps.getSkillDirs()
    const skills = modules.skills.SkillRegistry.discover([
      ...(skillDirs.projectDir
        ? [{ path: skillDirs.projectDir, source: 'agents', scope: 'project', workspaceRoot: this.config.projectRoot }]
        : []),
      { path: skillDirs.userDir, source: 'agents', scope: 'user' },
    ])

    // UI 偏好 + goal 存储注入（持久化到 free-codex 配置）
    const uiSettings = new modules.ui.UiSettingsStore({
      load: () => this.deps.getUiPreferences(),
      save: (preferences: UiPreferences) => this.deps.saveUiPreferences(preferences),
    })
    this.server = modules.http.createHttpServer(codexConfig, {
      hub: this.hub,
      uiSettings,
      goalStorageDir: this.deps.goalStorageDir(),
      skills,
      // 工具启用/禁用：allowedTools 白名单 = 全部内置工具名 - 禁用列表；
      // 未在白名单的工具在注册时被跳过（tools/list 不再暴露）。
      allowedToolsResolver: () => this.allowedToolsSet(),
    })

    try {
      const httpServer = (await this.server.listen()) as NodeHttpServer
      // 旁路监听 HTTP 层：捕获 tools/call 的请求（before 快照）与响应（diff）
      this.attachRequestSniffer(httpServer)
      // 新服务器实例 → 内置工具缓存作废（getTools 在运行中重新收集）
      this.builtinToolsCache = null
      this.currentConfig = this.config
      this.emit('system', 'gateway_started', { endpoint: this.endpoint, local })

      // 注：cloudflared 隧道由 app 层 TunnelManager 持有（见 tunnel-manager.ts），
      // 网关 start/stop 不再拉起/停掉隧道——网关重启不影响公网连接。
      return this.publicUrl || this.endpoint
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  /** 公网隧道可达性探针（TunnelManager 校验用；网关未运行时为 null） */
  getTunnelProbe(): { path: string; expectedBody: string } | null {
    return this.server?.getTunnelProbe() ?? null
  }

  async stop() {
    // 注：cloudflared 隧道由 app 层 TunnelManager 持有，网关 stop 不停止隧道（见 tunnel-manager.ts）
    await this.server?.close().catch(() => undefined)
    this.server = undefined
    this.hub = undefined
    this.currentConfig = undefined
    this.builtinToolsCache = null
    this.toolCallsBySession.clear()
    this.sessionLastAt.clear()
    this.toolCallById.clear()
    this.emit('system', 'gateway_stopped')
  }

  // ------------------------------------------------------------
  // Diff 旁路拦截：tools/call 请求到达时快照文件，响应返回时提取 diff
  // ------------------------------------------------------------

  private attachRequestSniffer(httpServer: NodeHttpServer) {
    // JSON-RPC id → 待匹配的工具调用上下文
    const pending = new Map<unknown, { toolName: string; relPath: string; absPath: string; before: string | null }>()

    httpServer.on('request', (req, res) => {
      if (!req.url || !req.url.includes('/mcp')) return

      // 请求体：tools/call 参数（执行前快照）
      const reqChunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => reqChunks.push(chunk))
      req.on('end', () => {
        try {
          const body = Buffer.concat(reqChunks).toString('utf8')
          const msg = JSON.parse(body) as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }
          // 诊断日志：打印 GPT 侧请求内容（会话字段 / 工具名 / 参数键 / 请求头）
          if (msg && typeof msg.method === 'string') {
            const sessionFields = collectSessionFields(msg)
            const sessionHeaders = Object.entries(req.headers)
              .filter(([k]) => /session|conversation/i.test(k))
              .map(([k, v]) => [k, v])
            console.log('[mcp] <== 请求', JSON.stringify({
              method: msg.method,
              id: msg.id,
              tool: msg.method === 'tools/call' ? msg.params?.name : undefined,
              argsKeys: msg.method === 'tools/call' && msg.params?.arguments ? Object.keys(msg.params.arguments) : undefined,
              sessionFields,
              sessionHeaders: Object.fromEntries(sessionHeaders),
              hasAuth: !!req.headers.authorization,
            }))
          }
          if (msg && msg.method === 'tools/call') {
            // 记录本次调用（会话级分组；响应到达时回填 status / result）
            const args = msg.params?.arguments ? { ...msg.params.arguments } : undefined
            const record: ToolCallRecord = {
              id: ++this.toolCallSeq,
              sessionId: sessionKeyFor(req),
              tool: shortToolName(msg.params?.name ?? ''),
              argsKeys: args ? Object.keys(args) : [],
              args,
              at: Date.now(),
              status: 'pending',
            }
            this.toolCallById.set(msg.id, record)
            this.pushToolCall(record)
            const ctx = this.buildToolCtx(msg.params?.name ?? '', msg.params?.arguments ?? {})
            if (ctx) pending.set(msg.id, ctx)
          }
        } catch {
          // 非 JSON 请求体忽略
        }
      })

      // 响应体：ServerResponse 是 Writable（没有 data 事件），monkey-patch write/end 收集。
      // SSE 是流式长连接（res 不 end），每次 write 都实时增量解析。
      const originalWrite = res.write.bind(res) as (chunk: unknown, ...args: unknown[]) => boolean
      const originalEnd = res.end.bind(res) as (...args: unknown[]) => unknown
      let resText = ''
      const handleChunk = (chunk: unknown): void => {
        if (chunk === undefined || chunk === null) return
        // chunk 可能是 string / Buffer / Uint8Array；String(Uint8Array) 会得到数字序列，必须显式转 utf8
        let text: string
        if (typeof chunk === 'string') {
          text = chunk
        } else if (chunk instanceof Uint8Array) {
          text = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('utf8')
        } else {
          text = String(chunk)
        }
        resText = consumeJsonRpcResponses(resText + text, (resp) => {
          // 工具调用状态回填（ok / error）+ 结果 + 完成事件
          const call = this.toolCallById.get(resp.id)
          if (call) {
            call.status = resp.error ? 'error' : 'ok'
            call.durationMs = Date.now() - call.at
            call.result = resp.error ?? resp.result
            this.toolCallById.delete(resp.id)
            this.emitToolCallDone(call)
          }
          const ctx = pending.get(resp.id)
          if (!ctx) return
          pending.delete(resp.id)
          if (resp.error) return
          const diffText = resp.result?.structuredContent?.diff
          if (typeof diffText === 'string' && diffText.trim()) {
            this.emitFileDiff(ctx.toolName, ctx.relPath, ctx.absPath, diffText, ctx.before)
          }
        })
      }
      res.write = ((chunk: unknown, ...args: unknown[]) => {
        handleChunk(chunk)
        return originalWrite(chunk as never, ...(args as never[]))
      }) as typeof res.write
      res.end = ((chunk?: unknown, ...args: unknown[]) => {
        handleChunk(chunk)
        return originalEnd(chunk as never, ...(args as never[]))
      }) as typeof res.end
    })
  }

  /** 从工具参数解析 diff 上下文（仅 DIFF_CAPABLE_TOOLS；路径支持绝对或相对 projectRoot） */
  private buildToolCtx(name: string, args: Record<string, unknown>): { toolName: string; relPath: string; absPath: string; before: string | null } | null {
    if (!DIFF_CAPABLE_TOOLS.has(shortToolName(name))) return null
    let relPath: string | null = null
    if (typeof args.path === 'string' && args.path.trim()) {
      relPath = args.path.trim()
    }
    if (!relPath && typeof args.diff === 'string') {
      // apply_patch：从 unified diff 文件头解析路径
      const m = args.diff.match(/^\+\+\+ b\/(.+)$/m) || args.diff.match(/^--- a\/(.+)$/m)
      if (m) relPath = m[1].trim()
    }
    if (!relPath) return null
    const absPath = path.isAbsolute(relPath) ? relPath : path.join(this.config.projectRoot, relPath)
    const cleanRel = path.isAbsolute(relPath) ? path.basename(relPath) : relPath
    return { toolName: name, relPath: cleanRel, absPath, before: captureBefore(absPath) }
  }

  private emitFileDiff(toolName: string, relPath: string, absPath: string, diffText: string, before: string | null) {
    try {
      const record = createDiffRecord({ toolName, relPath, absPath, diffText, before })
      for (const listener of this.fileDiffListeners) {
        try {
          listener(record)
        } catch (err) {
          console.warn('[gateway] fileDiff 监听器异常:', err)
        }
      }
    } catch (err) {
      console.warn('[gateway] 生成 diff 记录失败:', err)
    }
  }

  private emit(direction: GatewayEvent['direction'], method: string, payload?: unknown) {
    const event: GatewayEvent = { direction, method, payload, at: Date.now() }
    for (const listener of this.events) listener(event)
  }
}

/** free-codex 的 goal 存储目录（userData/goals） */
export function defaultGoalStorageDir(): string {
  return app.getPath('userData') + '/goals'
}

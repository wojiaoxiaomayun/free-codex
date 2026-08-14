import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { GatewayConfig } from './mcp-gateway'
import { syncCodexMcpConfig } from './codex-config-sync'

/** 下游 MCP 服务器配置项（stdio 或 http 二选一） */
export type McpServerConfig = {
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  disabled?: boolean
  startupTimeoutMs?: number
  toolTimeoutMs?: number
}

/** ChatGPT 侧自定义 UI 偏好（对应 codex-mcp 的 ui 配置） */
export type UiPreferences = {
  /** 普通编码工具卡片（read/edit/bash 等），默认 false */
  tools: boolean
  /** 状态/进度工具卡片（summary/goal_*），默认 true */
  status: boolean
}

/** Webview（ChatGPT 视图）代理配置 */
export type ProxyConfig = {
  enabled: boolean
  /** 代理地址，如 127.0.0.1:7890 或 socks5://127.0.0.1:1080 */
  url: string
}

/**
 * 新会话注入内容开关（chat-inject：每会话首条请求注入的上下文块）。
 * 各开关控制是否把对应段落注入；AGENTS.md/CLAUDE.md 项目里不存在时不注入（即使开启）。
 */
export type InjectionSettings = {
  /** 注入项目路径（相对路径解析基准） */
  projectPath: boolean
  /** 注入项目根目录 AGENTS.md */
  agentsMd: boolean
  /** 注入项目根目录 CLAUDE.md（默认关） */
  claudeMd: boolean
  /** 自动在对话中激活 mycodex 插件（fetch 层自动 @提及，默认开） */
  autoSelectPlugin: boolean
  /** skills 注入开关（skill 名 → 是否注入；未配置视为开） */
  skills: Record<string, boolean>
}

export type Config = {
  projectRoot: string
  /** 应用启动时自动拉起 Gateway */
  autoStart: boolean
  gateway: GatewayConfig & { tunnelName: string }
  cloudflare: {
    enabled: boolean
    executable: string
    hostname: string
    tunnelId: string
    configPath: string
  }
  /** ChatGPT 侧自定义 UI 偏好 */
  ui: UiPreferences
  /** Webview（ChatGPT 视图）代理 */
  proxy: ProxyConfig
  /** 新会话注入内容开关（项目路径 / 插件名 / AGENTS.md / CLAUDE.md / skills） */
  injections: InjectionSettings
  /** 会话清理（右侧面板 Clean）：临时清理当前会话 DOM + 真实删除聊天记录 */
  chatCleanup: {
    /** 临时清理时保留的最新消息条数（默认 3） */
    trimKeep: number
    /** 自动清理：当前会话消息数超过保留数时自动删除旧 DOM（防卡顿） */
    autoTrim: boolean
  }
  /** 内置工具启用/禁用（禁用后不注册，ChatGPT 连接器不再暴露该工具） */
  toolEnablement: {
    /** 禁用的内置工具短名列表（默认空 = 全部启用） */
    disabledTools: string[]
  }
  /** todos 模式：进程内下游 MCP server + 每轮注入快照 + 未更新提醒（软强制） */
  todos: {
    /** 是否启用（启用时启动 todos server 并注入 mcpServers.todos） */
    enabled: boolean
  }
  /** 连接密码明文（free-codex 自持，便于欢迎向导/设置页展示复制；codex-mcp 侧仍存哈希用于 OAuth 校验） */
  connectionPassword?: string
  /** 欢迎向导已跳过/完成（不再强制引导） */
  onboardingSkipped?: boolean
  /** 下游 MCP 服务器（原先在 ~/.codex-mcp/mcp.json，现归 free-codex 自持） */
  mcpServers: Record<string, McpServerConfig>
}

const defaults = (): Config => ({
  projectRoot: '',
  autoStart: false,
  gateway: {
    projectRoot: '',
    host: '127.0.0.1',
    port: 3291,
    publicEnabled: false,
    domain: '',
    cloudflaredBin: 'cloudflared',
    tunnelId: '',
    tunnelName: 'codex-mcp',
    tunnelConfigPath: '',
  },
  cloudflare: {
    enabled: false,
    executable: 'cloudflared',
    hostname: '',
    tunnelId: '',
    configPath: '',
  },
  ui: {
    tools: false,
    status: true,
  },
  proxy: {
    enabled: false,
    url: '',
  },
  injections: {
    projectPath: true,
    agentsMd: true,
    claudeMd: false,
    autoSelectPlugin: true,
    skills: {},
  },
  chatCleanup: {
    trimKeep: 3,
    autoTrim: false,
  },
  toolEnablement: {
    disabledTools: [],
  },
  todos: {
    // 默认开启：todos 是应用内置的任务清单工作流（每轮快照 + 未更新提醒）
    enabled: true,
  },
  mcpServers: {},
})

const file = () => path.join(app.getPath('userData'), 'config.json')

/** 旧版下游服务器配置：~/.codex-mcp/mcp.json（一次性迁移用） */
function legacyMcpFilePath(): string {
  return path.join(app.getPath('home'), '.codex-mcp', 'mcp.json')
}

/** 读旧 ~/.codex-mcp/mcp.json（存在则返回 mcpServers，否则空） */
function readLegacyMcpServers(): Record<string, McpServerConfig> {
  try {
    if (!fs.existsSync(legacyMcpFilePath())) return {}
    const data = JSON.parse(fs.readFileSync(legacyMcpFilePath(), 'utf8'))
    if (data && typeof data === 'object' && data.mcpServers && typeof data.mcpServers === 'object') {
      return data.mcpServers as Record<string, McpServerConfig>
    }
    return {}
  } catch (err) {
    console.warn('[config] 读取旧 ~/.codex-mcp/mcp.json 失败:', err)
    return {}
  }
}

export function loadConfig(): Config {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<Config>
    const base = defaults()
    const config: Config = {
      ...base,
      ...saved,
      gateway: { ...base.gateway, ...(saved.gateway ?? {}) },
      cloudflare: { ...base.cloudflare, ...(saved.cloudflare ?? {}) },
      ui: { ...base.ui, ...(saved.ui ?? {}) },
      proxy: { ...base.proxy, ...(saved.proxy ?? {}) },
      injections: { ...base.injections, ...(saved.injections ?? {}), skills: { ...(saved.injections?.skills ?? {}) } },
      chatCleanup: { ...base.chatCleanup, ...(saved.chatCleanup ?? {}) },
      toolEnablement: { ...base.toolEnablement, ...(saved.toolEnablement ?? {}), disabledTools: [...(saved.toolEnablement?.disabledTools ?? [])] },
      todos: { ...base.todos, ...(saved.todos ?? {}) },
      mcpServers: { ...(saved.mcpServers ?? {}) },
    }
    // 一次性迁移：旧 ~/.codex-mcp/mcp.json 的下游服务器导入 free-codex 配置
    if (Object.keys(config.mcpServers).length === 0) {
      const legacy = readLegacyMcpServers()
      if (Object.keys(legacy).length > 0) {
        config.mcpServers = legacy
        console.log('[config] 已从 ~/.codex-mcp/mcp.json 迁移下游服务器:', Object.keys(legacy).join(', '))
      }
    }
    return config
  } catch {
    return defaults()
  }
}

export function saveConfig(config: Config) {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  // 原子写：先写临时文件再 rename，避免进程被强杀/极端并发时写坏配置
  const body = `${JSON.stringify(config, null, 2)}\n`
  const tmp = `${file()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, body, 'utf8')
  fs.renameSync(tmp, file())
  // 写回 codex-mcp 配置（复用支持）：失败只记日志，不阻断保存
  try {
    syncCodexMcpConfig(config)
  } catch (err) {
    console.warn('[config] 写回 ~/.codex-mcp 失败:', err instanceof Error ? err.message : String(err))
  }
}

/** 读取 ~/.codex-mcp/config.json（不存在/损坏 → 空对象） */
function readCodexUserConfig(): Record<string, unknown> {
  const p = path.join(app.getPath('home'), '.codex-mcp', 'config.json')
  try {
    if (!fs.existsSync(p)) return {}
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * 反向导入（一次性）：本地已有一套 codex-mcp 的公网配置（domain + tunnelId），
 * 而 free-codex 还没配公网 → 采纳 codex-mcp 的域名 / Tunnel / cloudflared / 隧道名，
 * 避免新手在两边重复配置。返回是否发生了导入（调用方负责持久化）。
 */
export function importCodexPublicConfig(config: Config): boolean {
  if (config.gateway.publicEnabled || config.gateway.domain || config.gateway.tunnelId) return false
  const codex = readCodexUserConfig()
  const domain = typeof codex.domain === 'string' && codex.domain.trim() ? codex.domain.trim() : ''
  const tunnelId = typeof codex.tunnelId === 'string' && codex.tunnelId.trim() ? codex.tunnelId.trim() : ''
  if (!domain || !tunnelId) return false
  const cloudflaredBin = typeof codex.cloudflaredBin === 'string' && codex.cloudflaredBin.trim() ? codex.cloudflaredBin.trim() : ''
  const tunnelName = typeof codex.tunnelName === 'string' && codex.tunnelName.trim() ? codex.tunnelName.trim() : ''
  config.gateway = {
    ...config.gateway,
    publicEnabled: codex.useCloudflared !== false,
    domain,
    tunnelId,
    ...(cloudflaredBin ? { cloudflaredBin } : {}),
    ...(tunnelName ? { tunnelName } : {}),
  }
  config.cloudflare = {
    enabled: true,
    executable: cloudflaredBin || config.cloudflare.executable,
    hostname: domain,
    tunnelId,
    configPath: config.cloudflare.configPath,
  }
  console.log('[config] 已从 ~/.codex-mcp/config.json 导入公网配置:', domain)
  return true
}


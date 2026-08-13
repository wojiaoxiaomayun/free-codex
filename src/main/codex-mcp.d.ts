declare module '@meesii/codex-mcp/dist/config/loader.js' {
  export interface ServerConfig {
    host: string
    port: number
    local: boolean
    oauthRequired: boolean
    publicMcpUrl?: string
    projectRoot: string
    allowedHosts: string[]
    widgetDomain: string
  }
  export interface UserConfig {
    host?: string
    port?: number
    domain?: string
    useCloudflared?: boolean
    cloudflaredBin?: string
    tunnelName?: string
    tunnelId?: string
    clientCapabilities?: unknown
    ui?: unknown
  }
  export function loadConfig(options?: { projectRoot?: string; userConfig?: UserConfig; local?: boolean }): ServerConfig
  export function expandHomePath(value: string): string
}

declare module '@meesii/codex-mcp/dist/server/http-server.js' {
  import type { ServerConfig } from '@meesii/codex-mcp/dist/config/loader.js'
  import type { DownstreamMcpHub } from '@meesii/codex-mcp/dist/downstream/hub.js'
  export interface RunningHttpServer {
    config: ServerConfig
    /** 引擎内部共享实例（进程内收集内置工具时复用） */
    project: unknown
    hub: DownstreamMcpHub
    skills: unknown
    capabilities?: unknown
    agents: unknown
    goals: unknown
    uiSettings: unknown
    listen: () => Promise<unknown>
    close: () => Promise<void>
    getMcpUrl: () => string
    getTunnelProbe: () => { path: string; expectedBody: string }
  }
  export function createHttpServer(config: ServerConfig, options?: { hub?: DownstreamMcpHub; skills?: unknown }): RunningHttpServer
}

declare module '@meesii/codex-mcp/dist/downstream/hub.js' {
  export interface DownstreamServerInfo {
    name: string
    description: string
    status: 'ready' | 'error'
    error?: string
    capabilities?: { tools: boolean; resources: boolean; prompts: boolean }
  }
  export class DownstreamMcpHub {
    static connectFromDefaultConfig(): Promise<DownstreamMcpHub>
    listServers(): DownstreamServerInfo[]
    listReadyServers(): DownstreamServerInfo[]
    listTools(serverName: string): Promise<{ items: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>; truncated: boolean }>
    close(): Promise<void>
  }
}

declare module '@meesii/codex-mcp/dist/config/user-config.js' {
  export interface UserConfig {
    host?: string
    port?: number
    domain?: string
    useCloudflared?: boolean
    cloudflaredBin?: string
    tunnelName?: string
    tunnelId?: string
    clientCapabilities?: unknown
    ui?: unknown
  }
  export function loadUserConfig(): UserConfig
  export function saveUserConfig(patch: UserConfig): UserConfig
}

declare module '@meesii/codex-mcp/dist/tunnel/sidecar.js' {
  export class CloudflaredSidecar {
    constructor(options: { bin: string; tunnelId: string; configPath?: string; mirrorLogs?: boolean; readyTimeoutMs?: number })
    start(): Promise<{ location?: string; protocol?: string }>
    stop(): Promise<void>
    getLogPath(): string
  }
}

declare module '@meesii/codex-mcp/dist/tunnel/verify.js' {
  export function verifyTunnelRoute(
    publicMcpUrl: string,
    probe: { path: string; expectedBody: string },
    options?: { allowPrivate?: boolean; attempts?: number; requestTimeoutMs?: number; retryDelayMs?: number },
  ): Promise<void>
}

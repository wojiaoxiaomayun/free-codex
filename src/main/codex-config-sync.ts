/**
 * codex-mcp 配置写回（复用支持）
 *
 * free-codex 自持的配置里，有一部分本来就是 codex-mcp 的：
 *   - config.json 的 gateway 段（host/port/domain/useCloudflared/cloudflaredBin/tunnelName/tunnelId）与 ui
 *   - mcp.json（下游 MCP 服务器，当初从 ~/.codex-mcp/mcp.json 一次性迁移进 config.mcpServers）
 *   - cloudflared.yml（隧道运行配置，free-codex 写在自己的 userData，这里复制一份到 codex-mcp 位置）
 * 保存配置时把这些写回 ~/.codex-mcp，让独立运行的 `codex-mcp` CLI 复用同一套配置。
 *
 * 注意：codex-mcp 独有、free-codex 不管理的字段（clientCapabilities / workspaces /
 * permissions / capabilities）保留不动；共享字段以 free-codex 为准（最后写入者覆盖）。
 */

import { homedir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from './config'

const codexDir = (): string => join(homedir(), '.codex-mcp')
const codexConfigPath = (): string => join(codexDir(), 'config.json')
const codexMcpJsonPath = (): string => join(codexDir(), 'mcp.json')
const codexTunnelYmlPath = (): string => join(codexDir(), 'cloudflared.yml')

/** 读 JSON（不存在/损坏 → 空对象） */
function readJson(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {}
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** codex-mcp 对敏感 header 的限制（同 codex-mcp src/config/user-mcp.ts）：值必须用 ${ENV} 引用 */
function isSensitiveHeaderKey(key: string): boolean {
  if (/^(?:authorization|cookie)$/i.test(key)) return true
  return /(?:^|[-_])(?:token|secret|password|credential|api[-_]?key|apikey|access[-_]?key|private[-_]?key)(?:$|[-_])/i.test(key)
}

function hasEnvReference(value: string): boolean {
  return /\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(value)
}

/** 把 free-codex 配置中属于 codex-mcp 的部分写回 ~/.codex-mcp（供独立 codex-mcp 复用） */
export function syncCodexMcpConfig(config: Config): { configPath: string; mcpPath: string; ymlPath: string } {
  mkdirSync(codexDir(), { recursive: true })
  const gateway = config.gateway

  // 1) config.json：只更新 free-codex 管理的字段，codex-mcp 独有字段保留。
  //    公网字段只在 free-codex 有真实值时覆盖；空值不删除（避免启动时空配置清掉本地已有的 codex-mcp 公网配置）。
  const codexConfig = readJson(codexConfigPath())
  codexConfig.host = gateway.host
  codexConfig.port = gateway.port
  codexConfig.ui = config.ui
  if (gateway.domain) codexConfig.domain = gateway.domain
  if (gateway.tunnelId) codexConfig.tunnelId = gateway.tunnelId
  if (gateway.cloudflaredBin) codexConfig.cloudflaredBin = gateway.cloudflaredBin
  if (gateway.tunnelName) codexConfig.tunnelName = gateway.tunnelName
  if (gateway.publicEnabled === true) codexConfig.useCloudflared = true
  writeFileSync(codexConfigPath(), `${JSON.stringify(codexConfig, null, 4)}\n`, 'utf8')

  // 2) mcp.json：启用 → mcpServers，禁用 → disabledServers（与 codex-mcp user-mcp.ts 语义一致）
  const mcpServers: Record<string, unknown> = {}
  const disabledServers: string[] = []
  for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
    if (server.disabled === true) {
      disabledServers.push(name)
      continue
    }
    const copy: Record<string, unknown> = { ...server }
    delete copy.disabled
    // codex-mcp 加载 mcp.json 时会拒绝裸敏感 header（须用 ${ENV} 引用）→ 这类服务器只留在 free-codex，不回写
    const hasRawSensitiveHeader = Object.entries(server.headers ?? {}).some(
      ([key, value]) => isSensitiveHeaderKey(key) && !hasEnvReference(value),
    )
    if (hasRawSensitiveHeader) {
      console.warn(`[codex-sync] 服务器「${name}」含裸敏感 header，不回写到 ~/.codex-mcp/mcp.json`)
      continue
    }
    mcpServers[name] = copy
  }
  writeFileSync(codexMcpJsonPath(), `${JSON.stringify({ mcpServers, disabledServers }, null, 2)}\n`, 'utf8')

  // 3) cloudflared.yml：free-codex 已有隧道配置 → 复制到 codex-mcp 位置（无则不动，避免覆盖独立维护的配置）
  if (gateway.tunnelConfigPath && existsSync(gateway.tunnelConfigPath)) {
    writeFileSync(codexTunnelYmlPath(), readFileSync(gateway.tunnelConfigPath, 'utf8'), 'utf8')
  }

  return { configPath: codexConfigPath(), mcpPath: codexMcpJsonPath(), ymlPath: codexTunnelYmlPath() }
}

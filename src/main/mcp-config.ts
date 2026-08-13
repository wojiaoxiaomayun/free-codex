/**
 * 下游 MCP 服务器管理（free-codex 自持）
 *
 * 原先读写 ~/.codex-mcp/mcp.json，现全部存入 free-codex 的 userData/config.json
 * （Config.mcpServers 字段），不再依赖 codex-mcp 的配置体系。
 * 修改后需重启 Gateway 才会重新连接下游。
 */

import { app } from 'electron'
import { join } from 'node:path'
import type { Config, McpServerConfig } from './config'

/** free-codex 配置文件路径（userData/config.json） */
export function getMcpConfigPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

/** 系统 MCP 名称（保留，不允许用户创建同名下游 / 删除） */
export const SYSTEM_MCP_NAMES = new Set(['todos'])

/** 系统 MCP 条目（设置页展示，仅开关、不可删除） */
export type SystemMcpEntry = {
  name: string
  enabled: boolean
  description: string
}

/** 列出下游服务器（含禁用状态 + 系统 MCP） */
export function listMcpServers(config: Config): { mcpServers: Record<string, McpServerConfig>; path: string; system: SystemMcpEntry[] } {
  return {
    mcpServers: { ...config.mcpServers },
    path: getMcpConfigPath(),
    system: [
      {
        name: 'todos',
        enabled: config.todos.enabled === true,
        description: '系统 MCP：进程内任务清单服务。开启后向 ChatGPT 注入 todos 工作流要求（每轮快照 + 未更新提醒），并注册为下游服务器；关闭则不注入。',
      },
    ],
  }
}

/** 新增/更新一个服务器（写回 config.mcpServers，由调用方 saveConfig 持久化） */
export function setMcpServer(config: Config, name: string, server: McpServerConfig): Config {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('MCP 名称只允许字母、数字、下划线和连字符')
  if (SYSTEM_MCP_NAMES.has(name)) throw new Error(`「${name}」是系统 MCP，不允许创建同名服务器`)
  config.mcpServers[name] = server
  return config
}

/** 删除一个服务器（系统 MCP 不可删除） */
export function deleteMcpServer(config: Config, name: string): Config {
  if (SYSTEM_MCP_NAMES.has(name)) return config
  delete config.mcpServers[name]
  return config
}

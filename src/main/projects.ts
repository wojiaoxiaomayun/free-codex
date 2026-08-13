/**
 * 项目（Project）管理
 *
 * 一个"项目" = 绑定到 MCP Gateway 的目录（project root）。激活项目会：
 * 1. 确保目录存在（不存在则创建）
 * 2. 持久化 config.json 的 projectRoot + gateway.projectRoot（运行中的网关由
 *    上层 handler 调 applyGatewayConfig 自动重启使其立即生效）
 * 3. 更新 ~/.free-codex/projects.json 历史（去重、最近在前，最多 20 条）
 */

import { app, dialog, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import type { Config } from './config'
import type { NodeMcpGateway } from './mcp-gateway'

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
  /** 网关应用新项目配置的结果（上层 handler 自动重启后附加） */
  gateway?: {
    /** 网关是否已重启（运行中切换项目会自动重启使其立即生效） */
    restarted: boolean
    url?: string
    restartError?: string
  }
  state?: ProjectState
}

/** 历史最多保留条数 */
const HISTORY_LIMIT = 20

// ------------------------------------------------------------
// 文件持久化
// ------------------------------------------------------------

function projectsFilePath(): string {
  return join(app.getPath('home'), '.free-codex', 'projects.json')
}

/** 读取项目历史（无文件返回空状态） */
function readProjects(): ProjectState {
  try {
    if (!existsSync(projectsFilePath())) return { active: null, history: [] }
    const data = JSON.parse(readFileSync(projectsFilePath(), 'utf-8')) as Partial<ProjectState>
    return {
      active: typeof data.active === 'string' ? data.active : null,
      history: Array.isArray(data.history) ? data.history : [],
    }
  } catch (err) {
    console.error('[project] 读取历史失败:', err)
    return { active: null, history: [] }
  }
}

/** 保存项目历史 */
function writeProjects(state: ProjectState): void {
  try {
    const file = projectsFilePath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8')
  } catch (err) {
    console.error('[project] 保存历史失败:', err)
  }
}

// ------------------------------------------------------------
// 历史合并
// ------------------------------------------------------------

/** Windows 路径大小写不敏感去重 */
function samePath(a: string, b: string): boolean {
  const x = resolve(a)
  const y = resolve(b)
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

/** 把项目插入历史最前（去重、截断） */
function mergeHistory(history: ProjectInfo[], path: string, name: string, now: number): ProjectInfo[] {
  const rest = history.filter((item) => !samePath(item.path, path))
  return [{ path: resolve(path), name, lastOpened: now }, ...rest].slice(0, HISTORY_LIMIT)
}

// ------------------------------------------------------------
// ProjectManager
// ------------------------------------------------------------

export interface ProjectManager {
  /** 当前状态（active + history） */
  getState: () => ProjectState
  /** 激活一个项目目录 */
  activate: (path: string) => Promise<ProjectActionResult>
  /** 弹系统文件夹选择器并激活 */
  openFolder: () => Promise<ProjectActionResult>
}

export function createProjectManager(
  getConfig: () => Config,
  saveConfig: (config: Config) => void,
  gateway: NodeMcpGateway,
  mainWindow: BrowserWindow,
): ProjectManager {
  /** 激活项目：确保目录存在 + 持久化 projectRoot + 同步网关配置 + 记录历史 */
  async function activate(path: string): Promise<ProjectActionResult> {
    const target = resolve(path)
    try {
      mkdirSync(target, { recursive: true })
    } catch (err) {
      return { ok: false, error: `创建项目目录失败: ${err instanceof Error ? err.message : String(err)}` }
    }

    // 1. 持久化 projectRoot（config.json，重启后仍生效）
    const config = getConfig()
    config.projectRoot = target
    config.gateway.projectRoot = target
    saveConfig(config)

    // 2. 网关配置同步（未运行时更新；运行中由上层 handler 调 applyGatewayConfig 自动重启）
    if (!gateway.running) {
      try {
        gateway.update(config.gateway)
      } catch (err) {
        const msg = `网关配置更新失败: ${err instanceof Error ? err.message : String(err)}`
        console.error('[project] gateway.update 失败:', msg)
        return { ok: false, error: msg }
      }
    }

    // 3. 更新历史
    const prev = readProjects()
    const name = basename(target)
    const state: ProjectState = {
      active: target,
      history: mergeHistory(prev.history, target, name, Date.now()),
    }
    writeProjects(state)

    return { ok: true, state }
  }

  /** 弹系统文件夹选择器 */
  async function openFolder(): Promise<ProjectActionResult> {
    const options: Electron.OpenDialogOptions = {
      title: '打开项目文件夹',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options)
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true }
    }
    return await activate(result.filePaths[0])
  }

  return {
    getState: readProjects,
    activate,
    openFolder,
  }
}

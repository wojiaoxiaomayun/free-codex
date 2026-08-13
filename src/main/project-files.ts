/**
 * 递归列出项目文件（@ 文件命令面板用）
 */

import { readdir } from 'fs/promises'
import { join } from 'path'

export interface ProjectFileEntry {
  /** 绝对路径 */
  path: string
  /** 项目相对路径（面板列表展示，统一 / 分隔） */
  relPath: string
  /** 文件名（basename） */
  name: string
}

const SKIP_DIRS = new Set(['node_modules'])

export async function listProjectFiles(root: string, limit = 1000): Promise<ProjectFileEntry[]> {
  const out: ProjectFileEntry[] = []
  let count = 0

  async function walk(dir: string, rel: string): Promise<void> {
    if (count >= limit) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (count >= limit) return
      const name = ent.name
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
        await walk(join(dir, name), rel ? `${rel}/${name}` : name)
      } else if (ent.isFile()) {
        const relPath = rel ? `${rel}/${name}` : name
        out.push({ path: join(dir, name), relPath, name })
        count++
      }
    }
  }
  await walk(root, '')
  return out
}

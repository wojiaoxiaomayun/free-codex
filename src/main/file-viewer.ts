/**
 * 文件预览 / 编辑（overlay File Explorer）IPC 后端
 *
 * 所有读写都经过路径隔离：只允许访问当前激活项目根目录内的文件，
 * 拒绝越界路径与符号链接逃逸（realpath 双重校验）。
 * 写入带 mtime 乐观并发检查：磁盘上的文件被外部修改时返回 conflict，
 * 由 UI 决定覆盖还是放弃。
 *
 * 文本读取统一归一化为 LF（编辑器友好），同时记录原始 EOL（\n / \r\n），
 * 保存时还原，避免对 CRLF 文件产生整文件 diff。
 */

import { shell } from 'electron'
import { existsSync, realpathSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, resolve, sep } from 'path'

/** 文本预览/编辑大小上限（超过则截断并标记 truncated，UI 提示用系统编辑器打开） */
export const MAX_TEXT_SIZE = 1024 * 1024

export type FileKind = 'text' | 'binary'

export interface ReadFileResult {
  ok: boolean
  kind?: FileKind
  /** UTF-8 文本内容（binary / 失败时为空；已归一化为 LF） */
  content?: string
  /** 文件大小（字节） */
  size?: number
  /** 最后修改时间（ms，保存冲突检测用） */
  mtimeMs?: number
  /** 原始换行符（\n 或 \r\n），保存时还原 */
  eol?: string
  /** 超过大小上限被截断 */
  truncated?: boolean
  error?: string
}

export interface WriteFileResult {
  ok: boolean
  /** 磁盘上的文件已被外部修改（mtime 不匹配），UI 需让用户确认是否覆盖 */
  conflict?: boolean
  error?: string
}

export interface WriteFileInput {
  /** 项目内相对路径 */
  relPath: string
  /** 编辑器内容（LF 归一化） */
  content: string
  /** 原始换行符（\r\n 时写盘前还原） */
  eol?: string
  /** 打开时的 mtimeMs；不匹配说明磁盘已被外部修改 */
  expectMtimeMs?: number
}

/** Windows 路径大小写不敏感比较 */
function normPath(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

/** target 是否位于 root 内部（含 root 自身） */
function isInside(root: string, target: string): boolean {
  const r = resolve(root)
  const t = resolve(target)
  const rr = normPath(r)
  const tt = normPath(t)
  if (tt === rr) return true
  return tt.startsWith(rr.endsWith(sep) ? rr : rr + sep)
}

/** 最近的已存在路径（写新文件时父目录可能尚不存在，用其校验符号链接逃逸） */
function nearestExistingParent(abs: string): string {
  let p = abs
  while (!existsSync(p)) {
    const parent = dirname(p)
    if (parent === p) break
    p = parent
  }
  return p
}

/**
 * 把项目相对路径解析为根目录内的绝对路径。
 * 越界 / 非法输入（含符号链接逃逸）返回 null。
 */
export function resolveProjectPath(root: string, relPath: string): string | null {
  if (typeof relPath !== 'string' || !relPath || relPath.includes('\0')) return null
  const abs = isAbsolute(relPath) ? resolve(relPath) : resolve(root, relPath)
  if (!isInside(root, abs)) return null
  // 符号链接逃逸检查：已存在路径取 realpath；不存在时对最近的已存在父目录校验
  const probe = existsSync(abs) ? abs : nearestExistingParent(abs)
  try {
    const realRoot = realpathSync(resolve(root))
    const realProbe = realpathSync(probe)
    if (!isInside(realRoot, realProbe)) return null
  } catch {
    return null
  }
  return abs
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 读取项目内文件（文本 / 二进制探测）。
 * 文本统一归一化为 LF，并记录原始 EOL 与 mtimeMs（保存冲突检测用）。
 */
export function readProjectFile(root: string, relPath: string): ReadFileResult {
  if (!root) return { ok: false, error: '尚未选择项目' }
  const abs = resolveProjectPath(root, relPath)
  if (!abs) return { ok: false, error: '路径越界：只能访问项目目录内的文件' }
  if (!existsSync(abs)) return { ok: false, error: '文件不存在或已被删除' }
  let stat
  try {
    stat = statSync(abs)
  } catch (err) {
    return { ok: false, error: `读取文件状态失败: ${errorMessage(err)}` }
  }
  if (!stat.isFile()) return { ok: false, error: '目标不是文件' }

  let buf: Buffer
  try {
    buf = readFileSync(abs)
  } catch (err) {
    return { ok: false, error: `读取文件失败: ${errorMessage(err)}` }
  }

  // 二进制探测：内容含 NUL 字节即视为二进制（文本文件不会出现）
  if (buf.includes(0)) {
    return { ok: true, kind: 'binary', size: buf.length, mtimeMs: stat.mtimeMs }
  }

  const truncated = buf.length > MAX_TEXT_SIZE
  const slice = truncated ? buf.subarray(0, MAX_TEXT_SIZE) : buf
  let text = slice.toString('utf8')
  // 去掉 UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  // 编辑器友好：统一 LF（CodeMirror 按 \n 分行，保留 \r 会显示异常）
  const normalized = eol === '\r\n' ? text.replace(/\r\n/g, '\n') : text
  return {
    ok: true,
    kind: 'text',
    content: normalized,
    size: buf.length,
    mtimeMs: stat.mtimeMs,
    eol,
    truncated,
  }
}

/**
 * 写入项目内文件（仅限项目根目录内；父目录必须已存在，Phase 1 不创建新目录）。
 * 传 expectMtimeMs 时做乐观并发检查：磁盘 mtime 不一致 → conflict。
 * eol 为 '\r\n' 时把 LF 内容还原为 CRLF 写盘。
 */
export function writeProjectFile(root: string, input: WriteFileInput): WriteFileResult {
  if (!root) return { ok: false, error: '尚未选择项目' }
  if (typeof input?.relPath !== 'string' || typeof input?.content !== 'string') {
    return { ok: false, error: 'invalid-input' }
  }
  const abs = resolveProjectPath(root, input.relPath)
  if (!abs) return { ok: false, error: '路径越界：只能写入项目目录内的文件' }

  const existed = existsSync(abs)
  if (existed) {
    let stat
    try {
      stat = statSync(abs)
    } catch (err) {
      return { ok: false, error: `读取文件状态失败: ${errorMessage(err)}` }
    }
    if (!stat.isFile()) return { ok: false, error: '目标不是文件' }
    if (input.expectMtimeMs != null && Math.abs(stat.mtimeMs - input.expectMtimeMs) > 1) {
      return { ok: false, conflict: true, error: '文件已在磁盘上被外部修改' }
    }
  } else if (!existsSync(dirname(abs))) {
    return { ok: false, error: '父目录不存在' }
  }

  let content = input.content
  if (input.eol === '\r\n') content = content.replace(/\n/g, '\r\n')

  try {
    writeFileSync(abs, content, 'utf8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `写入失败: ${errorMessage(err)}` }
  }
}

/** 在系统默认编辑器中打开（大文件 / 二进制兜底） */
export async function openFileExternally(root: string, relPath: string): Promise<{ ok: boolean; error?: string }> {
  if (!root) return { ok: false, error: '尚未选择项目' }
  const abs = resolveProjectPath(root, relPath)
  if (!abs) return { ok: false, error: '路径越界' }
  if (!existsSync(abs)) return { ok: false, error: '文件不存在' }
  try {
    const errorMessage = await shell.openPath(abs)
    return errorMessage ? { ok: false, error: errorMessage } : { ok: true }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

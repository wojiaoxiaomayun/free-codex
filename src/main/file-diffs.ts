/**
 * Diff 记录（对齐 freehub：hunk 化展示 + 整段撤销）
 *
 * 数据来源：codex-mcp 引擎的 edit / write / apply_patch 工具调用结果
 * （structuredContent.diff 已是 unified diff 文本），解析为带行号的 hunks。
 * 请求旁路时捕获文件 before 内容，支持：
 * - 整段撤销（undoHunk）：把当前文件"新侧"内容替换回"旧侧"，重算 diff 返回
 * - 整文件撤回（revertFile）：恢复到本次会话最原始的修改前内容
 * - 确认（confirmFile）：接受变更，移除记录
 */

import { structuredPatch } from 'diff'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { dirname } from 'path'
import { mkdirSync } from 'fs'

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

export interface FileDiffRecord {
  /** `${path}@${timestamp}@${rand6}` */
  id: string
  /** 项目内相对路径（展示用） */
  path: string
  /** 文件绝对路径（撤回写回用） */
  absPath: string
  /** 工具名（如 edit / apply_patch） */
  toolName: string
  /** unified diff 文本（引擎返回；撤销重算后为最新） */
  diffText: string
  /** 按 hunk 解析（DiffViewer 行号 / 整段撤销用） */
  hunks: DiffHunk[]
  additions: number
  deletions: number
  timestamp: number
  /** 撤回用（内存留存，不持久化）：文件 before 内容；null 表示执行前文件不存在 */
  before: string | null
}

/** 工具名按 lastIndexOf(':') 取短名匹配，兼容任意服务器前缀 */
function shortToolName(name: string): string {
  const idx = name.lastIndexOf(':')
  return idx >= 0 ? name.slice(idx + 1) : name
}

/** 这些工具的结果携带 unified diff（从 structuredContent.diff 提取） */
export const DIFF_CAPABLE_TOOLS = new Set(['edit', 'write', 'apply_patch'])

const MAX_RECORDS = 100
const store = new Map<string, FileDiffRecord>()

function prune(): void {
  while (store.size > MAX_RECORDS) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

/** 归一化换行（避免 CRLF/LF 差异影响 diff 计算） */
function normalize(s: string): string {
  return s.split(/\r?\n/).join('\n')
}

/**
 * 解析 unified diff 文本为 hunks。
 * 标准格式：@@ -oldStart[,oldCount] +newStart[,newCount] @@；
 * 行前缀：' ' 上下文、'+' 新增、'-' 删除、'\' 无换行符提示（忽略）。
 */
function parseUnifiedDiff(diffText: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  for (const rawLine of diffText.split(/\r?\n/)) {
    if (rawLine.startsWith('@@')) {
      const m = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (!m) continue
      if (current) hunks.push(current)
      current = { oldStart: Number(m[1]), newStart: Number(m[2]), lines: [] }
      continue
    }
    if (!current) continue
    const c = rawLine[0]
    if (c === '+') current.lines.push({ type: 'add', text: rawLine.slice(1) })
    else if (c === '-') current.lines.push({ type: 'del', text: rawLine.slice(1) })
    else current.lines.push({ type: 'ctx', text: c === ' ' ? rawLine.slice(1) : rawLine })
  }
  if (current) hunks.push(current)
  return hunks
}

/** 从 hunks 统计增删行数 */
function countFromHunks(hunks: DiffHunk[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') additions += 1
      else if (line.type === 'del') deletions += 1
    }
  }
  return { additions, deletions }
}

/** 读取执行前文件快照 */
export function captureBefore(absPath: string): string | null {
  try {
    return existsSync(absPath) ? readFileSync(absPath, 'utf8') : null
  } catch {
    return null
  }
}

export interface CreateDiffInput {
  /** 工具名（可带服务器前缀） */
  toolName: string
  /** 项目内相对路径（展示） */
  relPath: string
  /** 文件绝对路径 */
  absPath: string
  /** 引擎返回的 unified diff 文本 */
  diffText: string
  /** 执行前快照（null = 文件原本不存在） */
  before: string | null
}

/** 创建并存储一条 diff 记录（引擎 diff 文本 → hunks） */
export function createDiffRecord(input: CreateDiffInput): FileDiffRecord {
  const hunks = parseUnifiedDiff(input.diffText)
  const { additions, deletions } = countFromHunks(hunks)
  const record: FileDiffRecord = {
    id: `${input.relPath}@${Date.now()}@${Math.random().toString(36).slice(2, 8)}`,
    path: input.relPath,
    absPath: input.absPath,
    toolName: shortToolName(input.toolName),
    diffText: input.diffText,
    hunks,
    additions,
    deletions,
    timestamp: Date.now(),
    before: input.before,
  }
  store.set(record.id, record)
  prune()
  return record
}

/** 列出全部记录（最新在前） */
export function listDiffRecords(): FileDiffRecord[] {
  return [...store.values()].sort((a, b) => b.timestamp - a.timestamp)
}

/**
 * 撤销后重算 diff（对比 before 与当前内容，jsdiff 生成 unified hunks）。
 * 记录按原 id 替换，保留原始 before（后续整段撤销 / 整文件撤回仍以它为基线）。
 */
function makeDiffRecordFromBefore(params: {
  id: string
  path: string
  absPath: string
  toolName: string
  before: string
  beforeExisted: boolean
  after: string
  timestamp: number
}): FileDiffRecord | null {
  const normalizedBefore = normalize(params.before)
  const normalizedAfter = normalize(params.after)
  if (normalizedBefore === normalizedAfter) return null

  const patch = structuredPatch(params.path, params.path, normalizedBefore, normalizedAfter, '', '', { context: 3 })
  let additions = 0
  let deletions = 0
  const hunks: DiffHunk[] = patch.hunks.map((h) => {
    const lines: DiffLine[] = h.lines.map((line) => {
      if (line.startsWith('+')) {
        additions++
        return { type: 'add', text: line.slice(1) }
      }
      if (line.startsWith('-')) {
        deletions++
        return { type: 'del', text: line.slice(1) }
      }
      return { type: 'ctx', text: line.slice(1) }
    })
    return { oldStart: h.oldStart, newStart: h.newStart, lines }
  })

  const record: FileDiffRecord = {
    id: params.id,
    path: params.path,
    absPath: params.absPath,
    toolName: params.toolName,
    diffText: patch.toString(),
    hunks,
    additions,
    deletions,
    timestamp: params.timestamp,
    before: params.beforeExisted ? params.before : null,
  }
  store.set(record.id, record)
  prune()
  return record
}

// ------------------------------------------------------------
// 整段撤销（按 diff 块）
// ------------------------------------------------------------

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** 数组按顺序匹配：唯一命中返回起始下标，无匹配或多次匹配返回 -1 */
function uniqueSequenceIndex(arr: string[], seq: string[]): number {
  if (seq.length === 0) return -1
  let found = -1
  outer: for (let i = 0; i + seq.length <= arr.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (arr[i + j] !== seq[j]) continue outer
    }
    if (found >= 0) return -1 // 多处匹配 → 歧义，拒绝
    found = i
  }
  return found
}

/**
 * 撤销整个 diff 块：把当前文件中的"新侧"内容替换回"旧侧"内容。
 * 优先按块起始行号定位并整体校验（新侧块为签名），失败回退唯一块匹配；
 * 若当前位置已是旧侧内容（该段已被手动恢复），则视为已撤销、不做变更。
 */
function revertHunk(
  lines: string[],
  hunk: DiffHunk,
): { ok: true; lines: string[] } | { ok: false; error: string } {
  const oldSide: string[] = []
  const newSide: string[] = []
  for (const line of hunk.lines) {
    if (line.type !== 'add') oldSide.push(line.text)
    if (line.type !== 'del') newSide.push(line.text)
  }

  const start = hunk.newStart - 1
  const end = start + newSide.length
  const spliceReplace = (at: number): string[] => {
    const next = lines.slice()
    next.splice(at, newSide.length, ...oldSide)
    return next
  }

  // 1) 正常撤销：按行号定位新侧块并整体替换为旧侧
  if (newSide.length > 0 && end <= lines.length && arraysEqual(lines.slice(start, end), newSide)) {
    return { ok: true, lines: spliceReplace(start) }
  }
  // 2) 已恢复：当前位置已是旧侧内容 → 无需变更
  if (
    oldSide.length > 0 &&
    start + oldSide.length <= lines.length &&
    arraysEqual(lines.slice(start, start + oldSide.length), oldSide)
  ) {
    return { ok: true, lines }
  }
  // 3) 文件被后续修改（块位置偏移）：唯一匹配新侧块 → 替换
  if (newSide.length > 0) {
    const idx = uniqueSequenceIndex(lines, newSide)
    if (idx >= 0) return { ok: true, lines: spliceReplace(idx) }
  }
  // 4) 唯一匹配旧侧块（已恢复但位置移动）→ 不做变更
  if (oldSide.length > 0) {
    const idx = uniqueSequenceIndex(lines, oldSide)
    if (idx >= 0) return { ok: true, lines }
  }
  // 5) 纯删除块（新侧为空，无上下文可定位）：在原删除位置插回
  if (newSide.length === 0 && start >= 0 && start <= lines.length) {
    const next = lines.slice()
    next.splice(start, 0, ...oldSide)
    return { ok: true, lines: next }
  }
  return { ok: false, error: '无法定位该段变更，文件可能已被后续修改' }
}

/** 写回撤销结果：原本不存在的文件若结果为空则删除，否则写入内容（保留换行风格与末尾换行） */
function writeResult(absPath: string, lines: string[], eol: string, existed: boolean, trailingEol: boolean): void {
  const text = lines.join(eol)
  // split/join 或 hunk 替换可能丢掉末尾换行 → 原文件以换行结尾时补回
  const finalText = trailingEol && !text.endsWith(eol) ? text + eol : text
  if (!existed && finalText === '') {
    try {
      rmSync(absPath, { force: true })
    } catch {
      /* 文件不存在则忽略 */
    }
    return
  }
  writeFileSync(absPath, finalText, 'utf8')
}

/** 整段撤销结果（diff 为 null 表示该文件已完全恢复原状，应移除记录） */
export interface DiffHunkUndoResult {
  ok: boolean
  error?: string
  diff?: FileDiffRecord | null
}

/**
 * 撤销整个 diff 块：替换当前文件 → 重算 diff 返回。
 * @returns diff 为 null 表示该文件已完全恢复原状（应移除记录）
 */
export function undoHunk(id: string, hunkIndex: number): DiffHunkUndoResult {
  const record = store.get(id)
  if (!record) return { ok: false, error: '该变更记录已失效（应用重启后无法撤销）' }
  const hunk = record.hunks[hunkIndex]
  if (!hunk) return { ok: false, error: '无法定位该 diff 块' }

  let raw: string
  try {
    raw = readFileSync(record.absPath, 'utf8')
  } catch {
    // 文件已被删除：若整条记录是"删除文件"（纯 del 块），恢复原内容
    const isPureDeletion = record.hunks.every((h) => h.lines.every((l) => l.type !== 'add'))
    if (isPureDeletion) {
      try {
        writeFileSync(record.absPath, record.before ?? '', 'utf8')
      } catch (err) {
        return { ok: false, error: `文件写入失败: ${err instanceof Error ? err.message : String(err)}` }
      }
      store.delete(record.id)
      return { ok: true, diff: null }
    }
    return { ok: false, error: '文件读取失败或已被删除' }
  }
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const trailingEol = /(?:\r\n|\n)$/.test(raw)
  const lines = raw.split(/\r?\n/)

  const applied = revertHunk(lines, hunk)
  if (!applied.ok) return { ok: false, error: applied.error }

  try {
    writeResult(record.absPath, applied.lines, eol, record.before === null, trailingEol)
  } catch (err) {
    return { ok: false, error: `文件写入失败: ${err instanceof Error ? err.message : String(err)}` }
  }

  // 重新对比原始内容：完全恢复则移除记录，否则返回更新后的 diff
  if (!existsSync(record.absPath)) {
    // 写回后文件不存在 = 原本不存在且结果为空 → 已按原样恢复（删除）
    store.delete(record.id)
    return { ok: true, diff: null }
  }
  const after = readFileSync(record.absPath, 'utf8')
  const beforeText = record.before ?? ''
  if (normalize(after) === normalize(beforeText)) {
    store.delete(record.id)
    return { ok: true, diff: null }
  }
  const updated = makeDiffRecordFromBefore({
    id: record.id,
    path: record.path,
    absPath: record.absPath,
    toolName: record.toolName,
    before: beforeText,
    beforeExisted: record.before !== null,
    after,
    timestamp: record.timestamp,
  })
  if (!updated) {
    store.delete(record.id)
    return { ok: true, diff: null }
  }
  return { ok: true, diff: updated }
}

/** 整文件撤回：写回 before 内容（before 为 null 表示删除文件） */
export function revertFile(id: string): { ok: boolean; error?: string } {
  const record = store.get(id)
  if (!record) return { ok: false, error: '记录不存在或已被确认' }
  try {
    if (record.before === null) {
      rmSync(record.absPath, { force: true })
    } else {
      mkdirSync(dirname(record.absPath), { recursive: true })
      writeFileSync(record.absPath, record.before, 'utf8')
    }
    store.delete(record.id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 确认变更：接受当前内容，移除记录 */
export function confirmFile(id: string): { ok: boolean; error?: string } {
  const record = store.get(id)
  if (!record) return { ok: false, error: '记录不存在' }
  store.delete(id)
  return { ok: true }
}

/** 供调试/清理 */
export function clearDiffRecords(): void {
  store.clear()
}

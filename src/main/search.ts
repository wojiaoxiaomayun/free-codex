/**
 * 全文搜索（ripgrep）IPC 后端
 *
 * 用 @vscode/ripgrep 的预编译 rg 二进制做跨项目内容搜索：
 * - `rg --json` 逐行解析输出（begin / match / end / summary），转成渲染层友好结构
 * - 匹配结果字节偏移 → 字符偏移（UTF-8 安全，中文高亮不错位）
 * - 结果路径转换回项目相对路径（/ 分隔），并做越界校验（纵深防御）
 * - 全局结果上限截断、超时保护、新搜索/取消时杀掉旧进程
 * - 忽略规则与文件树一致：跳过 node_modules / .git / 点目录（--no-ignore 不尊重 .gitignore）
 */

import { spawn, type ChildProcess } from 'child_process'
import { createRequire } from 'node:module'
import { isAbsolute, relative, resolve, sep } from 'path'

const require = createRequire(import.meta.url)

/**
 * rg 二进制路径。
 * 开发模式：node_modules 里的真实文件；
 * 打包模式：asar 内路径 → 替换为 app.asar.unpacked（asarUnpack 已配置解包二进制）。
 */
function resolveRgPath(): string {
  let p: string
  try {
    p = require.resolve(`@vscode/ripgrep-${process.platform}-${process.arch}/bin/rg${process.platform === 'win32' ? '.exe' : ''}`)
  } catch {
    p = require.resolve('@vscode/ripgrep')
  }
  return p.includes('app.asar') ? p.replace('app.asar', 'app.asar.unpacked') : p
}

const rgPath = resolveRgPath()

export interface SearchOptions {
  /** 区分大小写（默认忽略大小写） */
  caseSensitive?: boolean
  /** 正则（默认按字面量） */
  regex?: boolean
  /** 全词匹配 */
  wholeWord?: boolean
  /** 仅搜索匹配这些 glob 的文件（多个取并集；如 *.ts、src 目录） */
  include?: string[]
  /** 排除匹配这些 glob 的文件（如 dist 目录、*.min.js） */
  exclude?: string[]
}

export interface SearchHighlight {
  /** 行内字符偏移（含） */
  start: number
  /** 行内字符偏移（不含） */
  end: number
}

export interface SearchMatch {
  /** 项目内相对路径（/ 分隔，与文件树一致） */
  file: string
  /** 1-based 行号 */
  line: number
  /** 行内容（已去尾换行） */
  text: string
  /** 匹配区间（可能一行多个） */
  highlights: SearchHighlight[]
}

export interface SearchRunResult {
  ok: boolean
  results: SearchMatch[]
  /** 达到全局上限被截断 */
  truncated: boolean
  error?: string
}

/** 全局结果上限（超过即杀掉 rg，避免大仓库撑爆内存） */
const MAX_RESULTS = 1000
/** 单次搜索硬超时（正常情况 rg 远快于此） */
const TIMEOUT_MS = 30_000

let currentProc: ChildProcess | null = null

/** 标记并终止进程（截断/超时/取消都是主动行为，结果仍按已有数据返回） */
function killProc(proc: ChildProcess): void {
  ;(proc as ChildProcess & { __intentional?: boolean }).__intentional = true
  proc.kill()
}

/** 取消当前搜索（新搜索开始 / 渲染层主动取消） */
export function cancelSearch(): void {
  if (currentProc && !currentProc.killed) killProc(currentProc)
  currentProc = null
}

/** rg 输出的绝对路径 → 项目内相对路径；越界返回 null（纵深防御，正常不会发生） */
function toRelPath(root: string, abs: string): string | null {
  const target = isAbsolute(abs) ? abs : resolve(root, abs)
  const rel = relative(resolve(root), resolve(target))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return rel.split(sep).join('/')
}

/** 字节偏移 → UTF-8 字符偏移（rg 的 submatch 偏移是字节；直接 slice 中文会错位） */
function byteToCharIndex(text: string, byteIndex: number): number {
  if (byteIndex <= 0) return 0
  return Buffer.from(text, 'utf8').subarray(0, byteIndex).toString('utf8').length
}

export function runSearch(
  root: string,
  pattern: string,
  options: SearchOptions = {},
): Promise<SearchRunResult> {
  return new Promise((resolvePromise) => {
    if (!root || typeof pattern !== 'string' || !pattern.trim()) {
      resolvePromise({ ok: false, results: [], truncated: false, error: '参数无效' })
      return
    }
    // 新搜索直接取代旧搜索
    cancelSearch()

    const args: string[] = [
      '--json',
      '-n',
      '--max-columns', '500',
      '--max-filesize', '1M',
      // 与文件树（listProjectFiles）保持一致：忽略 .gitignore，只跳过 node_modules/.git/点目录
      '--no-ignore',
      '--hidden',
      '--glob', '!.*/**',
      '--glob', '!node_modules/**',
      '--glob', '!.git/**',
      '-m', '200', // 每文件匹配行上限
    ]
    args.push(options.caseSensitive ? '-s' : '-i')
    if (options.wholeWord) args.push('-w')
    if (!options.regex) args.push('--fixed-strings')
    // include / exclude glob（VS Code 风格：include 取并集，exclude 扣除）
    for (const g of options.include ?? []) if (g) args.push('--glob', g)
    for (const g of options.exclude ?? []) if (g) args.push('--glob', `!${g}`)
    args.push('-e', pattern, '--', root)

    const proc = spawn(rgPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    currentProc = proc

    let out = ''
    let stderr = ''
    const results: SearchMatch[] = []
    let truncated = false
    let settled = false

    const finish = (res: SearchRunResult): void => {
      if (settled) return
      settled = true
      if (currentProc === proc) currentProc = null
      resolvePromise(res)
    }

    const timer = setTimeout(() => {
      killProc(proc)
      finish({ ok: false, results, truncated, error: '搜索超时，已终止' })
    }, TIMEOUT_MS)

    function handleLine(line: string): void {
      if (!line) return
      let parsed: { type?: string; data?: Record<string, unknown> }
      try {
        parsed = JSON.parse(line) as { type?: string; data?: Record<string, unknown> }
      } catch {
        return
      }
      if (parsed.type !== 'match') return
      const d = parsed.data ?? {}
      const absPath = d.path as { text?: unknown } | undefined
      const abs = typeof absPath?.text === 'string' ? absPath.text : ''
      const lineNo = d.line_number
      const linesObj = d.lines as { text?: unknown } | undefined
      const rawText = typeof linesObj?.text === 'string' ? linesObj.text : ''
      const submatches = Array.isArray(d.submatches)
        ? (d.submatches as Array<{ start?: unknown; end?: unknown }>)
        : []
      if (!abs || typeof lineNo !== 'number') return
      const rel = toRelPath(root, abs)
      if (!rel) return // 越界 → 丢弃
      if (results.length >= MAX_RESULTS) {
        truncated = true
        killProc(proc)
        return
      }
      const text = rawText.replace(/\r?\n$/, '')
      results.push({
        file: rel,
        line: lineNo,
        text,
        highlights: submatches
          .map((sm) => ({
            start: byteToCharIndex(text, typeof sm.start === 'number' ? sm.start : 0),
            end: byteToCharIndex(text, typeof sm.end === 'number' ? sm.end : 0),
          }))
          .filter((h) => h.end > h.start),
      })
    }

    proc.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
      let idx: number
      while ((idx = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, idx)
        out = out.slice(idx + 1)
        handleLine(line)
        if (truncated) break
      }
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      finish({ ok: false, results, truncated, error: `搜索进程启动失败: ${err.message}` })
    })
    // 只以 close 收尾（进程退出且 stdio 流关闭后触发）：rg 的错误（如无效正则）写 stderr
    // 并以非 0 退出，若在 stdout 'end' 时提前结算会把错误误判为成功
    proc.on('close', (code, signal) => {
      clearTimeout(timer)
      if (settled) return
      if ((proc as ChildProcess & { __intentional?: boolean }).__intentional) {
        // 截断/超时/取消导致的终止：以已有结果返回
        finish({ ok: true, results, truncated })
        return
      }
      // rg 无匹配时退出码 1，不是错误
      if (code === 1 || code === 0) {
        finish({ ok: true, results, truncated })
        return
      }
      const detail = stderr.trim() || `rg 异常退出 (${code ?? signal})`
      finish({ ok: false, results, truncated, error: detail })
    })
  })
}

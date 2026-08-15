/**
 * 终端页面（主窗口底部 termView）：xterm.js + ConPTY 会话
 *
 * - fit 自适应 + ResizeObserver 上报尺寸
 * - Ctrl+Shift+C 复制 / Ctrl+Shift+V 粘贴 / 右键粘贴（Windows Terminal 习惯）
 * - Ctrl+Shift+F 搜索（Enter 下一个 / Shift+Enter 上一个 / Esc 关闭）
 * - 明暗主题跟随应用
 */

import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'

const darkTheme = {
  background: '#1e1f22',
  foreground: '#cccccc',
  cursor: '#aeafad',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#f14c4c',
  green: '#6ccb5f',
  yellow: '#d9d973',
  blue: '#3b8eea',
  magenta: '#d670d6',
  cyan: '#42b3c2',
  white: '#d4d4d4',
  brightBlack: '#808080',
  brightRed: '#ff6b6b',
  brightGreen: '#89d88a',
  brightYellow: '#eaeaea',
  brightBlue: '#4ea1ff',
  brightMagenta: '#e36fe3',
  brightCyan: '#6ad6e6',
  brightWhite: '#ffffff',
}

const lightTheme = {
  background: '#ffffff',
  foreground: '#333333',
  cursor: '#333333',
  selectionBackground: '#add6ff',
  black: '#000000',
  red: '#cd3131',
  green: '#00bc00',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5',
}

const term = new Terminal({
  cursorBlink: true,
  fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
  fontSize: 13,
  lineHeight: 1.2,
  scrollback: 5000,
  allowProposedApi: true,
  theme: darkTheme,
})

const fit = new FitAddon()
const search = new SearchAddon()
term.loadAddon(fit)
term.loadAddon(new WebLinksAddon())
term.loadAddon(search)

const app = document.getElementById('app')
if (!app) throw new Error('no #app')
term.open(app)
fit.fit()
reportSize()

// ---------- 主题 ----------
function applyTheme(dark: boolean): void {
  term.options.theme = dark ? darkTheme : lightTheme
  document.body.style.background = (term.options.theme as { background: string }).background
}
window.termApi.onTheme((dark) => applyTheme(dark === true))

// ---------- 会话生命周期 ----------
window.termApi.onSession(() => {
  term.clear()
  fit.fit()
  reportSize()
  term.focus()
})
window.termApi.onData((data) => term.write(data))
window.termApi.onFocus(() => term.focus())
window.termApi.onExit((info) => {
  term.write(`\r\n\x1b[1;31m[进程已退出 code=${info.exitCode ?? '?'}]\x1b[0m\r\n`)
})

// 用户输入 → 主进程
term.onData((data) => window.termApi.write(data))

// ---------- 尺寸 ----------
const ro = new ResizeObserver(() => {
  fit.fit()
  reportSize()
})
ro.observe(document.body)

function reportSize(): void {
  window.termApi.resize(term.cols, term.rows)
}

// ---------- 复制 / 粘贴 / 搜索快捷键 ----------
function pasteText(): void {
  const text = window.termApi.paste()
  if (text) term.paste(text.replace(/\r?\n/g, '\r'))
}

term.attachCustomKeyEventHandler((e) => {
  // 语义：返回 false = 拦截（xterm 不再处理）；返回 true/undefined = 交给 xterm 正常处理
  if (e.type !== 'keydown') return true
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
    const sel = term.getSelection()
    if (sel) void navigator.clipboard.writeText(sel).catch(() => undefined)
    e.preventDefault()
    return false
  }
  if (mod && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
    pasteText()
    e.preventDefault()
    return false
  }
  if (mod && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
    toggleSearch()
    e.preventDefault()
    return false
  }
  // 其他按键全部交给 xterm（之前误返回 false 导致键盘输入被全部吞掉）
  return true
})

// 右键粘贴（Windows Terminal 习惯）：终端区域任意位置
term.element?.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  pasteText()
})

// ---------- 搜索浮层 ----------
const searchBox = document.getElementById('search') as HTMLElement
const searchInput = document.getElementById('searchInput') as HTMLInputElement
const searchCount = document.getElementById('searchCount') as HTMLElement
let searchResult: { resultIndex: number; resultCount: number } | null = null
/** 搜索匹配高亮装饰（isSearchDecorationOptions：overviewRuler 字段必填） */
const searchDecoration = {
  matchBackground: '#3a3a3a',
  matchOverviewRuler: '#3a3a3a',
  activeMatchBackground: '#8a6d1a',
  activeMatchColorOverviewRuler: '#8a6d1a',
}

search.onDidChangeResults((result) => {
  searchResult = result
  const total = result.resultCount
  const cur = total > 0 ? result.resultIndex + 1 : 0
  searchCount.textContent = total > 0 ? `${cur}/${total}` : '0/0'
})

function toggleSearch(): void {
  if (searchBox.classList.contains('hidden')) {
    searchBox.classList.remove('hidden')
    searchInput.value = term.getSelection() || ''
    searchInput.focus()
    void runSearch()
  } else {
    closeSearch()
  }
}

function closeSearch(): void {
  searchBox.classList.add('hidden')
  search.clearDecorations()
  term.focus()
}

async function runSearch(): Promise<void> {
  const q = searchInput.value
  if (!q) {
    search.clearDecorations()
    searchCount.textContent = ''
    return
  }
  await search.findNext(q, { incremental: true, decorations: searchDecoration })
}

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (e.shiftKey) void search.findPrevious(searchInput.value, { decorations: searchDecoration })
    else void search.findNext(searchInput.value, { decorations: searchDecoration })
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeSearch()
  } else {
    void runSearch()
  }
})
document.getElementById('searchPrev')!.addEventListener('click', () => {
  void search.findPrevious(searchInput.value, { decorations: searchDecoration })
})
document.getElementById('searchNext')!.addEventListener('click', () => {
  void search.findNext(searchInput.value, { decorations: searchDecoration })
})
document.getElementById('searchClose')!.addEventListener('click', closeSearch)

// ---------- 就绪：请求主进程拉起会话 ----------
window.termApi.ready()

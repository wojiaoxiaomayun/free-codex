/**
 * 终端页面（主窗口底部 termView）：xterm.js + ConPTY，多标签
 *
 * - 每个标签一个独立 xterm + PTY 会话（id 路由）
 * - 标签栏：点击切换 / × 关闭（中键关闭）/ + 新建 / 全部关闭后空态可重建
 * - 顶部拖拽手柄：pointerdown → 主进程轮询光标调整面板高度
 * - Ctrl+Shift+C 复制 / Ctrl+Shift+V 粘贴 / 右键粘贴 / Ctrl+Shift+F 搜索（作用于当前标签）
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

/** 搜索匹配高亮装饰（isSearchDecorationOptions：overviewRuler 字段必填） */
const searchDecoration = {
  matchBackground: '#3a3a3a',
  matchOverviewRuler: '#3a3a3a',
  activeMatchBackground: '#8a6d1a',
  activeMatchColorOverviewRuler: '#8a6d1a',
}

interface TermTab {
  id: string
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  host: HTMLElement
  label: string
}

const tabs: TermTab[] = []
let activeId: string | null = null
let tabSeq = 0
/** 首个标签是否已创建（延迟到面板首次打开，见 onFocus） */
let firstTabCreated = false

const tabbar = document.getElementById('tabbar') as HTMLElement
const container = document.getElementById('container') as HTMLElement
const emptyEl = document.getElementById('empty') as HTMLElement
const dragHandle = document.getElementById('drag-handle') as HTMLElement

// ---------- 主题 ----------
function applyTheme(isDark: boolean): void {
  document.body.classList.toggle('light', !isDark)
  document.body.style.background = isDark ? '#1e1f22' : '#ffffff'
  for (const t of tabs) t.term.options.theme = isDark ? darkTheme : lightTheme
}
window.termApi.onTheme((isDark) => applyTheme(isDark === true))

// ---------- 字体（Nerd Fonts 图标字形支持）----------
/** 常见 Nerd Font 名称（图标字形所在字体），按优先级探测 */
const NERD_FONTS = [
  'CaskaydiaCove Nerd Font',
  'CaskaydiaCove NF',
  'JetBrainsMono Nerd Font',
  'JetBrainsMono NF',
  'MesloLGM Nerd Font',
  'MesloLGM NF',
  'FiraCode Nerd Font',
  'FiraCode NF',
  'Hack Nerd Font',
  'Hack NF',
  'UbuntuMono Nerd Font',
  'SauceCodePro Nerd Font',
  'Cousine Nerd Font',
  'DejaVu Sans Mono Nerd Font',
  'VictorMono Nerd Font',
  'Iosevka Nerd Font',
  'SpaceMono Nerd Font',
  'Mononoki Nerd Font',
  'Terminess Nerd Font',
  'RobotoMono Nerd Font',
  '0xProto Nerd Font',
  'GeistMono Nerd Font',
  // 带 Powerline 符号的版本（部分图标可用）
  'Cascadia Code PL',
  'Cascadia Mono PL',
]

/** 当前选中的终端字体（null = 未确定） */
let selectedFont: string | null = null

function isFontAvailable(face: string): boolean {
  try {
    return document.fonts.check(`16px "${face}"`)
  } catch {
    return false
  }
}

function probeNerdFont(): string | null {
  for (const name of NERD_FONTS) {
    if (isFontAvailable(name)) return name
  }
  return null
}

function fontStack(): string {
  if (selectedFont) return `"${selectedFont}", 'Cascadia Mono', Consolas, 'Courier New', monospace`
  return "'Cascadia Mono', Consolas, 'Courier New', monospace"
}

/**
 * 应用字体：Nerd Font 优先（图标字形超集，含 Powerline 符号），
 * 其次 Windows Terminal 配置的字体（可用时），最后默认等宽字体。
 */
function resolveFont(wtFace: string | null): void {
  const candidate = probeNerdFont() ?? (wtFace && isFontAvailable(wtFace) ? wtFace : null)
  if (candidate === selectedFont) return
  selectedFont = candidate
  const stack = fontStack()
  for (const t of tabs) {
    t.term.options.fontFamily = stack
    try {
      t.fit.fit()
    } catch {
      /* ignore */
    }
    reportSize(t.id)
  }
}

window.termApi.onFont((face) => resolveFont(face ?? null))

// ---------- 标签管理 ----------
function findTab(id: string): TermTab | undefined {
  return tabs.find((t) => t.id === id)
}

function reportSize(id: string): void {
  const t = findTab(id)
  if (t) window.termApi.resize(id, t.term.cols, t.term.rows)
}

function pasteTo(term: Terminal): void {
  const text = window.termApi.paste()
  if (text) term.paste(text.replace(/\r?\n/g, '\r'))
}

function newTab(): TermTab {
  tabSeq += 1
  const id = `t${tabSeq}`
  const host = document.createElement('div')
  host.className = 'term-host'
  container.insertBefore(host, emptyEl)

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: fontStack(),
    fontSize: 13,
    lineHeight: 1.2,
    scrollback: 5000,
    allowProposedApi: true,
    theme: document.body.classList.contains('light') ? lightTheme : darkTheme,
  })
  const fit = new FitAddon()
  const search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon())
  term.loadAddon(search)
  search.onDidChangeResults((result) => {
    const total = result.resultCount
    const cur = total > 0 ? result.resultIndex + 1 : 0
    searchCount.textContent = total > 0 ? `${cur}/${total}` : '0/0'
  })
  term.open(host)

  // 用户输入 → 对应会话
  term.onData((data) => window.termApi.write(id, data))

  // 快捷键（语义：返回 false = 拦截，true = 交给 xterm）
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      const sel = term.getSelection()
      if (sel) void navigator.clipboard.writeText(sel).catch(() => undefined)
      e.preventDefault()
      return false
    }
    if (mod && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
      pasteTo(term)
      e.preventDefault()
      return false
    }
    if (mod && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      toggleSearch()
      e.preventDefault()
      return false
    }
    return true
  })

  // 右键粘贴
  term.element?.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    pasteTo(term)
  })

  const tab: TermTab = { id, term, fit, search, host, label: `终端 ${tabSeq}` }
  tabs.push(tab)
  renderTabBar()
  activateTab(id)
  window.termApi.spawn(id)
  return tab
}

function activateTab(id: string): void {
  activeId = id
  for (const t of tabs) t.host.style.display = t.id === id ? '' : 'none'
  emptyEl.classList.toggle('hidden', tabs.length > 0)
  renderTabBar()
  searchCount.textContent = ''
  const tab = findTab(id)
  if (tab) {
    try {
      tab.fit.fit()
    } catch {
      /* 容器暂不可见时忽略 */
    }
    reportSize(id)
    tab.term.focus()
  }
}

function closeTab(id: string): void {
  const idx = tabs.findIndex((t) => t.id === id)
  if (idx < 0) return
  const [tab] = tabs.splice(idx, 1)
  window.termApi.kill(id)
  tab.term.dispose()
  tab.host.remove()
  if (tabs.length === 0) {
    activeId = null
    renderTabBar()
    emptyEl.classList.remove('hidden')
  } else {
    activateTab(tabs[Math.min(idx, tabs.length - 1)].id)
  }
}

function renderTabBar(): void {
  tabbar.innerHTML = ''
  for (const t of tabs) {
    const el = document.createElement('div')
    el.className = 'tab' + (t.id === activeId ? ' active' : '')
    el.title = t.label
    const name = document.createElement('span')
    name.className = 'tab-name'
    name.textContent = t.label
    const close = document.createElement('span')
    close.className = 'tab-close'
    close.textContent = '×'
    close.title = '关闭终端'
    el.appendChild(name)
    el.appendChild(close)
    el.addEventListener('click', () => activateTab(t.id))
    close.addEventListener('click', (e) => {
      e.stopPropagation()
      closeTab(t.id)
    })
    // 中键关闭
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) closeTab(t.id)
    })
    tabbar.appendChild(el)
  }
  const addBtn = document.createElement('button')
  addBtn.className = 'tab-add'
  addBtn.textContent = '+'
  addBtn.title = '新建终端'
  addBtn.addEventListener('click', () => newTab())
  tabbar.appendChild(addBtn)
}

document.getElementById('empty-new')!.addEventListener('click', () => newTab())

// ---------- 会话事件路由 ----------
window.termApi.onData(({ id, data }) => findTab(id)?.term.write(data))
window.termApi.onSession(({ id }) => {
  const t = findTab(id)
  if (t) {
    t.term.clear()
    try {
      t.fit.fit()
    } catch {
      /* ignore */
    }
    reportSize(id)
  }
})
window.termApi.onExit(({ id, exitCode }) => {
  const t = findTab(id)
  if (t) t.term.write(`\r\n\x1b[1;31m[进程已退出 code=${exitCode ?? '?'}]\x1b[0m\r\n`)
})
window.termApi.onFocus(() => {
  // 首个标签延迟到面板首次打开时创建：页面加载时 termView 尚未显示（高度 0），
  // 此时创建 xterm 会按零宽度测量字符 → 文字竖排。面板显示后再建，尺寸才正确。
  if (!firstTabCreated) {
    firstTabCreated = true
    newTab()
  } else {
    findTab(activeId ?? '')?.term.focus()
  }
})
/** 项目切换：主进程已终止全部会话 → 清屏并逐个重拉（新 cwd） */
window.termApi.onRestartAll(() => {
  for (const t of tabs) {
    t.term.clear()
    window.termApi.spawn(t.id)
  }
})

// ---------- 尺寸 ----------
const ro = new ResizeObserver(() => {
  const t = findTab(activeId ?? '')
  if (t) {
    try {
      t.fit.fit()
    } catch {
      /* ignore */
    }
    reportSize(t.id)
  }
})
ro.observe(document.body)

// ---------- 高度拖拽（主进程轮询光标） ----------
dragHandle.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  window.termApi.dragStart()
})
document.addEventListener('pointerup', () => window.termApi.dragEnd())
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.termApi.dragEnd()
})

// ---------- 搜索浮层（作用于当前标签） ----------
const searchBox = document.getElementById('search') as HTMLElement
const searchInput = document.getElementById('searchInput') as HTMLInputElement
const searchCount = document.getElementById('searchCount') as HTMLElement

function activeSearch(): SearchAddon | null {
  return findTab(activeId ?? '')?.search ?? null
}

function toggleSearch(): void {
  if (searchBox.classList.contains('hidden')) {
    searchBox.classList.remove('hidden')
    searchInput.value = findTab(activeId ?? '')?.term.getSelection() || ''
    searchInput.focus()
    void runSearch()
  } else {
    closeSearch()
  }
}

function closeSearch(): void {
  searchBox.classList.add('hidden')
  activeSearch()?.clearDecorations()
  findTab(activeId ?? '')?.term.focus()
}

async function runSearch(): Promise<void> {
  const addon = activeSearch()
  const q = searchInput.value
  if (!addon || !q) {
    addon?.clearDecorations()
    searchCount.textContent = ''
    return
  }
  await addon.findNext(q, { incremental: true, decorations: searchDecoration })
}

searchInput.addEventListener('keydown', (e) => {
  const addon = activeSearch()
  if (!addon) return
  if (e.key === 'Enter') {
    e.preventDefault()
    if (e.shiftKey) void addon.findPrevious(searchInput.value, { decorations: searchDecoration })
    else void addon.findNext(searchInput.value, { decorations: searchDecoration })
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeSearch()
  } else {
    void runSearch()
  }
})
document.getElementById('searchPrev')!.addEventListener('click', () => {
  activeSearch()?.findPrevious(searchInput.value, { decorations: searchDecoration })
})
document.getElementById('searchNext')!.addEventListener('click', () => {
  activeSearch()?.findNext(searchInput.value, { decorations: searchDecoration })
})
document.getElementById('searchClose')!.addEventListener('click', closeSearch)

// ---------- 初始化 ----------
window.termApi.pageReady() // 清理孤儿会话（页面重载场景）
applyTheme(false) // 默认暗色，主进程随后推送主题
resolveFont(null) // 先做 Nerd Font 探测；term:font（Windows Terminal 配置）到达后覆盖
// 无标签时显示空态（首个标签由面板打开触发创建）
emptyEl.classList.remove('hidden')

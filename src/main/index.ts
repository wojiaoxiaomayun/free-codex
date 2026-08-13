import { app, BrowserWindow, BrowserWindowConstructorOptions, dialog, ipcMain, session, WebContentsView, type WebContents } from 'electron'
import { is } from '@electron-toolkit/utils'
import path from 'node:path'
import { loadConfig, saveConfig, type Config, type ProxyConfig } from './config'
import { NodeMcpGateway, defaultGoalStorageDir, type ToolCallRecord } from './mcp-gateway'
import { TodosServer, TODOS_REMINDER, type TodosStatus, type TodosUiState } from './todos-server'
import { TunnelManager } from './tunnel-manager'
import { listMcpServers, setMcpServer, deleteMcpServer } from './mcp-config'
import { TunnelSetupCoordinator, type TunnelAsk, type TunnelSetupInput } from './tunnel-setup'
import { hasAdminPassword, setAdminPassword, generateAdminPassword } from './auth'
import { SkillManager, getSkillDirectories } from './skills'
import { createProjectManager, type ProjectManager } from './projects'
import { listProjectFiles } from './project-files'
import { listDiffRecords, revertFile, confirmFile, undoHunk } from './file-diffs'
import {
  startChatgptTokenCapture,
  isChatgptLoggedIn,
  ensureDeveloperMode,
  isDeveloperModeEnabled,
  listInstalledPlugins,
  findPlugin,
  probeMcpOAuthConfig,
  listConversations,
  deleteConversation,
  deleteAllConversations,
} from './chatgpt-connector'
import {
  CHAT_FETCH_HOOK_SCRIPT,
  buildInjectionContext,
  buildTrimConversationScript,
  type InjectionSkill,
} from './chat-inject'
import { APPLY_THEME_SCRIPT } from './chat-theme'
import { applyUserAgentFallback, applySessionSpoofing, CHROME_UA } from './ua'

// 全局 UA fallback（必须在 app ready 之前设置，影响所有 webContents 的 navigator.userAgent）
applyUserAgentFallback()

const TITLEBAR_HEIGHT = 36
const PANEL_WIDTH = 348
const PANEL_RAIL = 40
const CHATGPT_URL = 'https://chatgpt.com/'
let win: BrowserWindow | undefined
let chatView: WebContentsView | undefined
let overlayWin: BrowserWindow | undefined
let config: Config
let gateway: NodeMcpGateway
/** todos 下游 server（进程内 HTTP MCP；启用时运行，独立于网关生命周期） */
let todosServer: TodosServer
/** cloudflared 隧道管理器（app 层能力；公网不可达时拉起，网关重启不触碰） */
let tunnelManager: TunnelManager | undefined
let skills: SkillManager
let projects: ProjectManager
let panelCollapsed = false
/** overlay 子窗口当前交互模式（none / toast / modal） */
let overlayMode: 'none' | 'toast' | 'modal' = 'none'
/** 鼠标是否悬停在 toast 上（toast 模式下临时放开鼠标穿透） */
let overlayInteractive = false
/** 上一个 overlay 模式（用于模态关闭后把焦点还给 ChatGPT 视图） */
let lastOverlayMode: 'none' | 'toast' | 'modal' = 'none'
/** ChatGPT 视图当前是否挂载可见 */
let viewVisible = true
/** hideForOverlay 临时隐藏（浮层关闭后需要恢复） */
let hiddenForOverlay = false
/** 当前主题（同步到 ChatGPT 页面）；默认白色 */
let currentThemeDark = false

// ------------------------------------------------------------
// 当前对话识别（CDP 求值 ChatGPT 页面：URL /c/{id} + fetch hook 记录的会话 ID）
// ------------------------------------------------------------

/** 页内探测脚本：返回当前对话 ID（首页/新会话为 null），页面不可用时 ok=false */
const CONVERSATION_PROBE_SCRIPT = `(() => {
  try {
    var m = location.pathname.match(/^\\/c\\/([^/]+)/);
    var urlId = m && m[1] ? m[1] : null;
    var injected = window.__freehubCurrentConversationId || null;
    return { ok: true, convId: urlId || injected };
  } catch (e) {
    return { ok: false };
  }
})()`

/** 当前对话 ID（null = 首页/新会话） */
let currentConvId: string | null = null
/** MCP 会话 → 对话 ID 映射（tools/call 发起时按当时的当前对话标记） */
const sessionToConv = new Map<string, string | null>()
let convPollTimer: ReturnType<typeof setInterval> | null = null
/** 检测读到的插件显示名（chatgpt:findPlugin 更新；注入插件名留空时使用） */
let detectedPluginName: string | null = null
/** 检测读到的插件 appId（asdk_app_xxx，fetch 层 @提及注入 system_hints 用） */
let detectedPluginAppId: string | null = null

/** 把插件提及信息写入页面全局（fetch hook 读取，自动 @提及注入） */
async function syncPluginMentionGlobals(): Promise<void> {
  const wc = chatView?.webContents
  if (!wc || wc.isDestroyed()) return
  // 开关控制：开启 → 写入检测到的 mycodex 提及信息（hook 自动 @提及注入）；关闭 → 清空（不注入）
  const enabled = config?.injections?.autoSelectPlugin === true
  const mention = enabled ? detectedPluginName ?? '' : ''
  const appId = enabled ? detectedPluginAppId : null
  await wc
    .executeJavaScript(`window.__freehubPluginMention = ${JSON.stringify(mention)}; window.__freehubPluginAppId = ${JSON.stringify(appId)}; 'ok'`)
    .catch(() => undefined)
}

/** 主动检测一次 freecodex 插件显示名（启动后页面/目录缓存就绪时调用），供注入使用 */
async function refreshDetectedPluginName(): Promise<void> {
  const domain = config?.gateway?.domain
  if (!domain) return
  const url = `https://${domain}/mcp`
  const wc = chatView?.webContents
  const catalogJson =
    wc && !wc.isDestroyed()
      ? await wc
          .executeJavaScript(`(() => { try { const k = Object.keys(localStorage).find(k => /system-connectors/.test(k)); return k ? localStorage.getItem(k) : null; } catch (e) { return null; } })()`)
          .catch(() => null)
      : null
  const result = await findPlugin({ url }, catalogJson)
  if (result?.displayName && result.displayName !== detectedPluginName) {
    detectedPluginName = result.displayName
    console.log('[inject] 检测到插件显示名:', detectedPluginName)
    void syncChatInjection()
  }
  if (result?.canonicalAppId && result.canonicalAppId !== detectedPluginAppId) {
    detectedPluginAppId = result.canonicalAppId
    console.log('[inject] 检测到插件 appId:', detectedPluginAppId)
    void syncPluginMentionGlobals()
  }
}

/** 轮询探测当前对话（变化时推送渲染层 + 更新会话归属） */
async function pollCurrentConversation(): Promise<void> {
  const wc = chatView?.webContents
  if (!wc || wc.isDestroyed()) return
  const res = (await wc.executeJavaScript(CONVERSATION_PROBE_SCRIPT).catch(() => ({ ok: false }))) as {
    ok?: boolean
    convId?: string | null
  }
  if (!res || res.ok !== true) return // 页面不可用/导航中，跳过本轮
  const next = res.convId || null
  if (next === currentConvId) return
  const prev = currentConvId
  currentConvId = next
  console.log('[conv] 当前对话变化:', prev, '->', next)
  if (next && !prev) {
    // 首页新会话获得真实 id → 'default' 桶迁移到真实对话（与 fetch hook 占位迁移一致）
    todosServer?.store.moveDefaultTo(next)
  }
  win?.webContents.send('mcp:conversation', { convId: next, at: Date.now() })
  void syncTodosGlobals()
}

function startConversationPolling(): void {
  if (convPollTimer) return
  void pollCurrentConversation()
  convPollTimer = setInterval(() => {
    void pollCurrentConversation()
    void autoTrimConversation()
  }, 1000)
}

// ------------------------------------------------------------
// 自动清理当前会话 DOM（防卡顿）：消息数超过保留数时删旧消息
// ------------------------------------------------------------

let lastAutoTrimAt = 0

/** 删除对话后刷新 ChatGPT 页面（左侧对话列表同步）；若当前在对话页则留在原页 */
function refreshChatgptSidebar(): void {
  const wc = chatView?.webContents
  if (!wc || wc.isDestroyed()) return
  console.log('[cleanup] 删除成功，刷新 ChatGPT 页面同步左侧列表')
  wc.reload()
}

async function autoTrimConversation(): Promise<void> {
  const cfg = config?.chatCleanup
  if (!cfg?.autoTrim) return
  const wc = chatView?.webContents
  if (!wc || wc.isDestroyed()) return
  // 节流：5 秒内最多清理一次
  const now = Date.now()
  if (now - lastAutoTrimAt < 5000) return
  const script = buildTrimConversationScript(cfg.trimKeep ?? 3)
  try {
    const res = (await wc.executeJavaScript(script).catch(() => null)) as { removed?: number; total?: number } | null
    if (res && res.removed && res.removed > 0) {
      lastAutoTrimAt = now
      console.log('[cleanup] 自动清理旧消息:', res.removed, '条（保留', cfg.trimKeep ?? 3, '条，共', res.total, '）')
    }
  } catch {
    /* 页面不可用忽略 */
  }
}

function layout() {
  if (!win || !chatView) return
  const [width, height] = win.getContentSize()
  const right = panelCollapsed ? PANEL_RAIL : PANEL_WIDTH
  chatView.setBounds({ x: 0, y: TITLEBAR_HEIGHT, width: Math.max(0, width - right), height: Math.max(0, height - TITLEBAR_HEIGHT) })
}

/** 挂载/卸载 ChatGPT 视图（WebContentsView 是原生层，渲染层浮层永远被它盖住） */
function setViewVisible(visible: boolean) {
  if (!win || !chatView || visible === viewVisible) return
  if (visible) {
    win.contentView.addChildView(chatView)
    layout()
  } else {
    win.contentView.removeChildView(chatView)
  }
  viewVisible = visible
}

// ------------------------------------------------------------
// overlay 子窗口：命令面板 / Diff / Toast 渲染在独立置顶透明窗口里，
// 浮在 ChatGPT 原生 WebContentsView 之上，避免 CSS z-index 无法覆盖原生层的问题。
// ------------------------------------------------------------

/** 让 overlay 子窗口与主窗口内容区对齐（透明窗口铺满，面板/toast 在内部定位） */
function syncOverlayBounds() {
  if (!win || win.isDestroyed() || !overlayWin || overlayWin.isDestroyed()) return
  // overlay 是独立窗口，坐标用屏幕绝对坐标（getContentBounds 返回值即屏幕坐标）
  const b = win.getContentBounds()
  overlayWin.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height })
}

/**
 * 按当前交互模式切换 overlay 窗口的显示/穿透/焦点：
 * - none：隐藏（无 toast 无面板）
 * - toast：显示但鼠标穿透（只有悬停在 toast 上才放开，以支持点击关闭）
 * - modal：显示 + 拦截交互 + 聚焦（面板/弹窗）
 */
function applyOverlayMode() {
  if (!overlayWin || overlayWin.isDestroyed()) return
  const wasModal = lastOverlayMode === 'modal'
  lastOverlayMode = overlayMode

  if (overlayMode === 'none') {
    overlayWin.setIgnoreMouseEvents(true, { forward: true })
    overlayWin.setFocusable(false)
    overlayWin.hide()
    return
  }

  const interactive = overlayMode === 'modal' || overlayInteractive
  if (interactive) {
    overlayWin.setIgnoreMouseEvents(false)
    overlayWin.setFocusable(true)
  } else {
    overlayWin.setIgnoreMouseEvents(true, { forward: true })
    overlayWin.setFocusable(false)
  }

  if (!overlayWin.isVisible()) {
    syncOverlayBounds()
    overlayWin.show()
    // show 之后立即再同步一次，兜底 Windows 在显示瞬间对窗口的再定位
    setImmediate(syncOverlayBounds)
  }
  if (interactive && !overlayWin.isFocused()) {
    overlayWin.focus()
  }
  // 模态关闭后把焦点还给 ChatGPT 视图
  if (wasModal && !interactive && viewVisible && chatView && !chatView.webContents.isDestroyed()) {
    chatView.webContents.focus()
  }
}

// ------------------------------------------------------------
// ChatGPT 页面主题同步（freehub 机制：写页面自身偏好 + 切换 html/body class，
// 取代旧的反色 invert hack；不刷新对话、对媒体无副作用）
// ------------------------------------------------------------

/** 应用主题到 ChatGPT 页面（写 localStorage['theme'] + 切换 dark/light class） */
async function applyChatTheme(dark: boolean) {
  const wc = chatView?.webContents
  if (!wc || wc.isDestroyed()) return
  try {
    await wc.executeJavaScript(`${APPLY_THEME_SCRIPT}(${JSON.stringify(dark ? 'dark' : 'light')})`)
  } catch (err) {
    console.warn('[theme] 同步 ChatGPT 主题失败:', err)
  }
  // overlay 是独立窗口，主题通过事件同步
  overlayWin?.webContents.send('overlay:theme', dark)
}

/** Ctrl+R：主窗口与 ChatGPT 视图内都拦截，改为打开项目选择面板（避免刷新页面） */
function registerCtrlR(webContents: WebContents) {
  webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'r') {
      event.preventDefault()
      overlayWin?.webContents.send('overlay:openProjectPalette')
    }
  })
}

/** F12 / Ctrl+Shift+I：打开对应视图的 DevTools（再按一次关闭）——查看注入/调试用 */
function registerDevToolsShortcut(webContents: WebContents) {
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const isF12 = input.key.toLowerCase() === 'f12'
    const isCtrlShiftI = input.control && input.shift && input.key.toLowerCase() === 'i'
    if (!isF12 && !isCtrlShiftI) return
    event.preventDefault()
    if (webContents.isDevToolsOpened()) webContents.closeDevTools()
    else webContents.openDevTools({ mode: 'detach' })
  })
}

/**
 * 同步注入上下文到 ChatGPT 页面全局（fetch hook 读取后在新会话首次请求注入）。
 * 按注入开关组合：项目路径 / 指定插件 / AGENTS.md / CLAUDE.md / 可用技能；
 * AGENTS.md、CLAUDE.md 项目里不存在时即使开启也不注入。无项目时写入空文本块。
 * 插件名：手动配置优先，留空时用检测读到的显示名（chatgpt:findPlugin 更新）。
 */
async function syncChatInjection(): Promise<void> {
  const wc = chatView?.webContents
  if (!wc || wc.isDestroyed()) return
  const root = projects?.getState().active || config?.projectRoot || null
  const injectionSkills: InjectionSkill[] = (skills?.list().skills ?? []).map((s) => ({
    name: s.name,
    description: s.description ?? '',
    scope: s.scope,
  }))
  const text = buildInjectionContext(root, config.injections, injectionSkills)
  await wc.executeJavaScript(`window.__freehubProjectContext = ${JSON.stringify(text)}`).catch(() => undefined)
  console.log('[inject] 注入上下文已同步:', root || '(无项目)', '| 长度:', text.length)
}

/** todos 渲染层/注入层共用状态（enabled + 当前对话清单） */
function todosUiState(): TodosUiState & { enabled: boolean } {
  const ui = todosServer?.getUiState() ?? { convId: currentConvId, list: null }
  return { enabled: config?.todos?.enabled === true, ...ui }
}

/**
 * 同步 todos 注入全局到 ChatGPT 页面（fetch hook 每请求读取）。
 * blockText = 规则 + 当前对话快照；incomplete + 页内 dirty 时 hook 追加提醒行。
 */
async function syncTodosGlobals(): Promise<void> {
  const wc = chatView?.webContents
  if (!wc || wc.isDestroyed()) return
  const enabled = config?.todos?.enabled === true && todosServer?.running === true
  const state = enabled
    ? {
        enabled: true,
        blockText: todosServer!.getBlockText(),
        incomplete: todosServer!.isIncomplete(),
        reminder: TODOS_REMINDER,
      }
    : { enabled: false, blockText: '', incomplete: false, reminder: '' }
  await wc.executeJavaScript(`window.__freehubTodosState = ${JSON.stringify(state)}`).catch(() => undefined)
}

/** todos_* 工具调用成功 → 页面 dirty 标记清零（下一请求不再注入"未更新"提醒） */
async function clearTodosDirty(): Promise<void> {
  const wc = chatView?.webContents
  if (!wc || wc.isDestroyed()) return
  await wc.executeJavaScript('window.__freehubTodosDirty = false; "ok"').catch(() => undefined)
}

/** 是否为对 todos 下游的 mcp_call（mcp_call { server: 'todos', tool: 'todos_*' }） */
function isTodosMcpCall(record: ToolCallRecord): boolean {
  if (record.tool !== 'mcp_call') return false
  const args = record.args as { server?: unknown; tool?: unknown } | undefined
  return (
    typeof args?.server === 'string' &&
    args.server.toLowerCase() === 'todos' &&
    typeof args.tool === 'string' &&
    args.tool.startsWith('todos_')
  )
}

/** 注入 ChatGPT 页面 fetch hook（ChatGPT 覆盖 window.fetch，须在页面加载完成后注入；失败自动重试） */
async function installChatFetchHook(retries = 3): Promise<void> {
  const wc = chatView?.webContents
  if (!wc || wc.isDestroyed()) return
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = (await wc.executeJavaScript(CHAT_FETCH_HOOK_SCRIPT)) as { ok?: boolean } | undefined
      if (res?.ok) {
        console.log('[inject] ChatGPT 页内 fetch hook 已注入')
        await syncChatInjection()
        await syncTodosGlobals()
        // 页面 reload 会清空页面全局 → 重写插件提及注入信息（@mycodex + appId）
        await syncPluginMentionGlobals()
        return
      }
    } catch (err) {
      console.warn('[inject] fetch hook 注入失败，重试', attempt, err)
    }
    await new Promise((r) => setTimeout(r, 800 * attempt))
  }
}

/** 项目路径注入诊断（ChatGPT 页面 hook 节流上报统计） */
function registerInjectStats(): void {
  ipcMain.on('freecodex:injectStats', (_e, info: { stats?: Record<string, unknown>; context?: string }) => {
    console.log('[inject] 页面上报:', JSON.stringify(info))
  })
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    show: false,
    title: 'Free Codex',
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false }
  } as BrowserWindowConstructorOptions)

  win.on('ready-to-show', () => {
    win?.show()
  })

  // 开发模式加载 Vite 服务器（vite-plugin-electron 注入 VITE_DEV_SERVER_URL），生产模式加载 dist
  if (is.dev && process.env['VITE_DEV_SERVER_URL']) {
    console.log('[main] Loading dev server:', process.env['VITE_DEV_SERVER_URL'])
    await win.loadURL(process.env['VITE_DEV_SERVER_URL']).catch(err => {
      console.error('Failed to load dev server, falling back to dist:', err)
      const rendererHtml = path.join(__dirname, '../../dist/index.html')
      return win!.loadFile(rendererHtml)
    })
  } else {
    const rendererHtml = path.join(__dirname, '../../dist/index.html')
    win.loadFile(rendererHtml).catch(err => console.error('Failed to load renderer:', err))
  }
  win.on('resize', layout)
  // 最大化状态变化通知渲染进程（切换标题栏按钮图标）
  win.on('maximize', () => win?.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win?.webContents.send('window:maximized', false))
  registerCtrlR(win.webContents)
  registerDevToolsShortcut(win.webContents)

  chatView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // ChatGPT 页面专用 preload：注入 @ / 触发检测脚本 + postMessage 桥
      preload: path.join(__dirname, '../preload/chat-preload.js'),
    },
  })
  chatView.setBackgroundColor('#fff')
  // 与全局指纹一致（app.userAgentFallback / session 层已伪装，这里显式设置视图 UA）
  chatView.webContents.setUserAgent(CHROME_UA)
  chatView.webContents.on('did-finish-load', () => {
    // ChatGPT 是 SPA，data-theme 渲染完成后才设置；延迟注入并重试一次
    setTimeout(() => { void applyChatTheme(currentThemeDark) }, 1500)
    setTimeout(() => { void applyChatTheme(currentThemeDark) }, 4000)
    // 页面加载后注入 fetch hook（项目路径注入依赖），失败自动重试
    void installChatFetchHook()
  })
  registerCtrlR(chatView.webContents)
  registerDevToolsShortcut(chatView.webContents)
  win.contentView.addChildView(chatView)
  void chatView.webContents.loadURL(CHATGPT_URL)
  layout()
  // 当前对话轮询（CDP 求值页面 URL / fetch hook 会话 ID，用于工具调用按对话区分）
  startConversationPolling()

  // overlay 是独立窗口，需要全量同步主窗口的位置/尺寸/显隐状态
  win.on('move', syncOverlayBounds)
  win.on('resize', syncOverlayBounds)
  win.on('maximize', syncOverlayBounds)
  win.on('unmaximize', syncOverlayBounds)
  win.on('enter-full-screen', syncOverlayBounds)
  win.on('leave-full-screen', syncOverlayBounds)
  // 主窗口最小化时隐藏 overlay（独立窗口不会跟随），还原后按当前模式恢复
  win.on('minimize', () => overlayWin?.hide())
  win.on('restore', () => {
    if (overlayMode !== 'none') applyOverlayMode()
  })

  createOverlayWindow()
}

/**
 * 创建 overlay 子窗口（VS Code 风格的置顶透明浮层）：
 * 渲染 Toaster + 命令面板 + Diff 弹窗，浮在 ChatGPT 原生视图之上。
 *
 * 注意：不设 `parent: win`。Windows 下属主（owned）窗口在父窗口最大化/还原/被系统
 * 重新置放时会被自动重定位，导致与主窗口错位；这里用独立 alwaysOnTop 窗口 +
 * 全量事件同步（move/resize/maximize/minimize…），坐标完全由自己控制。
 */
function createOverlayWindow() {
  overlayWin = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  overlayWin.on('closed', () => {
    overlayWin = undefined
  })

  if (is.dev && process.env['VITE_DEV_SERVER_URL']) {
    void overlayWin.loadURL(`${process.env['VITE_DEV_SERVER_URL']}overlay.html`).catch((err) => {
      console.error('[overlay] 加载 dev overlay 失败:', err)
    })
  } else {
    const overlayHtml = path.join(__dirname, '../../dist/overlay.html')
    void overlayWin.loadFile(overlayHtml).catch((err) => {
      console.error('[overlay] 加载 overlay 失败:', err)
    })
  }

  // 初始主题同步（overlay 可能早于首次 applyChatTheme 加载完成）
  overlayWin.webContents.on('did-finish-load', () => {
    overlayWin?.webContents.send('overlay:theme', currentThemeDark)
  })
}

/** 网关启动失败 → 推送给渲染进程（设置页可展示） */
function pushGatewayError(error: unknown, method: string) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[gateway] ${method} 失败:`, message)
  win?.webContents.send('mcp:event', {
    direction: 'system',
    method,
    payload: { error: message },
    at: Date.now(),
  })
}

/** 配置保存后 Gateway 的重载结果（运行中 → 自动重启） */
type GatewayReloadResult = {
  /** 保存时 Gateway 是否在运行（运行中 → 已自动重启） */
  restarted: boolean
  /** 重启后的入口 URL（公网或本地） */
  url?: string
  /** 重启失败原因（配置已保存，但 Gateway 未恢复运行） */
  restartError?: string
}

/**
 * 应用 Gateway 配置：未运行 → 仅更新配置；运行中 → 停止 → 更新 → 自动重启。
 * 重启失败不抛错，通过 restartError 返回，避免配置保存被误报失败。
 * 公网模式重启会连带 cloudflared 隧道，verify 可能抢跑失败 → 退避重试，避免"重启失败后网关静默消失"。
 */
async function applyGatewayConfig(): Promise<GatewayReloadResult> {
  if (!gateway.running) {
    gateway.update(config.gateway)
    return { restarted: false }
  }
  await gateway.stop()
  gateway.update(config.gateway)
  if (!config.projectRoot) {
    return { restarted: false, restartError: '未选择项目目录，Gateway 已停止' }
  }
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const url = await gateway.start()
      void ensureTunnel() // 网关就绪后确保公网可达（隧道常驻，通常为 no-op）
      return { restarted: true, url }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (attempt < maxAttempts) {
        console.warn(`[gateway] 重启失败（第 ${attempt} 次）：${message}，${5 * attempt}s 后重试`)
        await new Promise((r) => setTimeout(r, 5000 * attempt))
        continue
      }
      console.error('[gateway] 配置保存后自动重启失败:', message)
      return { restarted: false, restartError: message }
    }
  }
  return { restarted: false, restartError: '网关重启失败（多次尝试后仍未恢复）' }
}

/**
 * 确保公网可达：隧道在跑且可达 → no-op；不可达/未启动 → 拉起 cloudflared（app 层能力，网关重启不触碰）。
 * 结果记日志；不可达时打错误级日志供排查。
 */
async function ensureTunnel(): Promise<void> {
  if (!tunnelManager) return
  try {
    const result = await tunnelManager.ensure()
    if (result.ok) {
      console.log('[tunnel]', result.message)
    } else {
      console.error('[tunnel]', result.message)
    }
  } catch (err) {
    console.error('[tunnel] 隧道检查异常:', err instanceof Error ? err.message : String(err))
  }
}

/** 把文本插入 ChatGPT 页面输入框（面板选中后调用，替换触发的 @ /） */
async function insertTextIntoActivePage(text: string): Promise<{ ok: boolean; error?: string }> {
  const wc = chatView?.webContents
  if (!wc || wc.isDestroyed()) return { ok: false, error: 'no-active-view' }
  const script = `typeof window.__freehubInsertText === 'function'
    ? window.__freehubInsertText(${JSON.stringify(text)})
    : { ok: false, error: 'mention-script-not-injected' }`
  const result = (await wc.executeJavaScript(script).catch((err) => {
    console.error('[insert] 插入文本失败:', err)
    return { ok: false, error: 'execute-failed' }
  })) as { ok?: boolean; error?: string } | undefined
  if (!wc.isDestroyed()) wc.focus()
  if (result && result.ok === false) return { ok: false, error: result.error ?? 'insert-failed' }
  return { ok: true }
}

// ------------------------------------------------------------
// Webview（ChatGPT 视图）代理
// ------------------------------------------------------------

/** 把用户输入的代理地址规范化为 Electron proxyRules（去掉 http:// https:// 前缀） */
function normalizeProxyRules(url: string): string {
  const t = url.trim()
  return /^https?:\/\//i.test(t) ? t.replace(/^https?:\/\//i, '') : t
}

/** 应用 Webview 代理到默认 session（ChatGPT 视图所在 session；主窗口 file:// 不受影响） */
async function applyChatProxy(proxy: ProxyConfig): Promise<void> {
  try {
    if (proxy.enabled && proxy.url.trim()) {
      await session.defaultSession.setProxy({ proxyRules: normalizeProxyRules(proxy.url) })
      console.log('[proxy] 已应用代理:', proxy.url)
    } else {
      await session.defaultSession.setProxy({ mode: 'system' })
      console.log('[proxy] 已恢复系统代理')
    }
  } catch (err) {
    console.error('[proxy] 应用代理失败:', err)
  }
}

// ------------------------------------------------------------
// 引擎 outbound HTTPS 代理（CIMD 客户端文档抓取等）
// ------------------------------------------------------------
/** 启动时的代理环境变量原值（禁用应用代理时恢复，避免覆盖用户既有系统代理） */
const ambientProxyEnv: Record<string, string | undefined> = {
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  https_proxy: process.env.https_proxy,
  HTTP_PROXY: process.env.HTTP_PROXY,
  http_proxy: process.env.http_proxy,
}

/**
 * 把 free-codex 的代理配置同步到进程环境变量。
 * 引擎的 safeHttpGet（OAuth 客户端注册校验时会抓取 ChatGPT 的 CIMD 客户端文档
 * https://chatgpt.com/oauth/.../client.json）只认环境变量，不认 Electron session 代理；
 * 这台机器直连 chatgpt.com 不通，必须走代理，否则 CIMD 解析失败 → invalid_client。
 */
function applyGatewayProxyEnv(proxy: ProxyConfig): void {
  const proxyUrl = proxy.enabled && proxy.url.trim() ? proxy.url.trim() : ''
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const) {
    if (proxyUrl) {
      process.env[key] = proxyUrl
    } else {
      const original = ambientProxyEnv[key]
      if (original === undefined) delete process.env[key]
      else process.env[key] = original
    }
  }
}

// 单实例锁：双开时第二个实例直接退出，并把已有窗口聚焦（避免配置/共享数据互相覆盖、网关端口冲突）
const gotSingleInstanceLock = app.requestSingleInstanceLock()

app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

app.whenReady().then(() => {
  // 未获得单实例锁 → 已有实例在运行，直接退出
  if (!gotSingleInstanceLock) {
    app.quit()
    return
  }
  // Session 级浏览器伪装（UA + Sec-CH-UA 请求头，需 app ready 后设置）
  applySessionSpoofing()
  // 捕获 ChatGPT 请求的 Bearer token（chatgpt-connector 的后端 API 鉴权用）
  startChatgptTokenCapture()

  config = loadConfig()
  gateway = new NodeMcpGateway(config.gateway, {
    getMcpServers: () => {
      // todos 下游 server（enabled 且运行中）注入 mcpServers，hub 启动时自动连接
      const merged: Config['mcpServers'] = { ...config.mcpServers }
      if (config.todos.enabled && todosServer?.running) merged['todos'] = { url: todosServer.endpoint }
      return merged
    },
    getUiPreferences: () => config.ui,
    saveUiPreferences: (ui) => {
      config.ui = { ...config.ui, ...ui }
      saveConfig(config)
    },
    goalStorageDir: () => defaultGoalStorageDir(),
    getSkillDirs: () => getSkillDirectories(config.projectRoot || null),
    getDisabledTools: () => config.toolEnablement.disabledTools,
  })
  // todos 下游 server：进程内 HTTP（127.0.0.1:0 动态端口），状态按对话隔离落盘
  todosServer = new TodosServer({
    filePath: path.join(app.getPath('userData'), 'todos.json'),
    getConvId: () => currentConvId,
    onChange: () => {
      win?.webContents.send('todos:changed', todosUiState())
      void syncTodosGlobals()
    },
  })
  if (config.todos.enabled) {
    todosServer.start().catch((err) => console.warn('[todos] server 启动失败:', err))
  }
  // cloudflared 作为 app 层能力：独立于网关生命周期常驻，公网不可达时才拉起（见 tunnel-manager.ts）
  if (config.gateway.publicEnabled && config.gateway.domain && config.gateway.tunnelId && config.gateway.cloudflaredBin) {
    tunnelManager = new TunnelManager({
      bin: config.gateway.cloudflaredBin,
      tunnelId: config.gateway.tunnelId,
      configPath: config.gateway.tunnelConfigPath || undefined,
      domain: config.gateway.domain,
      getProbe: () => gateway.getTunnelProbe(),
    })
  }
  skills = new SkillManager(() => config.projectRoot || null)
  gateway.onEvent((event) => win?.webContents.send('mcp:event', event))
  // 工具调用（发起/完成）→ 记录会话归属 + 推送渲染层实时更新
  gateway.onToolCall((record, direction) => {
    if (direction === 'start') {
      // 会话 → 当前对话：调用发起时正在看的对话即归属（每次更新，重连/复用会话时自纠正）
      sessionToConv.set(record.sessionId, currentConvId)
    }
    win?.webContents.send('mcp:toolCall', { record, direction })
  })
  // todos 强制循环：mcp_call(server=todos, tool=todos_*) 成功 → 打点 + 清页面 dirty（下一请求不再提醒）
  gateway.onToolCall((record, direction) => {
    if (direction !== 'done' || record.status !== 'ok') return
    if (!isTodosMcpCall(record)) return
    const convId = sessionToConv.get(record.sessionId) ?? currentConvId
    todosServer?.store.markUpdated(convId)
    void clearTodosDirty()
  })
  // 引擎工具调用产生的文件 diff → 推送给渲染层（剥离 before/absPath 内部字段）
  gateway.onFileDiff((record) => {
    win?.webContents.send('freecodex:fileDiff', {
      id: record.id,
      path: record.path,
      toolName: record.toolName,
      diffText: record.diffText,
      hunks: record.hunks,
      additions: record.additions,
      deletions: record.deletions,
      timestamp: record.timestamp,
    })
  })

  // 启动时应用 Webview 代理（在 ChatGPT 视图加载前）+ 引擎 outbound 代理环境变量
  applyGatewayProxyEnv(config.proxy)
  void applyChatProxy(config.proxy)

  createWindow()
  projects = createProjectManager(() => config, saveConfig, gateway, win!)
  // 启动后把当前项目路径同步到 ChatGPT 页面（fetch hook 依赖页面全局）
  void syncChatInjection()
  // 启动后主动检测一次插件显示名（页面/目录缓存就绪后），让注入用上读到的插件名
  setTimeout(() => void refreshDetectedPluginName(), 10_000)
  // 初始化插件提及注入全局（清空旧值；检测到 appId 后由 refreshDetectedPluginName 更新）
  void syncPluginMentionGlobals()
  registerInjectStats()

  ipcMain.handle('config:get', () => config)
  ipcMain.handle('config:save', async (_e, next: Config) => {
    config = next
    config.gateway.projectRoot = config.projectRoot
    config.gateway.cloudflaredBin = config.cloudflare.executable || config.gateway.cloudflaredBin
    config.gateway.domain = config.cloudflare.hostname || config.gateway.domain
    config.gateway.tunnelId = config.cloudflare.tunnelId || config.gateway.tunnelId
    config.gateway.tunnelConfigPath = config.cloudflare.configPath || config.gateway.tunnelConfigPath
    saveConfig(config)
    // 代理可能在保存中变化 → 同步到引擎 outbound 环境变量
    applyGatewayProxyEnv(config.proxy)
    // 项目路径可能在保存中变化 → 同步到 ChatGPT 页面
    void syncChatInjection()
    // Gateway 运行中 → 停止后应用新配置并自动重启
    return applyGatewayConfig()
  })
  // 运行中可改：自动启动开关（仅影响下次启动）
  ipcMain.handle('config:patchAutoStart', (_e, value: boolean) => {
    config.autoStart = value === true
    saveConfig(config)
  })
  // 运行中可改：ChatGPT UI 偏好（引擎即时生效）
  ipcMain.handle('config:saveUi', (_e, ui: Config['ui']) => {
    config.ui = { ...config.ui, ...ui }
    saveConfig(config)
    return config.ui
  })
  // Webview 代理：保存 + 应用 + 刷新 ChatGPT 页面
  ipcMain.handle('webview:applyProxy', async (_e, proxy: ProxyConfig) => {
    config.proxy = { enabled: proxy?.enabled === true, url: proxy?.url ?? '' }
    saveConfig(config)
    await applyChatProxy(config.proxy)
    applyGatewayProxyEnv(config.proxy)
    chatView?.webContents.reload()
    return { ok: true }
  })
  ipcMain.handle('gateway:start', async () => {
    if (!config.projectRoot) throw new Error('请先选择项目目录')
    config.gateway.projectRoot = config.projectRoot
    const url = await gateway.start()
    void ensureTunnel()
    return url
  })
  ipcMain.handle('gateway:stop', async () => gateway.stop())
  ipcMain.handle('gateway:status', async () => ({
    endpoint: gateway.endpoint,
    publicUrl: gateway.publicUrl,
    running: gateway.running,
    tools: await gateway.getTools(),
    servers: gateway.getServers(),
  }))
  // 工具调用快照（按 MCP 会话分组 + 会话归属对话），Tools 面板按当前会话过滤展示
  ipcMain.handle('tools:calls', () => {
    const { sessions, recent } = gateway.getToolCalls()
    const out: Record<string, { convId: string | null; calls: ToolCallRecord[] }> = {}
    for (const [sid, calls] of Object.entries(sessions)) out[sid] = { convId: sessionToConv.get(sid) ?? null, calls }
    return { currentConvId, sessions: out, recent }
  })

  // ---------- ChatGPT 连接器（开发者模式 + 插件安装自动化）----------
  ipcMain.handle('chatgpt:loginStatus', () => isChatgptLoggedIn())
  // 未登录时引导登录：把 ChatGPT 视图导航到首页（未登录会自动跳到登录页）+ 聚焦
  ipcMain.handle('chatgpt:openLogin', () => {
    const wc = chatView?.webContents
    if (!wc || wc.isDestroyed()) return { ok: false, error: 'no-chat-view' }
    void wc.loadURL('https://chatgpt.com/')
    wc.focus()
    return { ok: true }
  })
  ipcMain.handle('chatgpt:devModeStatus', () => isDeveloperModeEnabled())
  ipcMain.handle('chatgpt:ensureDevMode', () => ensureDeveloperMode())
  ipcMain.handle('chatgpt:plugins', () => listInstalledPlugins())
  ipcMain.handle('chatgpt:findPlugin', async (_e, by: { url?: string; name?: string; appId?: string }) => {
    // URL → appId 映射需要连接器目录（页面 system-connectors 缓存）
    const wc = chatView?.webContents
    const catalogJson = wc && !wc.isDestroyed()
      ? await wc
          .executeJavaScript(`(() => { try { const k = Object.keys(localStorage).find(k => /system-connectors/.test(k)); return k ? localStorage.getItem(k) : null; } catch (e) { return null; } })()`)
          .catch(() => null)
      : null
    const result = await findPlugin(by ?? {}, catalogJson)
    // 记住读到的插件显示名（注入插件名留空时自动使用；变化时重新同步注入上下文）
    if (result?.displayName && result.displayName !== detectedPluginName) {
      detectedPluginName = result.displayName
      void syncChatInjection()
    }
    // 记住插件 appId（fetch 层自动 @提及注入 system_hints 用）
    if (result?.canonicalAppId && result.canonicalAppId !== detectedPluginAppId) {
      detectedPluginAppId = result.canonicalAppId
      void syncPluginMentionGlobals()
    }
    return result
  })
  ipcMain.handle('chatgpt:probeMcp', (_e, url: string) => probeMcpOAuthConfig(url))

  // ---------- 新会话注入内容（项目路径 / 插件名 / AGENTS.md / CLAUDE.md / skills）----------
  ipcMain.handle('injections:get', () => config.injections)
  ipcMain.handle('injections:save', (_e, patch: Partial<Config['injections']>) => {
    config.injections = {
      ...config.injections,
      ...(patch ?? {}),
      skills: { ...config.injections.skills, ...(patch?.skills ?? {}) },
    }
    saveConfig(config)
    void syncChatInjection()
    void syncPluginMentionGlobals() // 开关变化 → 更新页面插件提及注入
    return config.injections
  })

  // ---------- todos 模式（进程内下游 server + 软强制注入）----------
  ipcMain.handle('todos:get', () => todosUiState())
  ipcMain.handle('todos:setEnabled', async (_e, enabled: boolean) => {
    const on = enabled === true
    config.todos.enabled = on
    saveConfig(config)
    if (on) {
      await todosServer?.start().catch((err) => console.warn('[todos] server 启动失败:', err))
    } else {
      await todosServer?.stop()
    }
    void syncTodosGlobals()
    // 开关 todos 不重启网关：hub 热重载增删下游即可。
    // （旧实现走 applyGatewayConfig 重启，公网模式会连带重启 cloudflared 隧道，verify 抢跑失败 → 网关静默消失）
    let reload: GatewayReloadResult = { restarted: false }
    if (gateway.running) {
      try {
        await gateway.reloadDownstream()
      } catch (err) {
        console.warn('[todos] 下游热重载失败，回退为网关重启:', err)
        reload = await applyGatewayConfig()
      }
    }
    return { ...todosUiState(), ...reload }
  })
  ipcMain.handle('todos:updateItem', (_e, itemId: string, status: TodosStatus) => {
    todosServer?.store.setItemStatus(currentConvId, itemId, status)
    return todosUiState()
  })
  ipcMain.handle('todos:reset', () => {
    todosServer?.store.reset(currentConvId)
    return todosUiState()
  })

  // ---------- 会话清理（真实删除聊天记录 + 临时清理 DOM）----------
  ipcMain.handle('chatgpt:conversations', (_e, limit?: number) => listConversations(limit ?? 30))
  ipcMain.handle('chatgpt:deleteConversation', async (_e, id: string) => {
    const result = await deleteConversation(id)
    if (result.ok) refreshChatgptSidebar()
    return result
  })
  ipcMain.handle('chatgpt:deleteAllConversations', async (_e, limit?: number) => {
    const result = await deleteAllConversations(limit ?? 50)
    if (result.ok > 0) refreshChatgptSidebar()
    return result
  })
  ipcMain.handle('chatgpt:trimConversation', async (_e, keep?: number) => {
    const wc = chatView?.webContents
    if (!wc || wc.isDestroyed()) return { ok: false, error: 'no-chat-view' }
    const script = buildTrimConversationScript(keep ?? config.chatCleanup.trimKeep ?? 3)
    const res = (await wc.executeJavaScript(script).catch(() => null)) as { removed?: number; total?: number } | null
    return { ok: true, ...res }
  })
  ipcMain.handle('chatCleanup:save', (_e, patch: Partial<Config['chatCleanup']>) => {
    config.chatCleanup = { ...config.chatCleanup, ...(patch ?? {}) }
    saveConfig(config)
    return config.chatCleanup
  })
  // 内置工具启用/禁用（保存后网关自动重启，禁用工具从 tools/list 消失）
  ipcMain.handle('toolEnablement:save', async (_e, disabledTools: string[]) => {
    config.toolEnablement = { disabledTools: Array.isArray(disabledTools) ? [...disabledTools] : [] }
    saveConfig(config)
    return { ...config.toolEnablement, ...(await applyGatewayConfig()) }
  })

  // ---------- 下游 MCP 服务器（free-codex 配置自持）----------
  ipcMain.handle('mcp:list', () => listMcpServers(config))
  ipcMain.handle('mcp:save', async (_e, next: Config) => {
    config.mcpServers = { ...(next?.mcpServers ?? {}) }
    saveConfig(config)
    const reload = await applyGatewayConfig()
    return { ...listMcpServers(config), ...reload }
  })
  ipcMain.handle('mcp:set', async (_e, name: string, server) => {
    setMcpServer(config, name, server)
    saveConfig(config)
    const reload = await applyGatewayConfig()
    return { ...listMcpServers(config), ...reload }
  })
  ipcMain.handle('mcp:delete', async (_e, name: string) => {
    deleteMcpServer(config, name)
    saveConfig(config)
    const reload = await applyGatewayConfig()
    return { ...listMcpServers(config), ...reload }
  })

  // ---------- 一键创建 Cloudflare Tunnel（向导式，复用 codex-mcp dist 模块）----------
  let tunnelCoordinator: TunnelSetupCoordinator | null = null
  let pendingTunnelAsk: { id: number; resolve: (v: boolean) => void; reject: (e: Error) => void } | null = null

  /** 向导确认问题 → 推送渲染层弹确认框，等待 tunnel:answer / tunnel:cancel 回传 */
  function askViaIpc(ask: TunnelAsk): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (pendingTunnelAsk) {
        reject(new Error('内部错误：存在未处理的提问'))
        return
      }
      pendingTunnelAsk = { id: ask.id, resolve, reject }
      win?.webContents.send('tunnel:ask', ask)
    })
  }

  ipcMain.handle('tunnel:setup', async (_e, input: TunnelSetupInput) => {
    if (tunnelCoordinator) throw new Error('已有 Tunnel 设置流程在进行中')
    if (!input?.domain?.trim()) throw new Error('请填写公网域名')
    const coordinator = new TunnelSetupCoordinator({
      ask: askViaIpc,
      onProgress: (event) => win?.webContents.send('tunnel:progress', event),
    })
    tunnelCoordinator = coordinator
    try {
      const result = await coordinator.run({
        domain: input.domain,
        tunnelName: input.tunnelName ?? 'codex-mcp',
        serviceHost: config.gateway.host || '127.0.0.1',
        servicePort: config.gateway.port,
        configuredBin: config.cloudflare.executable || config.gateway.cloudflaredBin || undefined,
      })
      // 写回 free-codex 配置（cloudflare 段 + gateway 公网字段），保存后即生效
      config.cloudflare = {
        enabled: true,
        executable: result.cloudflaredBin,
        hostname: result.domain,
        tunnelId: result.tunnelId,
        configPath: result.configPath,
      }
      config.gateway = {
        ...config.gateway,
        projectRoot: config.projectRoot,
        publicEnabled: true,
        domain: result.domain,
        cloudflaredBin: result.cloudflaredBin,
        tunnelId: result.tunnelId,
        tunnelName: result.tunnelName,
        tunnelConfigPath: result.configPath,
      }
      saveConfig(config)
      // Gateway 运行中 → 自动重启以应用公网配置
      const reload = await applyGatewayConfig()
      return { ...result, gateway: reload }
    } finally {
      tunnelCoordinator = null
    }
  })
  ipcMain.handle('tunnel:answer', (_e, id: number, approved: boolean) => {
    if (!pendingTunnelAsk || pendingTunnelAsk.id !== id) return false
    const { resolve, reject } = pendingTunnelAsk
    pendingTunnelAsk = null
    if (approved === true) resolve(true)
    else reject(new Error('已取消'))
    return true
  })
  ipcMain.handle('tunnel:cancel', () => {
    // 中止协调器（下一个检查点抛「已取消」，登录子进程会被终止）
    tunnelCoordinator?.cancel()
    if (!pendingTunnelAsk) return
    const { reject } = pendingTunnelAsk
    pendingTunnelAsk = null
    reject(new Error('已取消'))
  })

  // ---------- @ 文件 / / 技能 触发（页面输入检测 → overlay 面板）----------
  ipcMain.on('freecodex:mentionOpen', () => overlayWin?.webContents.send('overlay:openFilePalette'))
  ipcMain.on('freecodex:skillOpen', () => overlayWin?.webContents.send('overlay:openSkillPalette'))
  // 技能面板关闭（未选中技能）→ 把被拦截的消息开头 / 写回 ChatGPT 输入框
  ipcMain.on('freecodex:skillPaletteClosed', () => {
    const wc = chatView?.webContents
    if (!wc || wc.isDestroyed()) return
    wc.executeJavaScript('window.__freehubRestoreSlash && window.__freehubRestoreSlash()').catch(() => undefined)
  })
  ipcMain.handle('freecodex:listProjectFiles', async () => {
    const active = projects.getState().active
    if (!active) return { files: [], noProject: true }
    try {
      const files = await listProjectFiles(active)
      return { files, noProject: false }
    } catch (err) {
      console.error('[files] 列出项目文件失败:', err)
      return { files: [], noProject: false }
    }
  })
  ipcMain.handle('freecodex:insertFileReference', (_e, text: string) => {
    if (typeof text !== 'string' || !text) return { ok: false, error: 'invalid-path' }
    return insertTextIntoActivePage(text)
  })
  ipcMain.handle('freecodex:insertSkillTrigger', (_e, name: string) => {
    if (typeof name !== 'string' || !name) return { ok: false, error: 'invalid-skill-name' }
    return insertTextIntoActivePage(`/skill:${name} `)
  })

  // ---------- Diff（引擎工具调用产生的文件变更）----------
  /** 剥离内部字段（before/absPath）后再发给渲染层 */
  const stripDiffRecord = (r: { id: string; path: string; toolName: string; diffText: string; hunks: unknown; additions: number; deletions: number; timestamp: number }) => ({
    id: r.id,
    path: r.path,
    toolName: r.toolName,
    diffText: r.diffText,
    hunks: r.hunks,
    additions: r.additions,
    deletions: r.deletions,
    timestamp: r.timestamp,
  })
  ipcMain.handle('diff:list', () => listDiffRecords().map(stripDiffRecord))
  ipcMain.handle('diff:revertFile', (_e, id: string) => {
    const result = revertFile(id)
    if (result.ok) win?.webContents.send('diff:removed', id)
    return result
  })
  ipcMain.handle('diff:confirmFile', (_e, id: string) => {
    const result = confirmFile(id)
    if (result.ok) win?.webContents.send('diff:removed', id)
    return result
  })
  ipcMain.handle('diff:undoHunk', (_e, request: { id: string; hunkIndex: number }) => {
    const result = undoHunk(request?.id, request?.hunkIndex)
    if (result.ok) {
      if (result.diff === null) win?.webContents.send('diff:removed', request.id)
      else if (result.diff) win?.webContents.send('diff:updated', stripDiffRecord(result.diff))
    }
    return result
  })

  // ---------- 技能 ----------
  ipcMain.handle('skills:list', () => skills.list())
  ipcMain.handle('skills:setEnabled', (_e, names: string[], enabled: boolean) => {
    skills.setEnabled(names, enabled)
    void syncChatInjection()
  })
  ipcMain.handle('skills:create', (_e, input, scope) => {
    skills.create(input, scope)
    void syncChatInjection()
  })
  ipcMain.handle('skills:update', (_e, name: string, patch) => {
    skills.update(name, patch)
    void syncChatInjection()
  })
  ipcMain.handle('skills:delete', (_e, name: string) => {
    skills.delete(name)
    void syncChatInjection()
  })
  ipcMain.handle('skills:read', (_e, name: string) => skills.read(name))

  // ---------- OAuth 连接密码（封装 codex-mcp password-store）----------
  ipcMain.handle('auth:hasPassword', () => hasAdminPassword())
  ipcMain.handle('auth:setPassword', async (_e, password: string) => {
    await setAdminPassword(password)
    return { ok: true }
  })
  ipcMain.handle('auth:generatePassword', async () => generateAdminPassword())

  // ---------- 项目（Project）----------
  ipcMain.handle('project:get', () => projects.getState())
  ipcMain.handle('project:openFolder', async () => {
    const result = await projects.openFolder()
    if (result.ok) {
      win?.webContents.send('project:changed', result.state)
      void syncChatInjection()
      // 运行中自动重启网关，使新项目地址立即生效
      return { ...result, gateway: await applyGatewayConfig() }
    }
    return result
  })
  ipcMain.handle('project:activate', async (_e, p: string) => {
    const result = await projects.activate(p)
    if (result.ok) {
      win?.webContents.send('project:changed', result.state)
      void syncChatInjection()
      // 运行中自动重启网关，使新项目地址立即生效
      return { ...result, gateway: await applyGatewayConfig() }
    }
    return result
  })
  // 旧版原生文件夹选择器（保留兼容，UI 改用 projects.openFolder）
  ipcMain.handle('project:choose', async () => {
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { title: '选择项目', properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return config.projectRoot || null
    const r = await projects.activate(result.filePaths[0])
    void syncChatInjection()
    return r.state?.active ?? (config.projectRoot || null)
  })

  // ---------- 窗口控制（自定义标题栏）----------
  ipcMain.handle('window:minimize', () => win?.minimize())
  ipcMain.handle('window:toggleMaximize', () => { if (win?.isMaximized()) win.unmaximize(); else win?.maximize() })
  ipcMain.handle('window:maximize', () => { if (win?.isMaximized()) win.unmaximize(); else win?.maximize() })
  ipcMain.handle('window:close', () => win?.close())
  ipcMain.handle('window:isMaximized', () => win?.isMaximized() ?? false)

  // ---------- ChatGPT 视图显隐（渲染层浮层/设置页需要时隐藏）----------
  ipcMain.handle('browser:hideViews', () => setViewVisible(false))
  ipcMain.handle('browser:hideForOverlay', () => {
    if (viewVisible) {
      hiddenForOverlay = true
      setViewVisible(false)
      return true
    }
    return false
  })
  ipcMain.handle('browser:showActiveView', () => {
    hiddenForOverlay = false
    setViewVisible(true)
  })

  // ---------- overlay 子窗口（命令面板 / Diff / Toast）----------
  ipcMain.handle('overlay:openProjectPalette', () => {
    overlayWin?.webContents.send('overlay:openProjectPalette')
  })
  ipcMain.handle('overlay:openDiff', (_e, record: unknown) => {
    overlayWin?.webContents.send('overlay:openDiff', record)
  })
  ipcMain.on('overlay:setState', (_e, mode: 'none' | 'toast' | 'modal') => {
    overlayMode = mode
    applyOverlayMode()
  })
  ipcMain.on('overlay:interactive', (_e, interactive: boolean) => {
    overlayInteractive = interactive === true
    applyOverlayMode()
  })

  // 主窗口 toast → overlay 子窗口渲染（主窗口没有 Toaster）
  ipcMain.on('overlay:toast', (_e, input: unknown) => {
    overlayWin?.webContents.send('overlay:toast', input)
  })

  // ---------- 主题 ----------
  ipcMain.handle('freecodex:setTheme', async (_e, dark: boolean) => {
    currentThemeDark = dark === true
    await applyChatTheme(currentThemeDark)
    return { ok: true }
  })

  ipcMain.handle('panel:setCollapsed', (_e, collapsed: boolean) => { panelCollapsed = collapsed; layout() })
  ipcMain.handle('chat:reload', () => chatView?.webContents.reload())

  // ---------- 自动启动 Gateway ----------
  if (config.autoStart && config.projectRoot) {
    gateway.start()
      .then((url) => {
        console.log('[gateway] 自动启动成功:', url)
        void ensureTunnel() // 网关就绪后确保公网可达（cloudflared 是 app 层能力，不可达才拉起）
      })
      .catch((err) => pushGatewayError(err, 'autostart_failed'))
  }
})

app.on('before-quit', () => {
  void gateway?.stop()
  void todosServer?.stop()
  void tunnelManager?.stop()
  overlayWin?.destroy()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

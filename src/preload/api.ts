import { contextBridge, ipcRenderer } from 'electron'

/**
 * 共享 preload API 工厂。
 *
 * 主窗口（index.ts）与 overlay 子窗口（overlay-preload.ts）暴露同一套
 * `window.freeCodex`，避免组件在两个渲染层之间迁移时需要改调用方。
 * 订阅类方法统一监听主进程推送的通道；主进程只向对应窗口发送，多余的订阅无害。
 */
export function exposeFreeCodexApi(): void {
  contextBridge.exposeInMainWorld('electronAPI', { platform: process.platform })

  contextBridge.exposeInMainWorld('freeCodex', {
    getConfig: () => ipcRenderer.invoke('config:get'),
    saveConfig: (config: unknown) => ipcRenderer.invoke('config:save', config),
    /** 运行中可改：自动启动开关 */
    setAutoStart: (value: boolean): Promise<void> => ipcRenderer.invoke('config:patchAutoStart', value),
    /** 运行中可改：ChatGPT UI 偏好（引擎即时生效） */
    saveUi: (ui: unknown): Promise<unknown> => ipcRenderer.invoke('config:saveUi', ui),
    /** 应用 Webview 代理（保存 + 应用 + 刷新 ChatGPT 页面） */
    applyProxy: (proxy: { enabled: boolean; url: string }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('webview:applyProxy', proxy),
    start: () => ipcRenderer.invoke('gateway:start'),
    stop: () => ipcRenderer.invoke('gateway:stop'),
    status: () => ipcRenderer.invoke('gateway:status'),
    auth: {
      hasPassword: (): Promise<boolean> => ipcRenderer.invoke('auth:hasPassword'),
      setPassword: (password: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('auth:setPassword', password),
      generatePassword: (): Promise<string> => ipcRenderer.invoke('auth:generatePassword'),
    },
    mcp: {
      list: () => ipcRenderer.invoke('mcp:list'),
      save: (config: unknown) => ipcRenderer.invoke('mcp:save', config),
      set: (name: string, server: unknown) => ipcRenderer.invoke('mcp:set', name, server),
      delete: (name: string) => ipcRenderer.invoke('mcp:delete', name),
    },
    // ---------- 一键创建 Cloudflare Tunnel ----------
    startTunnelSetup: (input: { domain: string; tunnelName: string }): Promise<unknown> =>
      ipcRenderer.invoke('tunnel:setup', input),
    answerTunnelAsk: (id: number, approved: boolean): Promise<unknown> =>
      ipcRenderer.invoke('tunnel:answer', id, approved),
    cancelTunnelSetup: (): Promise<void> => ipcRenderer.invoke('tunnel:cancel'),
    /** cloudflared 路径：确保可用（已有直接用，没有自动下载 codex-mcp 内置版本） */
    ensureCloudflaredBin: (): Promise<unknown> => ipcRenderer.invoke('cloudflare:ensureBin'),
    /** cloudflared 路径：系统文件选择器 */
    pickCloudflaredBin: (): Promise<unknown> => ipcRenderer.invoke('cloudflare:pickBin'),
    onTunnelProgress: (callback: (event: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value)
      ipcRenderer.on('tunnel:progress', listener)
      return () => ipcRenderer.removeListener('tunnel:progress', listener)
    },
    onTunnelAsk: (callback: (ask: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value)
      ipcRenderer.on('tunnel:ask', listener)
      return () => ipcRenderer.removeListener('tunnel:ask', listener)
    },
    skills: {
      list: () => ipcRenderer.invoke('skills:list'),
      setEnabled: (names: string[], enabled: boolean) => ipcRenderer.invoke('skills:setEnabled', names, enabled),
      create: (input: unknown, scope: string) => ipcRenderer.invoke('skills:create', input, scope),
      update: (name: string, patch: unknown) => ipcRenderer.invoke('skills:update', name, patch),
      delete: (name: string) => ipcRenderer.invoke('skills:delete', name),
      read: (name: string) => ipcRenderer.invoke('skills:read', name),
    },
    chooseProject: () => ipcRenderer.invoke('project:choose'),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    setPanelCollapsed: (collapsed: boolean) => ipcRenderer.invoke('panel:setCollapsed', collapsed),
    goHomeChat: () => ipcRenderer.invoke('chat:goHome'),
    /** 公网连通状态（titlebar 指示器）：查询最新检测结果 */
    tunnelStatus: (): Promise<unknown> => ipcRenderer.invoke('tunnel:status'),
    /** 订阅公网连通状态推送（主进程检测后主动下发），返回取消订阅函数 */
    onTunnelStatus: (callback: (status: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value)
      ipcRenderer.on('tunnel:status', listener)
      return () => ipcRenderer.removeListener('tunnel:status', listener)
    },
    /** 订阅右上角插件状态推送（freecodex 连接器已安装与否），返回取消订阅函数 */
    onPluginStatus: (callback: (status: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value)
      ipcRenderer.on('plugin:status', listener)
      return () => ipcRenderer.removeListener('plugin:status', listener)
    },
    onMcpEvent: (callback: (event: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value)
      ipcRenderer.on('mcp:event', listener)
      return () => ipcRenderer.removeListener('mcp:event', listener)
    },

    // ---------- 工具调用记录（按当前对话区分）----------
    /** 工具调用快照（会话分组 + 归属对话 + 当前对话 ID） */
    getToolCalls: (): Promise<unknown> => ipcRenderer.invoke('tools:calls'),
    /** 订阅工具调用发起/完成（实时刷新 Tools 面板），返回取消订阅函数 */
    onToolCall: (callback: (info: { record: unknown; direction: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: { record: unknown; direction: string }) => callback(value)
      ipcRenderer.on('mcp:toolCall', listener)
      return () => ipcRenderer.removeListener('mcp:toolCall', listener)
    },
    /** 订阅当前对话切换（刷新 Tools 面板会话归属），返回取消订阅函数 */
    onConversationChanged: (callback: (info: { convId: string | null }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: { convId: string | null }) => callback(value)
      ipcRenderer.on('mcp:conversation', listener)
      return () => ipcRenderer.removeListener('mcp:conversation', listener)
    },

    // ---------- 窗口控制（自定义标题栏）----------
    windowControls: {
      minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
      toggleMaximize: (): Promise<void> => ipcRenderer.invoke('window:toggleMaximize'),
      close: (): Promise<void> => ipcRenderer.invoke('window:close'),
      isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
      onMaximizedChange: (cb: (maximized: boolean) => void): (() => void) => {
        const listener = (_event: Electron.IpcRendererEvent, value: boolean) => cb(value)
        ipcRenderer.on('window:maximized', listener)
        return () => ipcRenderer.removeListener('window:maximized', listener)
      },
    },

    // ---------- 项目（Project）----------
    projects: {
      get: () => ipcRenderer.invoke('project:get'),
      openFolder: () => ipcRenderer.invoke('project:openFolder'),
      activate: (path: string) => ipcRenderer.invoke('project:activate', path),
    },

    // ---------- ChatGPT 视图显隐 ----------
    /** 隐藏全部平台视图（进入应用页面时调用） */
    hideViews: (): Promise<void> => ipcRenderer.invoke('browser:hideViews'),
    /** 浮层（对话框）弹出前隐藏平台视图；返回 true 表示关闭浮层后需恢复 */
    hideForOverlay: (): Promise<boolean> => ipcRenderer.invoke('browser:hideForOverlay'),
    /** 浮层关闭后恢复临时隐藏的视图 */
    showActiveView: (): Promise<void> => ipcRenderer.invoke('browser:showActiveView'),

    // ---------- 主题 ----------
    setTheme: (dark: boolean): Promise<{ ok: boolean }> => ipcRenderer.invoke('freecodex:setTheme', dark),
    /** overlay 子窗口订阅主题同步，返回取消订阅函数 */
    onTheme: (cb: (dark: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: boolean) => cb(value)
      ipcRenderer.on('overlay:theme', listener)
      return () => ipcRenderer.removeListener('overlay:theme', listener)
    },

    // ---------- ChatGPT 连接器（开发者模式 + 插件安装自动化）----------
    chatgpt: {
      /** ChatGPT 登录状态（token 捕获 + /me 验证；插件操作前需已登录） */
      loginStatus: (): Promise<unknown> => ipcRenderer.invoke('chatgpt:loginStatus'),
      /** 未登录时引导登录：导航 ChatGPT 视图到首页（自动跳登录页） */
      openLogin: (): Promise<unknown> => ipcRenderer.invoke('chatgpt:openLogin'),
      /** 开发者模式状态（developerMode + lockdownMode） */
      devModeStatus: (): Promise<unknown> => ipcRenderer.invoke('chatgpt:devModeStatus'),
      /** 确保开发者模式开启（未开启则自动开启） */
      ensureDevMode: (): Promise<unknown> => ipcRenderer.invoke('chatgpt:ensureDevMode'),
      /** 一键安装 MCP 连接器（无 OAuth 直连；OAuth 自动打开授权页，需要密码时返回 needPassword） */
      installMcp: (input: { url: string; name?: string; password?: string }): Promise<unknown> =>
        ipcRenderer.invoke('chatgpt:installMcp', input),
      /** 已安装插件列表 */
      plugins: (): Promise<unknown> => ipcRenderer.invoke('chatgpt:plugins'),
      /** 按 URL/名称/AppId 查找已安装插件 */
      findPlugin: (by: { url?: string; name?: string; appId?: string }): Promise<unknown> =>
        ipcRenderer.invoke('chatgpt:findPlugin', by),
      /** 探测 MCP URL 的 OAuth 配置（安装前置步骤，不实际安装） */
      probeMcp: (url: string): Promise<unknown> => ipcRenderer.invoke('chatgpt:probeMcp', url),
      // ---------- 会话清理 ----------
      /** 列出最近对话（真实删除用） */
      conversations: (limit?: number): Promise<unknown> => ipcRenderer.invoke('chatgpt:conversations', limit),
      /** 真实删除一条对话（不可恢复） */
      deleteConversation: (id: string): Promise<unknown> => ipcRenderer.invoke('chatgpt:deleteConversation', id),
      /** 真实删除全部对话 */
      deleteAllConversations: (limit?: number): Promise<unknown> => ipcRenderer.invoke('chatgpt:deleteAllConversations', limit),
      /** 临时清理当前会话 DOM（保留最新 keep 条） */
      trimConversation: (keep?: number): Promise<unknown> => ipcRenderer.invoke('chatgpt:trimConversation', keep),
    },

    // ---------- 新会话注入内容（项目路径 / 插件名 / AGENTS.md / CLAUDE.md / skills）----------
    injections: {
      get: (): Promise<unknown> => ipcRenderer.invoke('injections:get'),
      save: (patch: unknown): Promise<unknown> => ipcRenderer.invoke('injections:save', patch),
    },

    // ---------- 会话清理配置（临时清理保留条数 / 自动清理）----------
    chatCleanup: {
      save: (patch: unknown): Promise<unknown> => ipcRenderer.invoke('chatCleanup:save', patch),
    },
    // ---------- 内置工具启用/禁用 ----------
    toolEnablement: {
      save: (disabledTools: string[]): Promise<unknown> => ipcRenderer.invoke('toolEnablement:save', disabledTools),
    },
    // ---------- todos 模式（进程内下游 server + 软强制注入）----------
    todos: {
      /** 当前状态（enabled + 当前对话清单） */
      get: (): Promise<unknown> => ipcRenderer.invoke('todos:get'),
      /** 开关 todos 模式（启停 server + 重启网关），返回最新状态 */
      setEnabled: (enabled: boolean): Promise<unknown> => ipcRenderer.invoke('todos:setEnabled', enabled),
      /** 手动改当前对话某任务状态 */
      updateItem: (itemId: string, status: string): Promise<unknown> => ipcRenderer.invoke('todos:updateItem', itemId, status),
      /** 清空当前对话清单 */
      reset: (): Promise<unknown> => ipcRenderer.invoke('todos:reset'),
    },
    /** 订阅 todos 状态变更（开关 / 清单变化 / 工具调用打点），返回取消订阅函数 */
    onTodosChanged: (cb: (state: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => cb(value)
      ipcRenderer.on('todos:changed', listener)
      return () => ipcRenderer.removeListener('todos:changed', listener)
    },

    // ---------- 命令面板 / Diff（overlay 子窗口渲染）----------
    /** 主窗口请求打开项目选择面板（overlay 窗口内） */
    openProjectPalette: (): Promise<void> => ipcRenderer.invoke('overlay:openProjectPalette'),
    /** 主窗口请求在 overlay 打开 diff 详情 */
    openDiff: (record: unknown): Promise<void> => ipcRenderer.invoke('overlay:openDiff', record),
    /** overlay 子窗口订阅"打开项目选择面板"，返回取消订阅函数 */
    onOpenProjectPalette: (cb: () => void): (() => void) => {
      const listener = () => cb()
      ipcRenderer.on('overlay:openProjectPalette', listener)
      return () => ipcRenderer.removeListener('overlay:openProjectPalette', listener)
    },
    /** overlay 子窗口订阅"打开 diff 详情"，返回取消订阅函数 */
    onOpenDiff: (cb: (record: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => cb(value)
      ipcRenderer.on('overlay:openDiff', listener)
      return () => ipcRenderer.removeListener('overlay:openDiff', listener)
    },
    /** 主窗口订阅 diff 已被撤回/确认（移除列表项），返回取消订阅函数 */
    onDiffRemoved: (cb: (id: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: string) => cb(value)
      ipcRenderer.on('diff:removed', listener)
      return () => ipcRenderer.removeListener('diff:removed', listener)
    },
    /** 主窗口订阅项目激活完成（刷新标题栏项目名），返回取消订阅函数 */
    onProjectChanged: (cb: (state: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => cb(value)
      ipcRenderer.on('project:changed', listener)
      return () => ipcRenderer.removeListener('project:changed', listener)
    },
    /** overlay 子窗口上报当前交互模式（none / toast / modal），主进程据此切换穿透 */
    setOverlayState: (mode: 'none' | 'toast' | 'modal'): void => {
      ipcRenderer.send('overlay:setState', mode)
    },
    /** overlay 子窗口上报鼠标是否悬停在 toast 上（决定是否临时放开鼠标穿透） */
    setOverlayInteractive: (interactive: boolean): void => {
      ipcRenderer.send('overlay:interactive', interactive)
    },

    // ---------- Toast（主窗口 → overlay 子窗口渲染）----------
    /** 主窗口请求在 overlay 渲染一个 toast（主窗口没有 Toaster） */
    toast: (input: { type: 'success' | 'error' | 'warning' | 'info' | 'message'; title: string; description?: string }): void => {
      ipcRenderer.send('overlay:toast', input)
    },
    /** overlay 子窗口订阅主窗口发来的 toast，返回取消订阅函数 */
    onToast: (cb: (input: { type: 'success' | 'error' | 'warning' | 'info' | 'message'; title: string; description?: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: { type: 'success' | 'error' | 'warning' | 'info' | 'message'; title: string; description?: string }) => cb(value)
      ipcRenderer.on('overlay:toast', listener)
      return () => ipcRenderer.removeListener('overlay:toast', listener)
    },

    // ---------- @ 文件 / / 技能 触发 ----------
    onOpenFilePalette: (cb: () => void): (() => void) => {
      const listener = () => cb()
      ipcRenderer.on('overlay:openFilePalette', listener)
      return () => ipcRenderer.removeListener('overlay:openFilePalette', listener)
    },
    onOpenSkillPalette: (cb: () => void): (() => void) => {
      const listener = () => cb()
      ipcRenderer.on('overlay:openSkillPalette', listener)
      return () => ipcRenderer.removeListener('overlay:openSkillPalette', listener)
    },
    listProjectFiles: () => ipcRenderer.invoke('freecodex:listProjectFiles'),
    insertFileReference: (text: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('freecodex:insertFileReference', text),
    insertSkillTrigger: (name: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('freecodex:insertSkillTrigger', name),
    /** overlay 子窗口上报技能面板已关闭（未选中技能）→ 主进程把被拦截的 / 写回 ChatGPT 输入框 */
    skillPaletteClosed: (): void => {
      ipcRenderer.send('freecodex:skillPaletteClosed')
    },

    // ---------- Diff ----------
    onFileDiff: (cb: (record: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => cb(value)
      ipcRenderer.on('freecodex:fileDiff', listener)
      return () => ipcRenderer.removeListener('freecodex:fileDiff', listener)
    },
    listDiffs: () => ipcRenderer.invoke('diff:list'),
    revertDiffFile: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('diff:revertFile', id),
    confirmDiffFile: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('diff:confirmFile', id),
    /** 整段撤销（恢复该 diff 块为原内容并重算 diff） */
    undoDiffHunk: (request: { id: string; hunkIndex: number }): Promise<unknown> =>
      ipcRenderer.invoke('diff:undoHunk', request),
    /** 订阅 diff 记录更新（整段撤销后重算），返回取消订阅函数 */
    onDiffUpdated: (cb: (record: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => cb(value)
      ipcRenderer.on('diff:updated', listener)
      return () => ipcRenderer.removeListener('diff:updated', listener)
    },
  })
}

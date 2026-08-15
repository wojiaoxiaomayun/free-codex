/**
 * ChatGPT 网页端插件（连接器）自动化：开发者模式检测/开启 + 插件安装检测/安装。
 *
 * 全部操作在 ChatGPT 网页域内完成（与页面同源、同会话），主进程经 Electron
 * `net.fetch`（Chromium 网络栈，走会话代理与 Cookie，可过 Cloudflare）调用
 * ChatGPT 后端 API，鉴权 token 从 session 层请求头捕获。
 *
 * 已核实的接口（2026-08，ChatGPT 网页版）：
 * - 开发者模式读取：GET  /backend-api/settings/user          → settings.developer_mode
 * - 开发者模式写入：PATCH /backend-api/settings/account_user_setting?feature=developer_mode&value=<true|false>
 *   （UI 位置：设置 → 插件 → 开发者模式（开发人员模式）开关；lockdown_mode_enabled 开启时会禁用开发者模式）
 * - 已安装插件：   GET  /backend-api/ps/plugins/installed?limit=1000 → { plugins: [{ id, canonical_app_id, ... }] }
 * - 连接器目录：   POST /backend-api/aip/connectors/list_accessible （系统连接器缓存：cache/.../system-connectors）
 * - MCP 安装：     POST /backend-api/aip/connectors/mcp/oauth_config { mcp_url, custom_headers } → oauth 配置
 *                  POST /backend-api/aip/connectors/links/{noauth|oauth|api_key} → 建立连接
 */

import { net, session, type Session, type WebContents } from 'electron'
import { generateAdminPassword, hasAdminPassword, setAdminPassword } from './auth'

/** 捕获到的最新 chatgpt.com Bearer token（webRequest 层，无需侵入页面） */
let chatgptToken: string | null = null

/** 是否已捕获到访问令牌（快速判断登录态，不发起网络请求） */
export function hasChatgptToken(): boolean {
  return !!chatgptToken
}

/** 从 session 层捕获 ChatGPT 请求的 Authorization 头（应用生命周期内常驻，幂等） */
let tokenCaptureStarted = false
export function startChatgptTokenCapture(target: Session = session.defaultSession): void {
  // 幂等：重复调用会在同一 session 上叠加 onBeforeSendHeaders 监听器
  if (tokenCaptureStarted) return
  tokenCaptureStarted = true
  target.webRequest.onBeforeSendHeaders((details, callback) => {
    const auth = details.requestHeaders['Authorization'] || details.requestHeaders['authorization']
    if (auth && typeof auth === 'string' && auth.startsWith('Bearer ') && /chatgpt\.com|chat\.openai\.com/.test(details.url)) {
      const token = auth.slice(7).trim()
      if (token && token.length > 50) chatgptToken = token
    }
    callback({ requestHeaders: details.requestHeaders })
  })
}

/** 调用 ChatGPT 后端 API（主进程，Chromium 网络栈走默认会话，自动带 token） */
export async function chatgptApi<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; ok: boolean; data: T; raw: string }> {
  if (!chatgptToken) throw new Error('未捕获到 ChatGPT 访问令牌（请先打开 ChatGPT 页面）')
  const headers: Record<string, string> = {
    authorization: `Bearer ${chatgptToken}`,
    accept: 'application/json',
    'content-type': 'application/json',
  }
  // 超时兜底：net.fetch 默认无超时，网络挂住会让 titlebar 检测一直转圈
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const res = await net.fetch(`https://chatgpt.com${path}`, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: controller.signal,
    })
    const raw = await res.text()
    let data: T = raw as T
    try {
      data = JSON.parse(raw) as T
    } catch {
      /* 非 JSON（错误页）保留原文 */
    }
    return { status: res.status, ok: res.ok, data, raw }
  } finally {
    clearTimeout(timer)
  }
}

/** 当前开发者模式状态（lockdown 模式会禁用开发者模式） */
export async function isDeveloperModeEnabled(): Promise<{ developerMode: boolean; lockdownMode: boolean }> {
  const { data } = await chatgptApi<{ settings: Record<string, boolean> }>('/backend-api/settings/user')
  return {
    developerMode: data?.settings?.developer_mode === true,
    lockdownMode: data?.settings?.lockdown_mode_enabled === true,
  }
}

/**
 * ChatGPT 登录状态：先看是否捕获到访问令牌，再用 /backend-api/me 验证有效性。
 * 未登录/令牌失效时返回 loggedIn:false（插件检测前必须登录）。
 */
export async function isChatgptLoggedIn(): Promise<{ loggedIn: boolean; reason?: string }> {
  if (!chatgptToken) return { loggedIn: false, reason: 'no-token' }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12_000)
    try {
      const res = await net.fetch('https://chatgpt.com/backend-api/me', {
        headers: { authorization: `Bearer ${chatgptToken}`, accept: 'application/json' },
        signal: controller.signal,
      })
      return res.ok ? { loggedIn: true } : { loggedIn: false, reason: `http-${res.status}` }
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    return { loggedIn: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/** 开启/关闭开发者模式（PATCH account_user_setting） */
export async function setDeveloperMode(enabled: boolean): Promise<{ ok: boolean; developerMode: boolean }> {
  const { ok, data } = await chatgptApi<{ developer_mode: boolean }>(
    `/backend-api/settings/account_user_setting?feature=developer_mode&value=${enabled}`,
    { method: 'PATCH' },
  )
  return { ok, developerMode: data?.developer_mode === true }
}

/** 确保开发者模式开启（关闭则开启；lockdown 开启时给出提示） */
export async function ensureDeveloperMode(): Promise<{ ok: boolean; developerMode: boolean; message?: string }> {
  const state = await isDeveloperModeEnabled()
  if (state.developerMode) return { ok: true, developerMode: true }
  if (state.lockdownMode) return { ok: false, developerMode: false, message: '「锁定模式」开启中会禁用开发者模式，请先在 设置 → 安全防护 关闭锁定模式' }
  return setDeveloperMode(true)
}

/**
 * 连接器目录（URL → 插件 id/显示名 映射）。
 * 不再依赖页面 localStorage 的 system-connectors 缓存（ChatGPT 现在不写了），
 * 直接调后端连接器目录 API；返回与缓存同构的 `{ connectors: [...] }` JSON。
 */
/** 取当前 ChatGPT 用户 id（/backend-api/me；list_accessible 的 principals 需要） */
async function getCurrentUserId(): Promise<string | undefined> {
  try {
    const { data } = await chatgptApi<{ id?: string; user?: { id?: string } }>('/backend-api/me')
    const id = data?.id ?? data?.user?.id
    return typeof id === 'string' && id ? id : undefined
  } catch {
    return undefined
  }
}

/** 连接器目录缓存（成功或失败都缓存，避免每次检测都重试 list_accessible 的慢请求） */
let catalogCache: { at: number; value: string | null } | null = null
const CATALOG_CACHE_TTL_MS = 5 * 60_000

export async function fetchConnectorCatalog(): Promise<string | null> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_CACHE_TTL_MS) {
    return catalogCache.value
  }
  // list_accessible 需要 body.principals（422 实测缺这个字段）。先拿用户 id 试标准格式，再回退空数组。
  const uid = await getCurrentUserId()
  const attempts: Array<{ label: string; body: Record<string, unknown> }> = [
    ...(uid ? [{ label: 'user-id', body: { principals: [{ type: 'user', id: uid }] } }] : []),
    { label: 'empty-array', body: { principals: [] } },
  ]
  let result: string | null = null
  for (const attempt of attempts) {
    try {
      const res = await chatgptApi<{
        value?: { connectors?: Array<Record<string, unknown>> }
        connectors?: Array<Record<string, unknown>>
      }>('/backend-api/aip/connectors/list_accessible', { method: 'POST', body: attempt.body })
      console.log(`[detect] list_accessible(${attempt.label}):`, res.status, res.raw.slice(0, 300))
      const connectors = res.data?.value?.connectors ?? res.data?.connectors
      if (Array.isArray(connectors) && connectors.length > 0) {
        result = JSON.stringify({ connectors })
        break
      }
    } catch (err) {
      console.warn(`[detect] list_accessible(${attempt.label}) 失败:`, err instanceof Error ? err.message : String(err))
    }
  }
  catalogCache = { at: Date.now(), value: result }
  return result
}

/** 已安装插件条目（ps/plugins/installed） */
export type InstalledPlugin = {
  id: string
  name: string
  canonicalAppId: string
  status: string
  installedAt?: string
  /** 目录里的显示名（ChatGPT 界面展示的 MCP 名字，如 mycodex；内部名是 dev-<appid>） */
  displayName?: string
  /** 原始响应条目（检测时按 URL 等字段兜底匹配用） */
  raw?: Record<string, unknown>
}

/** 已安装列表短缓存（10s，避免频繁检测重复打 ps/plugins/installed 慢请求） */
let installedCache: { at: number; value: InstalledPlugin[] | null } | null = null
const INSTALLED_CACHE_TTL_MS = 10_000

/** 列出已安装插件 */
export async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  if (installedCache && Date.now() - installedCache.at < INSTALLED_CACHE_TTL_MS) {
    return installedCache.value ?? []
  }
  const { data } = await chatgptApi<{ plugins: Array<Record<string, unknown>> }>('/backend-api/ps/plugins/installed?limit=1000')
  const plugins = (data?.plugins ?? []).map((p) => ({
    id: String(p.id ?? ''),
    name: String(p.name ?? ''),
    canonicalAppId: String(p.canonical_app_id ?? ''),
    status: String(p.status ?? ''),
    installedAt: String(p.installed_at ?? p.created_at ?? ''),
    raw: p,
  }))
  installedCache = { at: Date.now(), value: plugins }
  // 诊断：打印与 free-codex/indevs 相关的已装条目（含全部字段，便于校准匹配）
  console.log(
    '[detect] installed 总数:', plugins.length,
    plugins.filter((p) => /indevs|free-codex|freecodex/i.test(JSON.stringify(p.raw ?? {}))).slice(0, 5),
  )
  return plugins
}

/** oauth_config 探测结果缓存（URL → 连接器 id，5 分钟 TTL；避免每次检测都反复探测） */
let oauthIdCache: { url: string; id?: string; at: number } | null = null

/** 按 MCP URL / 名称 / AppId 判断插件是否已安装（canonical_app_id / 名称 / URL 字段匹配） */
export async function findPlugin(
  by: { url?: string; name?: string; appId?: string },
  /** 连接器目录 JSON（system-connectors 缓存），用于 URL → 显示名/appId 映射 */
  catalogJson?: string | null,
): Promise<InstalledPlugin | null> {
  let plugins: InstalledPlugin[] = []
  try {
    plugins = await listInstalledPlugins()
  } catch (err) {
    // 网络超时等 → 视为未检测到（返回 null），避免未处理 rejection
    console.warn('[detect] 获取已装插件列表失败:', err instanceof Error ? err.message : String(err))
    return null
  }
  const targetUrl = by.url
  const connector = targetUrl ? findConnectorByUrl(catalogJson, targetUrl) : null

  // 目录缺失/未命中 → 用 oauth_config 探测拿连接器 id（URL → id 的另一条可靠路径）
  if (targetUrl && !connector) {
    let id: string | undefined
    if (oauthIdCache && oauthIdCache.url === targetUrl && Date.now() - oauthIdCache.at < 5 * 60_000) {
      id = oauthIdCache.id
    } else {
      try {
        const probe = await probeMcpOAuthConfig(targetUrl)
        const m = probe.raw.match(/asdk_app_[0-9a-fA-F]{16,}/)
        id = m?.[0]
        oauthIdCache = { url: targetUrl, id, at: Date.now() }
      } catch {
        /* 探测失败忽略 */
      }
    }
    if (id) {
      const hit = plugins.find((p) => p.canonicalAppId === id)
      if (hit) {
        console.log('[detect] 通过 oauth_config 匹配到连接器:', id)
        return { ...hit, displayName: hit.name }
      }
    }
  }

  const norm = (u: string) => (u || '').replace(/\/+$/, '').toLowerCase()
  const target = targetUrl ? norm(targetUrl) : ''
  const hit = by.appId
    ? plugins.find((p) => p.canonicalAppId === by.appId)
    : by.name
      ? plugins.find((p) => p.name === by.name)
      : targetUrl
        ? plugins.find(
            (p) =>
              (connector?.id && p.canonicalAppId === connector.id) ||
              (connector?.name && p.name === connector.name) ||
              // 兜底：已装条目里直接带目标 URL 的字段（如 connector/base_url/mcp_url）也能命中
              (target &&
                Object.entries(p.raw ?? {}).some(
                  ([k, v]) => /url|base|endpoint|mcp/i.test(k) && typeof v === 'string' && norm(v).includes(target),
                )),
          ) ?? null
        : null
  console.log('[detect] findPlugin:', { targetUrl, connectorId: connector?.id, connectorName: connector?.name, found: !!hit })
  if (!hit) return null
  // 补上目录显示名（ChatGPT 界面展示的 MCP 名字）
  return { ...hit, displayName: connector?.name || hit.name }
}

/** 连接器（插件）目录条目（system-connectors 缓存的同源接口） */
export type ConnectorEntry = {
  id: string
  name: string
  connectorType: string
  isDeveloperMode: boolean
  mcpUrl: string | null
}

/**
 * 从系统连接器目录缓存（页面 localStorage `cache/.../system-connectors`）中
 * 按 mcp_url 找连接器条目，返回其显示名与 id（id 即 asdk_app_xxx，
 * 对应已安装插件的 canonical_app_id；显示名即 ChatGPT 界面展示的 MCP 名字）。
 */
export function findConnectorByUrl(catalogJson: string | null | undefined, url: string): ConnectorEntry | null {
  if (!catalogJson) return null
  try {
    const j = JSON.parse(catalogJson)
    const connectors = j?.value?.connectors ?? j?.connectors ?? []
    const target = url.replace(/\/+$/, '')
    const hit = connectors.find(
      (c: Record<string, unknown>) => String(c.mcp_url ?? c.base_url ?? '').replace(/\/+$/, '') === target,
    )
    if (!hit) return null
    return {
      id: String(hit.id ?? ''),
      name: String(hit.name ?? ''),
      connectorType: String(hit.connector_type ?? ''),
      isDeveloperMode: hit.isDeveloperMode === true,
      mcpUrl: String(hit.mcp_url ?? hit.base_url ?? '') || null,
    }
  } catch {
    return null
  }
}

/** 查询某 MCP URL 的 OAuth 配置（安装前置步骤；不会真正安装） */
export async function probeMcpOAuthConfig(mcpUrl: string): Promise<{ oauthRequired: boolean; authorizationUrl?: string; raw: string }> {
  const { data, raw } = await chatgptApi<{ oauth_config?: { type?: string; authorization_url?: string } }>(
    '/backend-api/aip/connectors/mcp/oauth_config',
    { method: 'POST', body: { mcp_url: mcpUrl, custom_headers: [] } },
  )
  console.log('[chatgpt] oauth_config:', raw.slice(0, 600))
  const cfg = data?.oauth_config
  const oauthRequired = cfg?.type === 'OAUTH' || !!cfg?.authorization_url
  return { oauthRequired, authorizationUrl: cfg?.authorization_url, raw }
}

/**
 * 安装 MCP 插件（无 OAuth 场景：noauth link 直连）。
 * OAuth 场景（mcp_url 声明 OAuth）：返回 oauthUrl，需页面/浏览器完成授权后回调。
 * 返回 { ok, linkId?, oauthUrl?, message? }
 */
export async function installMcpPlugin(input: {
  mcpUrl: string
  name: string
  connectorId?: string
}): Promise<{ ok: boolean; linkId?: string; oauthUrl?: string; message?: string; raw?: string }> {
  // 1) 探测 OAuth 配置
  const probe = await probeMcpOAuthConfig(input.mcpUrl)
  if (probe.oauthRequired) {
    return { ok: false, message: '该 MCP 服务器要求 OAuth，需在页面内完成授权（暂由 UI 流程处理）', raw: probe.raw }
  }
  // 2) 无认证：直接建立 link
  const { ok, data, raw } = await chatgptApi<{ link_id?: string }>('/backend-api/aip/connectors/links/noauth', {
    method: 'POST',
    body: {
      connector_id: input.connectorId,
      name: input.name,
      action_names: [],
      link_params: {},
      action_param_scopes: [],
    },
  })
  return { ok, linkId: data?.link_id, raw }
}

// ------------------------------------------------------------
// 一键安装（尽量全自动）
// 无 OAuth：后端 /links/noauth 直连建立连接。
// 有 OAuth：打开 codex-mcp 网关自己的授权页（authorization_url），
//   用连接密码自动填表提交（密码哈希不可逆，应用自己生成时才知道明文），
//   授权回调后轮询确认插件已安装。
// ------------------------------------------------------------

export type InstallMcpConnectorResult = {
  ok: boolean
  installed?: boolean
  /** 需要打开授权页（授权流程需要用户介入时的兜底地址） */
  oauthUrl?: string
  /** 已有连接密码但调用方没提供 → UI 让用户输入一次 */
  needPassword?: boolean
  /** 自动填表后仍停留在授权页（密码错误，服务端重新渲染表单） */
  wrongPassword?: boolean
  message?: string
}

export type InstallMcpDeps = {
  /** 承载 OAuth 授权页的浏览器（ChatGPT 视图） */
  chatView: WebContents | null
  /** 需要用户介入时恢复视图显示 */
  showView: () => void
  /** 轮询直到插件被检测到已安装 */
  pollInstalled: (timeoutMs: number) => Promise<boolean>
}

/** 在页面里轮询等待表达式为真（executeJavaScript；隐藏视图也能用） */
async function waitForInPage(wc: WebContents, expr: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ok = (await wc.executeJavaScript(expr).catch(() => false)) as boolean
    if (ok) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/**
 * 自动填写授权页的密码表单并提交。
 * 表单是 codex-mcp 网关的静态 HTML：`<form method="post" action="/authorize">` +
 * `#password` 输入框 + 隐藏字段。密码错误时服务端 401 重新渲染表单（表单不消失）；
 * 密码正确则 302 重定向离开授权页（表单消失）。
 */
async function fillOauthPassword(wc: WebContents, password: string): Promise<'ok' | 'no-form' | 'wrong-password'> {
  const formReady = await waitForInPage(wc, `!!document.querySelector('#password')`, 8_000)
  if (!formReady) return 'no-form'
  const pwd = JSON.stringify(password)
  await wc
    .executeJavaScript(
      `(() => { const p = document.querySelector('#password'); const f = p && p.closest('form'); if (!p || !f) return { ok:false }; p.value = ${pwd}; f.submit(); return { ok:true }; })()`,
    )
    .catch(() => ({ ok: false }))
  // 提交后轮询：表单消失 = 授权成功已重定向；一直停留 = 密码错误（服务端重新渲染）
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    const stillForm = (await wc.executeJavaScript(`!!document.querySelector('#password')`).catch(() => false)) as boolean
    if (!stillForm) return 'ok'
    await new Promise((r) => setTimeout(r, 1000))
  }
  return 'wrong-password'
}

/**
 * 在 ChatGPT 视图里驱动「添加插件」表单创建连接器（真实可用路径，已 CDP 验证）：
 * 打开 /plugins#settings/Connectors?create-connector=true → 注入 JS 填 名称+URL →
 * 等 OAuth 探测完成 → 勾选风险确认 → 点「创建」。返回是否创建成功。
 */
async function createConnectorViaUi(wc: WebContents, mcpUrl: string, name: string): Promise<{ ok: boolean; reason?: string }> {
  await wc.loadURL('https://chatgpt.com/plugins#settings/Connectors?create-connector=true').catch(() => undefined)
  const formReady = await waitForInPage(wc, `!!document.querySelector('input[placeholder*="example.com"]')`, 8_000)
  if (!formReady) return { ok: false, reason: '添加插件表单没有加载出来' }

  const filled = await wc
    .executeJavaScript(
      `(() => {
        const setVal = (el, v) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const nameInput = document.querySelector('input[placeholder*="自定义工具"]');
        const urlInput = document.querySelector('input[placeholder*="example.com"]');
        if (!nameInput || !urlInput) return { ok: false, reason: '输入框未找到' };
        setVal(nameInput, ${JSON.stringify(name)});
        setVal(urlInput, ${JSON.stringify(mcpUrl)});
        return { ok: true };
      })()`,
    )
    .catch(() => ({ ok: false }))
  if (!filled?.ok) return { ok: false, reason: filled?.reason ?? '填充表单失败' }

  // 等 OAuth 探测完成（创建按钮变为可用）
  const ready = await waitForInPage(
    wc,
    `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === '创建' && !b.disabled)`,
    8_000,
  )
  if (!ready) return { ok: false, reason: '创建按钮没有就绪（OAuth 探测未完成）' }

  const created = await wc
    .executeJavaScript(
      `(() => {
        const cb = document.querySelector('input[type="checkbox"]');
        if (cb && !cb.checked) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked').set;
          setter.call(cb, true);
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '创建');
        if (btn && !btn.disabled) { btn.click(); return { ok: true }; }
        return { ok: false, reason: '创建按钮不可用' };
      })()`,
    )
    .catch(() => ({ ok: false }))
  if (!created?.ok) return { ok: false, reason: created?.reason ?? '点击创建失败' }

  // 等弹窗关闭（创建完成）
  const closed = await waitForInPage(wc, `!document.querySelector('input[placeholder*="example.com"]')`, 8_000)
  return closed ? { ok: true } : { ok: false, reason: '创建后表单未关闭（可能有报错）' }
}

/** 一键安装 MCP 连接器（尽量全自动；OAuth 需要连接密码） */
export async function installMcpConnector(input: {
  mcpUrl: string
  name: string
  connectorId?: string
  password?: string
  deps: InstallMcpDeps
}): Promise<InstallMcpConnectorResult> {
  const { mcpUrl, name, connectorId, password, deps } = input
  const wc = deps.chatView

  // 1) 探测 OAuth 配置
  const probe = await probeMcpOAuthConfig(mcpUrl)

  // 2) 尚未安装 → 显示 ChatGPT 视图并驱动「添加插件」表单创建（实测有效；已建则跳过）
  const already = await deps.pollInstalled(3000)
  if (!already && wc && !wc.isDestroyed()) {
    deps.showView() // 让用户直接看到 ChatGPT 添加插件页
    const created = await createConnectorViaUi(wc, mcpUrl, name)
    if (!created.ok) {
      deps.showView()
      return { ok: false, message: `自动添加插件失败：${created.reason ?? '未知原因'}，已在页面打开，可手动完成` }
    }
  }

  // 3) 无 OAuth：创建流程已建立链接 → 确认安装
  if (!probe.oauthRequired) {
    const installed = await deps.pollInstalled(20_000)
    return { ok: true, installed }
  }

  // 4) OAuth：完成授权（自动填连接密码）
  let effectivePassword = password
  if (!effectivePassword) {
    if (await hasAdminPassword()) {
      // 已有密码但调用方没给 → 让 UI 输入一次（密码哈希不可逆，应用取不回明文）
      return { ok: true, needPassword: true }
    }
    // 没有密码 → 自动生成并保存（应用自己知道明文，可全自动填表）
    effectivePassword = await generateAdminPassword()
    await setAdminPassword(effectivePassword).catch(() => undefined)
  }

  // 4.1) 建 ChatGPT 侧 OAuth 链接 → 完整授权 URL（回退 oauth_config 的地址）
  let oauthUrl = probe.authorizationUrl
  if (input.connectorId) {
    try {
      const linkRes = await chatgptApi<{ oauth_url?: string; oauth_authorization_url?: string }>(
        '/backend-api/aip/connectors/links/oauth',
        {
          method: 'POST',
          body: {
            connector_id: input.connectorId,
            name: input.name,
            action_names: [],
            link_params: {},
            action_param_scopes: [],
          },
        },
      )
      console.log('[install-mcp] links/oauth:', linkRes.status, linkRes.raw.slice(0, 400))
      oauthUrl = linkRes.data?.oauth_url ?? linkRes.data?.oauth_authorization_url ?? oauthUrl
    } catch (err) {
      console.warn('[install-mcp] links/oauth 失败，回退 oauth_config 地址:', err instanceof Error ? err.message : String(err))
    }
  }
  if (!oauthUrl) {
    deps.showView()
    return { ok: false, message: '无法获取 OAuth 授权地址（连接器已添加，但需在 ChatGPT 页面完成授权）' }
  }

  // 4.2) 打开授权页并自动填密码
  if (!wc || wc.isDestroyed()) return { ok: false, message: 'ChatGPT 视图不可用' }
  await wc.loadURL(oauthUrl).catch(() => undefined)
  const filled = await fillOauthPassword(wc, effectivePassword)
  if (filled === 'no-form') {
    deps.showView()
    return { ok: false, oauthUrl, message: '授权页没有加载出表单，请在打开的页面手动完成' }
  }
  if (filled === 'wrong-password') {
    return { ok: false, oauthUrl, wrongPassword: true, message: '连接密码不正确，请重试' }
  }
  const installed = await deps.pollInstalled(45_000)
  return { ok: true, installed }
}

// ------------------------------------------------------------
// 聊天记录（真实删除）
// ------------------------------------------------------------

/** 对话列表条目 */
export type ConversationEntry = {
  id: string
  title: string
  createTime: number
  updateTime: number
}

/** 列出最近对话（后端 conversations 列表） */
export async function listConversations(limit = 30): Promise<ConversationEntry[]> {
  const { data } = await chatgptApi<{ items?: Array<Record<string, unknown>> }>(
    `/backend-api/conversations?offset=0&limit=${limit}&order=updated&is_archived=false&is_starred=false`,
  )
  return (data?.items ?? []).map((c) => ({
    id: String(c.id ?? ''),
    title: String(c.title ?? ''),
    createTime: typeof c.create_time === 'number' ? c.create_time * 1000 : 0,
    updateTime: typeof c.update_time === 'number' ? c.update_time * 1000 : 0,
  }))
}

/** 真实删除一条对话（不可恢复；端点 DELETE /conversation/id/{id}） */
export async function deleteConversation(id: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await chatgptApi(`/backend-api/conversation/id/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return { ok: res.ok, status: res.status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 真实删除全部对话（逐条删除，返回成功/失败数） */
export async function deleteAllConversations(limit = 50): Promise<{ ok: number; failed: number; error?: string }> {
  const convs = await listConversations(limit)
  let ok = 0
  let failed = 0
  for (const c of convs) {
    const r = await deleteConversation(c.id)
    if (r.ok) ok++
    else failed++
  }
  return { ok, failed }
}

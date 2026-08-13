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

import { net, session, type Session } from 'electron'

/** 捕获到的最新 chatgpt.com Bearer token（webRequest 层，无需侵入页面） */
let chatgptToken: string | null = null

/** 从 session 层捕获 ChatGPT 请求的 Authorization 头（应用生命周期内常驻，幂等） */
export function startChatgptTokenCapture(target: Session = session.defaultSession): void {
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
  const res = await net.fetch(`https://chatgpt.com${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  const raw = await res.text()
  let data: T = raw as T
  try {
    data = JSON.parse(raw) as T
  } catch {
    /* 非 JSON（错误页）保留原文 */
  }
  return { status: res.status, ok: res.ok, data, raw }
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
    const res = await net.fetch('https://chatgpt.com/backend-api/me', {
      headers: { authorization: `Bearer ${chatgptToken}`, accept: 'application/json' },
    })
    return res.ok ? { loggedIn: true } : { loggedIn: false, reason: `http-${res.status}` }
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

/** 已安装插件条目（ps/plugins/installed） */
export type InstalledPlugin = {
  id: string
  name: string
  canonicalAppId: string
  status: string
  installedAt?: string
  /** 目录里的显示名（ChatGPT 界面展示的 MCP 名字，如 mycodex；内部名是 dev-<appid>） */
  displayName?: string
}

/** 列出已安装插件 */
export async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  const { data } = await chatgptApi<{ plugins: Array<Record<string, unknown>> }>('/backend-api/ps/plugins/installed?limit=1000')
  return (data?.plugins ?? []).map((p) => ({
    id: String(p.id ?? ''),
    name: String(p.name ?? ''),
    canonicalAppId: String(p.canonical_app_id ?? ''),
    status: String(p.status ?? ''),
    installedAt: String(p.installed_at ?? p.created_at ?? ''),
  }))
}

/** 按 MCP URL / 名称 / AppId 判断插件是否已安装（canonical_app_id 或名称匹配） */
export async function findPlugin(
  by: { url?: string; name?: string; appId?: string },
  /** 连接器目录 JSON（页面 system-connectors 缓存），用于 URL → 显示名/appId 映射 */
  catalogJson?: string | null,
): Promise<InstalledPlugin | null> {
  const plugins = await listInstalledPlugins()
  const targetUrl = by.url
  const targetAppId = targetUrl ? findConnectorByUrl(catalogJson, targetUrl)?.id : undefined
  const hit = by.appId
    ? plugins.find((p) => p.canonicalAppId === by.appId)
    : by.name
      ? plugins.find((p) => p.name === by.name)
      : targetUrl
        ? plugins.find((p) => p.canonicalAppId === targetAppId) ?? null
        : null
  if (!hit) return null
  // 补上目录显示名（ChatGPT 界面展示的 MCP 名字）
  const display = targetUrl ? findConnectorByUrl(catalogJson, targetUrl) : null
  return { ...hit, displayName: display?.name || hit.name }
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

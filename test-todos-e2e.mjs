/**
 * todos 端到端 CDP 测试（跑完即删）：
 * 1) 渲染层 IPC 打开 todos 开关（真实 UI 路径）
 * 2) SDK 客户端扮演 ChatGPT：网关 mcp_servers 确认 todos ready，再 mcp_call 建清单/改进度
 * 3) 面板数据源（freeCodex.todos.get）与页内注入状态（__freehubTodosState + applyTodosBlock）验证
 * 4) 切到 Todos Tab 截图
 */
import fs from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const CDP = 'http://127.0.0.1:9222'
const fail = (m) => { console.error('E2E FAIL:', m); process.exit(1) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets() {
  return (await (await fetch(`${CDP}/json`)).json())
}

async function evalOn(wsUrl, expression) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  const msg = await new Promise((resolve, reject) => {
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) resolve(m) }
    ws.onerror = reject
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
  ws.close()
  if (msg.error) throw new Error(msg.error.message)
  if (msg.result?.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(msg.result.exceptionDetails).slice(0, 300))
  return msg.result?.result?.value
}

async function screenshot(wsUrl, file) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  await new Promise((resolve) => {
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) resolve(m) }
    ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }))
  })
  ws.close()
}

async function cdpSession(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let nextId = 1
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
  return { ws, send }
}

// ---- 等 target 就绪 ----
let main, chat
for (let i = 0; i < 20; i++) {
  const ts = await targets()
  main = ts.find((t) => t.type === 'page' && /index\.html/.test(t.url))
  chat = ts.find((t) => t.type === 'page' && /chatgpt\.com|chat\.openai\.com/.test(t.url))
  if (main && chat) break
  await sleep(500)
}
if (!main || !chat) fail(`找不到窗口 target（main=${!!main} chat=${!!chat}）`)
console.log('[0] 窗口就绪: main=', main.url.slice(0, 60), '| chat=', chat.url.slice(0, 40))

// ---- 1) 渲染层 IPC 打开 todos ----
const enabled = await evalOn(main.webSocketDebuggerUrl, `window.freeCodex.todos.setEnabled(true)`)
console.log('[1] 打开 todos 开关:', JSON.stringify({ enabled: enabled.enabled, convId: enabled.convId }))
if (enabled?.enabled !== true) fail('开关未打开')

// 网关重启 + hub 连接 todos 需要时间
await sleep(4000)

// ---- 2) SDK 客户端扮演 ChatGPT ----
const client = new Client({ name: 'e2e-chatgpt', version: '1.0.0' })
await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3291/mcp')))
console.log('[2] 已连上网关（本地 127.0.0.1:3291）')

const servers = await client.callTool({ name: 'mcp_servers', arguments: {} })
const todosSrv = (servers.structuredContent?.servers ?? []).find((s) => s.name === 'todos')
console.log('[3] mcp_servers → todos:', JSON.stringify(todosSrv))
if (todosSrv?.status !== 'ready') fail('todos 下游未 ready')

const created = await client.callTool({
  name: 'mcp_call',
  arguments: {
    server: 'todos',
    tool: 'todos_create',
    arguments: { objective: 'CDP 端到端测试', tasks: [{ title: '任务一' }, { title: '任务二', details: '带细节' }, { title: '任务三' }] },
  },
})
console.log('[4] mcp_call todos_create:', (created.content?.[0]?.text ?? '').slice(0, 60))

await client.callTool({
  name: 'mcp_call',
  arguments: {
    server: 'todos',
    tool: 'todos_update',
    arguments: { item_updates: [{ item_id: 't1', status: 'done' }, { item_id: 't2', status: 'in_progress', note: '进行中' }] },
  },
})
const listed = await client.callTool({
  name: 'mcp_call',
  arguments: { server: 'todos', tool: 'todos_list', arguments: {} },
})
console.log('[5] todos_list:', (listed.content?.[0]?.text ?? '').slice(0, 80))
await client.close()

// ---- 3) 面板数据源 + 页内注入状态 ----
const ui = await evalOn(main.webSocketDebuggerUrl, `window.freeCodex.todos.get()`)
const items = ui?.list?.items ?? []
console.log('[6] 面板数据源 todos.get: enabled=' + ui?.enabled + ' items=' + items.length)
if (!ui?.enabled || items.length !== 3) fail('面板数据源异常')
if (items[0]?.status !== 'done' || items[1]?.status !== 'in_progress') fail('面板状态未同步: ' + JSON.stringify(items.map((i) => i.status)))

const pageState = await evalOn(chat.webSocketDebuggerUrl, `(() => {
  const s = window.__freehubTodosState
  const b = { messages: [{ id: 'u1', author: { role: 'user', name: null, metadata: {} }, create_time: 1, content: { content_type: 'text', parts: ['hi'] } }] }
  window.__freehubTodosDirty = false
  const changed = window.__freehubTestApplyTodos(b)
  const sys = b.messages.find(m => m.author && m.author.role === 'system')
  return { enabled: s && s.enabled, blockHasTasks: s && s.blockText.indexOf('任务一') !== -1 && s.blockText.indexOf('[x] 任务一') !== -1, injected: changed, sysHasTasks: !!sys && sys.content.parts[0].indexOf('任务一') !== -1, sysHasReminder: !!sys && sys.content.parts[0].indexOf('⚠️') !== -1 }
})()`)
console.log('[7] 页内注入状态:', JSON.stringify(pageState))
if (!pageState.enabled || !pageState.blockHasTasks || !pageState.injected || !pageState.sysHasTasks) fail('页内注入异常')

// ---- 4) 切到 Todos Tab 截图 ----
await evalOn(main.webSocketDebuggerUrl, `(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')]
  const t = tabs.find(b => b && b.textContent.indexOf('Todos') !== -1)
  if (t) t.click()
  return t ? 'clicked' : 'not-found'
})()`)
await sleep(600)
const ses = await cdpSession(main.webSocketDebuggerUrl)
await ses.send('Page.enable')
const shot = await ses.send('Page.captureScreenshot', { format: 'png' })
ses.ws.close()
if (shot.result?.data) {
  fs.writeFileSync('test-todos-panel.png', Buffer.from(shot.result.data, 'base64'))
  console.log('[8] 截图已保存: test-todos-panel.png')
} else {
  fail('截图失败')
}

console.log('E2E PASS')
process.exit(0)

/**
 * todos 下游 MCP server（路径 B：进程内 Streamable HTTP，不触碰 @meesii/codex-mcp 引擎）
 *
 * ChatGPT 侧看不到独立工具，只能经网关通用工具 mcp_call({ server: 'todos', tool: 'todos_*', arguments })
 * 调用；网关 hub 再把请求经 Streamable HTTP 转发到本进程内 server（127.0.0.1:0 动态端口）。
 *
 * 状态按对话隔离（getConvId），落盘 userData/todos.json；软强制注入循环由 index.ts（watcher +
 * syncTodosGlobals）与 chat-inject（每请求替换 [todos 模式] 块）配合完成。
 */

import { createServer, type Server as NodeHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler, localhostHostValidation, localhostOriginValidation } from '@modelcontextprotocol/node'

// ------------------------------------------------------------
// 类型
// ------------------------------------------------------------

export type TodosStatus = 'pending' | 'in_progress' | 'done'

export type TodoItem = {
  id: string
  title: string
  details?: string
  status: TodosStatus
  note?: string
  createdAt: number
  updatedAt: number
}

export type TodoList = {
  objective?: string
  items: TodoItem[]
  status: 'active' | 'completed' | 'cancelled'
  summary?: string
  cancelReason?: string
  createdAt: number
  updatedAt: number
}

export type TodosUiState = {
  /** 当前对话 id（null = 首页/新会话） */
  convId: string | null
  /** 当前对话的清单（不存在为 null） */
  list: TodoList | null
}

// ------------------------------------------------------------
// TodosStore：按对话隔离 + 落盘
// ------------------------------------------------------------

export type TodosStoreOptions = {
  /** 持久化文件路径（userData/todos.json） */
  filePath: string
  /** 当前对话 id 提供者（null = 首页/新会话，落到 'default' 桶） */
  getConvId: () => string | null
  /** 清单变更通知（index.ts 用它推送渲染层 + 刷新注入全局） */
  onChange?: (list: TodoList | null) => void
}

const DEFAULT_CONV = 'default'

export class TodosStore {
  private readonly lists = new Map<string, TodoList>()

  constructor(private readonly opts: TodosStoreOptions) {
    this.load()
  }

  currentConvId(): string | null {
    return this.opts.getConvId()
  }

  /** 对话 key：显式 convId 优先，否则当前对话，首页/新会话落 'default' 桶 */
  private key(convId?: string | null): string {
    return (convId !== undefined ? convId : this.opts.getConvId()) ?? DEFAULT_CONV
  }

  list(convId?: string | null): TodoList | null {
    const list = this.lists.get(this.key(convId))
    return list ? cloneList(list) : null
  }

  /** 建清单；同一对话已有未完成清单时拒绝（fail-closed，配合"直到完成"语义） */
  create(convId: string | null, input: { objective?: string; tasks: Array<{ title: string; details?: string }> }): TodoList {
    const key = this.key(convId)
    const existing = this.lists.get(key)
    if (existing && existing.status === 'active') {
      throw new Error(`当前对话已有未完成清单，请先 todos_list 查看 / todos_update 更新，或 todos_finish 完成、todos_cancel 作废后再新建。`)
    }
    const now = Date.now()
    const list: TodoList = {
      ...(input.objective?.trim() ? { objective: input.objective.trim() } : {}),
      items: (input.tasks ?? []).map((task, index) => ({
        id: `t${index + 1}`,
        title: task.title.trim(),
        ...(task.details?.trim() ? { details: task.details.trim() } : {}),
        status: 'pending' as const,
        createdAt: now,
        updatedAt: now,
      })),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    if (!list.objective && list.items.length === 0) {
      throw new Error('todos_create 需要 objective 或至少一个任务。')
    }
    this.lists.set(key, list)
    this.persistAndNotify(key)
    return cloneList(list)
  }

  /** 更新清单（任务状态/备注/标题 + 追加任务） */
  update(
    convId: string | null,
    input: {
      item_updates?: Array<{ item_id: string; status?: TodosStatus; note?: string; title?: string }>
      add_items?: Array<{ title: string; details?: string }>
    },
  ): TodoList {
    const key = this.key(convId)
    const list = this.requireActive(key, '更新')
    const now = Date.now()
    for (const patch of input.item_updates ?? []) {
      const item = list.items.find((i) => i.id === patch.item_id)
      if (!item) throw new Error(`未知任务 ${patch.item_id}，请先 todos_list 获取最新清单。`)
      if (patch.status !== undefined) {
        if (!STATUSES.has(patch.status)) throw new Error(`非法状态 ${patch.status}（可选：${[...STATUSES].join(' / ')}）`)
        item.status = patch.status
      }
      if (patch.title !== undefined) item.title = patch.title.trim()
      if (patch.note !== undefined) {
        const note = patch.note.trim()
        if (note) item.note = note
        else delete item.note
      }
      item.updatedAt = now
    }
    for (const task of input.add_items ?? []) {
      if (!task.title?.trim()) throw new Error('新增任务需要 title。')
      list.items.push({
        id: `t${list.items.length + 1}`,
        title: task.title.trim(),
        ...(task.details?.trim() ? { details: task.details.trim() } : {}),
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      })
    }
    list.updatedAt = now
    this.persistAndNotify(key)
    return cloneList(list)
  }

  /** 完成清单：fail-closed，存在未 done 任务直接拒绝 */
  finish(convId: string | null, summary?: string): TodoList {
    const key = this.key(convId)
    const list = this.requireActive(key, '完成')
    if (list.items.length === 0) throw new Error('清单为空，无需完成。')
    const pending = list.items.filter((i) => i.status !== 'done')
    if (pending.length > 0) {
      const names = pending.map((i) => i.title.slice(0, 40)).join('、')
      throw new Error(`清单尚未全部完成（还剩：${names}）。请先用 todos_update 把任务标记为 done。`)
    }
    const now = Date.now()
    list.status = 'completed'
    list.updatedAt = now
    if (summary?.trim()) list.summary = summary.trim()
    this.persistAndNotify(key)
    return cloneList(list)
  }

  /** 作废清单（放弃时用，释放该对话以便重新 todos_create） */
  cancel(convId: string | null, reason: string): TodoList {
    const key = this.key(convId)
    const list = this.requireActive(key, '作废')
    const now = Date.now()
    list.status = 'cancelled'
    list.cancelReason = reason.trim()
    list.updatedAt = now
    this.persistAndNotify(key)
    return cloneList(list)
  }

  /** 右面板手动改任务状态 */
  setItemStatus(convId: string | null, itemId: string, status: TodosStatus): void {
    const key = this.key(convId)
    const list = this.lists.get(key)
    if (!list || list.status !== 'active') return
    const item = list.items.find((i) => i.id === itemId)
    if (!item || !STATUSES.has(status)) return
    item.status = status
    item.updatedAt = Date.now()
    list.updatedAt = Date.now()
    this.persistAndNotify(key)
  }

  /** 右面板清空当前对话清单 */
  reset(convId: string | null): void {
    const key = this.key(convId)
    if (!this.lists.delete(key)) return
    this.persistAndNotify(key)
  }

  /** 强制循环 watcher 打点：某对话刚发生了 todos_* 调用（成功） */
  markUpdated(convId: string | null): void {
    const key = this.key(convId)
    const list = this.lists.get(key)
    if (!list) return
    list.updatedAt = Date.now()
    this.persistAndNotify(key)
  }

  /** 新会话从首页获得真实 id 时：把 'default' 桶迁移到真实对话（照抄 fetch hook 的占位迁移） */
  moveDefaultTo(convId: string): void {
    const list = this.lists.get(DEFAULT_CONV)
    if (!list || this.lists.has(convId)) return
    this.lists.set(convId, list)
    this.lists.delete(DEFAULT_CONV)
    this.persistAndNotify(convId)
  }

  private requireActive(key: string, verb: string): TodoList {
    const list = this.lists.get(key)
    if (!list) throw new Error(`当前对话还没有清单，请先 todos_create 创建后再${verb}。`)
    if (list.status !== 'active') {
      throw new Error(`清单已${list.status === 'completed' ? '完成' : '作废'}，不能${verb}；如需新任务请 todos_create 重新开始。`)
    }
    return list
  }

  private persistAndNotify(key: string): void {
    this.save()
    try {
      this.opts.onChange?.(this.list(key))
    } catch (err) {
      console.warn('[todos] onChange 监听器异常:', err)
    }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.opts.filePath)) return
      const raw = JSON.parse(fs.readFileSync(this.opts.filePath, 'utf8')) as { lists?: Record<string, TodoList> }
      if (!raw || typeof raw !== 'object' || !raw.lists) return
      for (const [convId, list] of Object.entries(raw.lists)) {
        if (list && Array.isArray(list.items) && typeof list.status === 'string') {
          this.lists.set(convId, list)
        }
      }
    } catch (err) {
      console.warn('[todos] 读取状态文件失败，忽略:', err)
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.opts.filePath), { recursive: true })
      const body = `${JSON.stringify({ version: 1, lists: Object.fromEntries(this.lists) }, null, 2)}\n`
      const tmp = `${this.opts.filePath}.${process.pid}.tmp`
      fs.writeFileSync(tmp, body, 'utf8')
      fs.renameSync(tmp, this.opts.filePath)
    } catch (err) {
      console.warn('[todos] 写入状态文件失败:', err)
    }
  }
}

const STATUSES = new Set<TodosStatus>(['pending', 'in_progress', 'done'])

function cloneList(list: TodoList): TodoList {
  return structuredClone(list)
}

// ------------------------------------------------------------
// TodosServer：进程内 Streamable HTTP MCP server
// ------------------------------------------------------------

export type TodosServerOptions = TodosStoreOptions

export class TodosServer {
  readonly store: TodosStore
  private httpServer?: NodeHttpServer
  private port = 0

  constructor(opts: TodosServerOptions) {
    this.store = new TodosStore(opts)
  }

  get running(): boolean {
    return !!this.httpServer
  }

  get endpoint(): string {
    return `http://127.0.0.1:${this.port}/mcp`
  }

  async start(): Promise<void> {
    if (this.httpServer) return
    const handler = createMcpHandler(() => buildTodosMcpServer(this.store), {
      legacy: 'stateless',
      responseMode: 'auto',
      keepAliveMs: 15_000,
      onerror: (err) => console.warn('[todos] mcp handler 错误:', err),
    })
    const nodeHandler = toNodeHandler(handler, {
      onerror: (err) => console.warn('[todos] node 适配错误:', err),
    })
    const validateHost = localhostHostValidation()
    const validateOrigin = localhostOriginValidation()
    this.httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      try {
        if (!req.url || !req.url.includes('/mcp')) {
          res.writeHead(404).end()
          return
        }
        // 仅本机访问（Host/Origin 校验防 DNS rebinding）
        if (!validateHost(req, res) || !validateOrigin(req, res)) return
        void nodeHandler(req, res)
      } catch (err) {
        console.warn('[todos] 请求处理异常:', err)
        res.writeHead(500).end()
      }
    })
    await new Promise<void>((resolve, reject) => {
      const srv = this.httpServer!
      srv.once('error', reject)
      srv.listen(0, '127.0.0.1', () => {
        this.port = (srv.address() as AddressInfo).port
        console.log('[todos] todos server 已启动:', this.endpoint)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    const srv = this.httpServer
    this.httpServer = undefined
    this.port = 0
    if (srv) {
      await new Promise<void>((resolve) => srv.close(() => resolve()))
    }
  }

  /** 右面板 UI 状态 */
  getUiState(): TodosUiState {
    return { convId: this.store.currentConvId(), list: this.store.list() }
  }

  /** 注入块的正文（规则 + 当前对话快照）；提醒行由页内 hook 按 dirty 标记追加 */
  getBlockText(): string {
    const list = this.store.list()
    const lines = [
      TODOS_BLOCK_MARKER,
      '你正在使用 todos 工作流，必须遵守以下规则：',
      '1. 收到多步任务时，先通过 mcp_call 调用（server=todos，tool=todos_create）建立任务清单；',
      '2. 每完成一个子任务，立即调用 mcp_call（server=todos，tool=todos_update）把对应任务标记为 done / in_progress；',
      '3. 每个回复结束前，调用 todos_list 检查最新状态；只要清单未全部 done，回复必须以 todos_update 结尾（同步当前进度）；',
      '4. 清单全部 done 之前不得宣布任务完成；全部完成后调用 todos_finish 收尾。',
      '',
      `当前清单${list ? `（上次更新 ${formatRelative(list.updatedAt)} 前）` : ''}：`,
      ...formatListLines(list),
      TODOS_BLOCK_END,
    ]
    return lines.join('\n')
  }

  /** 当前对话清单是否未完成（供注入块追加提醒判断） */
  isIncomplete(): boolean {
    const list = this.store.list()
    return !!list && list.status === 'active' && list.items.some((i) => i.status !== 'done')
  }
}

export const TODOS_BLOCK_MARKER = '[todos 模式]'
export const TODOS_BLOCK_END = '[todos 模式结束]'
/** 页内 hook 在 dirty && incomplete 时追加的提醒行 */
export const TODOS_REMINDER = '⚠️ 你上一轮没有更新 todos，请先调用 mcp_call（server=todos）todos_update 同步最新状态再继续。'

function formatListLines(list: TodoList | null): string[] {
  if (!list) return ['（当前对话尚未创建清单）']
  if (list.status === 'completed') return ['（清单已完成）', `- ${list.summary ?? ''}`.trimEnd()]
  if (list.status === 'cancelled') return ['（清单已作废）']
  if (list.items.length === 0) return ['（清单为空）']
  return list.items.map((item) => {
    const mark = item.status === 'done' ? '[x]' : item.status === 'in_progress' ? '[*]' : '[ ]'
    const suffix = item.details ? `（${item.details.slice(0, 80)}）` : ''
    const note = item.note ? ` # ${item.note.slice(0, 60)}` : ''
    return `- ${mark} ${item.title}${suffix}${note}`
  })
}

/** 相对时间（注入块里让模型感知清单陈旧度） */
function formatRelative(at: number): string {
  const diff = Math.max(0, Date.now() - at)
  if (diff < 1000) return '刚刚'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  return `${Math.floor(diff / 3_600_000)}h`
}

// ------------------------------------------------------------
// MCP 工具注册（stateless 模式：每个请求由 factory 新建实例）
// ------------------------------------------------------------

const taskSchema = z.object({
  title: z.string().min(1).max(500).describe('任务标题'),
  details: z.string().max(2000).optional().describe('任务范围/细节'),
})

const itemUpdateSchema = z.object({
  item_id: z.string().min(1).max(64).describe('任务 id（todos_list 返回）'),
  status: z.enum(['pending', 'in_progress', 'done']).optional().describe('新状态'),
  note: z.string().max(1000).optional().describe('备注'),
  title: z.string().max(500).optional().describe('修订后的标题'),
})

function buildTodosMcpServer(store: TodosStore): McpServer {
  const server = new McpServer({ name: 'todos', version: '1.0.0' })

  server.registerTool(
    'todos_create',
    {
      title: 'Create todos list for current conversation',
      description:
        '为当前对话建立任务清单（多步任务开始时调用）。同一对话已有未完成清单时会失败——先 todos_list 查看、todos_update 更新，或用 todos_finish/todos_cancel 收尾后再新建。',
      inputSchema: z.object({
        objective: z.string().max(2000).optional().describe('整体目标'),
        tasks: z.array(taskSchema).optional().describe('任务列表'),
      }),
    },
    async (input) => {
      try {
        const list = store.create(store.currentConvId(), {
          objective: input.objective,
          tasks: input.tasks ?? [],
        })
        return okResult(`已创建 ${list.items.length} 个任务：${listSummary(list)}`, { list })
      } catch (err) {
        return errResult(message(err))
      }
    },
  )

  server.registerTool(
    'todos_list',
    {
      title: 'List current conversation todos',
      description:
        '返回当前对话的任务清单快照（最新状态）。todos 工作流：每个回复结束前都必须调用本工具检查状态，并用 todos_update 同步进度；清单未全部 done 不得宣布完成。',
      inputSchema: z.object({}),
    },
    async () => {
      const list = store.list()
      if (!list) {
        return okResult('当前对话还没有清单，请先 todos_create 创建。', { list: null })
      }
      return okResult(`${listSummary(list)}`, { list })
    },
  )

  server.registerTool(
    'todos_update',
    {
      title: 'Update current conversation todos',
      description:
        '同步当前对话的任务进度：批量更新任务状态（pending/in_progress/done）、追加备注或修订标题，也可以追加新任务。todos 工作流要求每个回复结束前调用。',
      inputSchema: z.object({
        item_updates: z.array(itemUpdateSchema).optional().describe('要更新的任务'),
        add_items: z.array(taskSchema).optional().describe('追加的新任务'),
      }),
    },
    async (input) => {
      try {
        const list = store.update(store.currentConvId(), input)
        return okResult(`已更新：${listSummary(list)}`, { list })
      } catch (err) {
        return errResult(message(err))
      }
    },
  )

  server.registerTool(
    'todos_finish',
    {
      title: 'Finish current conversation todos',
      description:
        '完成当前对话的清单。fail-closed：只要还有任务不是 done 就拒绝，必须先 todos_update 全部标 done。全部完成后调用本工具收尾。',
      inputSchema: z.object({
        summary: z.string().max(2000).optional().describe('完成总结'),
      }),
    },
    async (input) => {
      try {
        const list = store.finish(store.currentConvId(), input.summary)
        return okResult(`清单已完成：${listSummary(list)}`, { list })
      } catch (err) {
        return errResult(message(err))
      }
    },
  )

  server.registerTool(
    'todos_cancel',
    {
      title: 'Cancel current conversation todos',
      description:
        '放弃当前对话的未完成清单（任务被用户中止/替换时调用），保留历史并释放该对话以便重新 todos_create。',
      inputSchema: z.object({
        reason: z.string().min(1).max(1000).describe('作废原因'),
      }),
    },
    async (input) => {
      try {
        const list = store.cancel(store.currentConvId(), input.reason)
        return okResult(`清单已作废：${input.reason}`, { list })
      } catch (err) {
        return errResult(message(err))
      }
    },
  )

  return server
}

function listSummary(list: TodoList): string {
  const done = list.items.filter((i) => i.status === 'done').length
  return `${done}/${list.items.length} 任务完成${list.objective ? `（目标：${list.objective.slice(0, 60)}）` : ''}`
}

function okResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(structuredContent ? { structuredContent } : {}),
  }
}

function errResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export type ToolCallStatus = 'pending' | 'ok' | 'error'

export type ToolCallRecord = {
  id: number
  sessionId: string
  tool: string
  argsKeys: string[]
  args?: Record<string, unknown>
  at: number
  status: ToolCallStatus
  durationMs?: number
  result?: unknown
}

export type ToolCallSnapshot = {
  sessions: Record<string, ToolCallRecord[]>
  recent: ToolCallRecord[]
}

export class ToolTracker {
  private toolCallsBySession = new Map<string, ToolCallRecord[]>()
  private sessionLastAt = new Map<string, number>()
  private toolCallById = new Map<unknown, ToolCallRecord>()
  private seq = 0
  private readonly perSession = 100
  private readonly maxSessions = 24
  private readonly total = 200
  private readonly pendingTimeout = 5 * 60_000
  private listeners = new Set<(record: ToolCallRecord, direction: 'start' | 'done') => void>()

  on(listener: (record: ToolCallRecord, direction: 'start' | 'done') => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(id: unknown, record: Omit<ToolCallRecord, 'id'>) {
    const item: ToolCallRecord = { ...record, id: ++this.seq }
    this.toolCallById.set(id, item)
    const list = this.toolCallsBySession.get(item.sessionId) ?? []
    list.unshift(item)
    if (list.length > this.perSession) list.length = this.perSession
    this.toolCallsBySession.set(item.sessionId, list)
    this.sessionLastAt.set(item.sessionId, item.at)
    this.evict()
    this.emit(item, 'start')
    return item
  }

  done(id: unknown, result?: unknown, error?: unknown) {
    const item = this.toolCallById.get(id)
    if (!item) return
    // 已完成 → 从 id 索引移除：只保留未回填的 pending，防止长会话无界增长
    this.toolCallById.delete(id)
    item.status = error ? 'error' : 'ok'
    item.result = error ?? result
    item.durationMs = Date.now() - item.at
    this.emit(item, 'done')
  }

  clear() {
    this.toolCallsBySession.clear()
    this.sessionLastAt.clear()
    this.toolCallById.clear()
  }

  snapshot(): ToolCallSnapshot {
    const now = Date.now()
    for (const list of this.toolCallsBySession.values()) {
      for (const item of list) {
        if (item.status === 'pending' && now - item.at > this.pendingTimeout) item.status = 'error'
      }
    }
    const sessions: Record<string, ToolCallRecord[]> = {}
    const recent: ToolCallRecord[] = []
    for (const [sid, list] of this.toolCallsBySession) {
      sessions[sid] = list
      recent.push(...list)
    }
    recent.sort((a, b) => b.at - a.at)
    return { sessions, recent: recent.slice(0, this.total) }
  }

  private evict() {
    if (this.toolCallsBySession.size <= this.maxSessions) return
    let oldest: string | undefined
    let time = Infinity
    for (const [sid, at] of this.sessionLastAt) {
      if (at < time) {
        oldest = sid
        time = at
      }
    }
    if (oldest) {
      this.toolCallsBySession.delete(oldest)
      this.sessionLastAt.delete(oldest)
    }
  }

  private emit(record: ToolCallRecord, direction: 'start' | 'done') {
    for (const listener of this.listeners) {
      try { listener(record, direction) } catch {}
    }
  }
}

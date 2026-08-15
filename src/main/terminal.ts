/**
 * 终端会话管理（node-pty + ConPTY，Windows 原生体验）
 *
 * 多会话：每个标签页一个 PTY 会话，sessionId → IPty 映射。
 * spawn（cwd = 项目根目录）、write、resize、kill 均按会话 id 路由；
 * 项目切换时由上层 killAll 后由渲染层按标签逐个重新 spawn（新会话进新项目根目录）。
 */

import { spawn, type IPty } from 'node-pty'

export interface TerminalCallbacks {
  onData: (id: string, data: string) => void
  onExit: (id: string, exitCode: number | null) => void
}

const sessions = new Map<string, IPty>()

/** 拉起 PowerShell 会话（同 id 先杀旧的）；返回是否成功 */
export function spawnTerminal(id: string, cwd: string, cb: TerminalCallbacks): { ok: boolean; error?: string } {
  killTerminal(id)
  let pty: IPty
  try {
    pty = spawn('powershell.exe', ['-NoLogo'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd || undefined,
      env: { ...process.env, TERM: 'xterm-256color' },
    })
  } catch (err) {
    console.error('[term] 会话启动失败:', id, err instanceof Error ? err.message : String(err))
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  sessions.set(id, pty)
  console.log('[term] 会话已启动:', id, 'cwd=', cwd)
  pty.onData((data) => cb.onData(id, data))
  pty.onExit(({ exitCode }) => {
    sessions.delete(id)
    console.log('[term] 会话退出:', id, 'code=', exitCode)
    cb.onExit(id, exitCode)
  })
  return { ok: true }
}

export function writeTerminal(id: string, data: string): void {
  try {
    sessions.get(id)?.write(data)
  } catch {
    /* 会话已退出则忽略 */
  }
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  try {
    sessions.get(id)?.resize(Math.max(2, cols), Math.max(1, rows))
  } catch {
    /* 会话已退出则忽略 */
  }
}

export function killTerminal(id: string): void {
  const pty = sessions.get(id)
  if (pty) {
    try {
      pty.kill()
    } catch {
      /* 已退出则忽略 */
    }
  }
  sessions.delete(id)
}

/** 终止全部会话（项目切换 / 页面重载清理孤儿会话） */
export function killAllTerminals(): void {
  for (const id of [...sessions.keys()]) killTerminal(id)
}

export function terminalCount(): number {
  return sessions.size
}

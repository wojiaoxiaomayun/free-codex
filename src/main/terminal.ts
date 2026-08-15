/**
 * 终端会话管理（node-pty + ConPTY，Windows 原生体验）
 *
 * 单一活跃会话：spawn PowerShell（cwd = 项目根目录）、写入、resize、kill；
 * 项目切换时由上层 kill 后重新 spawn（新会话进新项目根目录）。
 */

import { spawn, type IPty } from 'node-pty'

export interface TerminalCallbacks {
  onData: (data: string) => void
  onExit: (exitCode: number | null) => void
}

let pty: IPty | null = null

/** 拉起 PowerShell 会话（先杀掉旧会话）；返回是否成功 */
export function spawnTerminal(cwd: string, cb: TerminalCallbacks): { ok: boolean; error?: string } {
  killTerminal()
  try {
    pty = spawn('powershell.exe', ['-NoLogo'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd || undefined,
      env: { ...process.env, TERM: 'xterm-256color' },
    })
  } catch (err) {
    pty = null
    console.error('[term] spawn 失败:', err instanceof Error ? err.message : String(err))
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  console.log('[term] PowerShell 已 spawn, cwd=', cwd, 'pid=', pty.pid)
  pty.onData((data) => cb.onData(data))
  pty.onExit(({ exitCode }) => {
    console.log('[term] 会话退出 code=', exitCode)
    pty = null
    cb.onExit(exitCode)
  })
  return { ok: true }
}

export function writeTerminal(data: string): void {
  try {
    pty?.write(data)
  } catch {
    /* 会话已退出则忽略 */
  }
}

export function resizeTerminal(cols: number, rows: number): void {
  try {
    pty?.resize(Math.max(2, cols), Math.max(1, rows))
  } catch {
    /* 会话已退出则忽略 */
  }
}

export function killTerminal(): void {
  try {
    pty?.kill()
  } catch {
    /* 已退出则忽略 */
  }
  pty = null
}

export function terminalAlive(): boolean {
  return pty !== null
}

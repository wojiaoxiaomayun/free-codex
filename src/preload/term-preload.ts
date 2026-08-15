/**
 * 终端视图专用 preload：暴露 window.termApi（xterm 页面与主进程 PTY 之间的桥）。
 * 与主窗口 / overlay 的 preload 相互独立，互不暴露。
 */

import { contextBridge, ipcRenderer, clipboard } from 'electron'

function subscribe<T>(channel: string, cb: (value: T) => void): void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, listener)
}

contextBridge.exposeInMainWorld('termApi', {
  ready: (): void => ipcRenderer.send('term:ready'),
  write: (data: string): void => ipcRenderer.send('term:write', data),
  resize: (cols: number, rows: number): void => ipcRenderer.send('term:resize', { cols, rows }),
  paste: (): string => clipboard.readText(),
  onData: (cb: (data: string) => void): void => subscribe<string>('term:data', cb),
  onExit: (cb: (info: { exitCode: number | null }) => void): void =>
    subscribe<{ exitCode: number | null }>('term:exit', cb),
  onSession: (cb: () => void): void => {
    ipcRenderer.on('term:session', cb)
  },
  onFocus: (cb: () => void): void => {
    ipcRenderer.on('term:focus', cb)
  },
  onTheme: (cb: (dark: boolean) => void): void => subscribe<boolean>('term:theme', cb),
})

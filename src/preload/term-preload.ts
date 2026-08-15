/**
 * 终端视图专用 preload：暴露 window.termApi（xterm 页面与主进程 PTY 之间的桥）。
 * 多标签：所有读写/事件按会话 id 路由。
 */

import { contextBridge, ipcRenderer, clipboard } from 'electron'

function subscribe<T>(channel: string, cb: (value: T) => void): void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, listener)
}

contextBridge.exposeInMainWorld('termApi', {
  /** 页面脚本开始执行：让主进程清理孤儿会话（页面重载场景） */
  pageReady: (): void => ipcRenderer.send('term:pageReady'),
  /** 新建标签：拉起对应会话 */
  spawn: (id: string): void => ipcRenderer.send('term:spawn', id),
  /** 用户输入 → 对应会话 */
  write: (id: string, data: string): void => ipcRenderer.send('term:write', { id, data }),
  /** 上报尺寸 → 对应会话 */
  resize: (id: string, cols: number, rows: number): void => ipcRenderer.send('term:resize', { id, cols, rows }),
  /** 关闭标签：终止对应会话 */
  kill: (id: string): void => ipcRenderer.send('term:kill', id),
  /** 高度拖拽：开始（主进程轮询光标） */
  dragStart: (): void => ipcRenderer.send('term:dragStart'),
  /** 高度拖拽：结束 */
  dragEnd: (): void => ipcRenderer.send('term:dragEnd'),
  /** 读取剪贴板文本（右键粘贴用） */
  paste: (): string => clipboard.readText(),
  onData: (cb: (msg: { id: string; data: string }) => void): void => subscribe('term:data', cb),
  onExit: (cb: (msg: { id: string; exitCode: number | null }) => void): void =>
    subscribe('term:exit', cb),
  /** 新会话开始（清屏） */
  onSession: (cb: (msg: { id: string; cwd: string }) => void): void => subscribe('term:session', cb),
  /** 面板打开：聚焦当前标签 */
  onFocus: (cb: () => void): void => {
    ipcRenderer.on('term:focus', cb)
  },
  /** 项目切换：全部会话已终止，渲染层清屏并逐个重拉 */
  onRestartAll: (cb: () => void): void => {
    ipcRenderer.on('term:restartAll', cb)
  },
  onTheme: (cb: (dark: boolean) => void): void => subscribe<boolean>('term:theme', cb),
  /** 字体建议：用户配置（configFace）+ Windows Terminal 主题字体（wtFace） */
  onFont: (cb: (msg: { configFace: string; wtFace: string | null }) => void): void =>
    subscribe('term:font', cb),
})

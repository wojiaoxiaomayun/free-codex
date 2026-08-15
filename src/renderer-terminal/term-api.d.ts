/** termApi 类型声明（src/preload/term-preload.ts 暴露） */

export interface TermExitInfo {
  exitCode: number | null
}

export interface TermApi {
  /** 页面就绪：请求主进程拉起终端会话 */
  ready(): void
  /** 用户输入 → PTY */
  write(data: string): void
  /** 上报终端尺寸（fit 后） */
  resize(cols: number, rows: number): void
  /** 读取剪贴板文本（右键粘贴用） */
  paste(): string
  onData(cb: (data: string) => void): void
  onExit(cb: (info: TermExitInfo) => void): void
  /** 新会话开始（项目切换重启）：渲染层清屏 */
  onSession(cb: () => void): void
  /** 面板打开：聚焦 xterm textarea */
  onFocus(cb: () => void): void
  onTheme(cb: (dark: boolean) => void): void
}

declare global {
  interface Window {
    termApi: TermApi
  }
}

export {}

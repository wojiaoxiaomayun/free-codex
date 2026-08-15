/** termApi 类型声明（src/preload/term-preload.ts 暴露） */

export interface TermExitInfo {
  exitCode: number | null
}

export interface TermSessionInfo {
  id: string
  cwd: string
}

export interface TermDataMsg {
  id: string
  data: string
}

export interface TermApi {
  /** 页面脚本开始执行：让主进程清理孤儿会话（页面重载场景） */
  pageReady(): void
  /** 新建标签：拉起对应会话 */
  spawn(id: string): void
  /** 用户输入 → 对应会话 */
  write(id: string, data: string): void
  /** 上报尺寸 → 对应会话 */
  resize(id: string, cols: number, rows: number): void
  /** 关闭标签：终止对应会话 */
  kill(id: string): void
  /** 高度拖拽：开始（主进程轮询光标） */
  dragStart(): void
  /** 高度拖拽：结束 */
  dragEnd(): void
  /** 读取剪贴板文本（右键粘贴用） */
  paste(): string
  onData(cb: (msg: TermDataMsg) => void): void
  onExit(cb: (msg: { id: string; exitCode: number | null }) => void): void
  /** 新会话开始（清屏） */
  onSession(cb: (msg: TermSessionInfo) => void): void
  /** 面板打开：聚焦当前标签 */
  onFocus(cb: () => void): void
  /** 项目切换：全部会话已终止，渲染层清屏并逐个重拉 */
  onRestartAll(cb: () => void): void
  onTheme(cb: (dark: boolean) => void): void
  /** 字体建议：用户配置（configFace）+ Windows Terminal 主题字体（wtFace） */
  onFont(cb: (msg: { configFace: string; wtFace: string | null }) => void): void
}

declare global {
  interface Window {
    termApi: TermApi
  }
}

export {}

/**
 * 主窗口 Toast 桥。
 *
 * Toaster 渲染在 overlay 子窗口（浮在 ChatGPT 原生视图之上），主窗口组件
 * （SettingsView / TitleBar 等）没有 Toaster；这里把 toast 调用通过 IPC
 * 转发到 overlay 窗口渲染，保持与 vue-sonner 相同的调用形状。
 */

import type { ToastBridgeInput } from '../freecodex'

function push(type: ToastBridgeInput['type'], title: string, opts?: { description?: string }): void {
  window.freeCodex.toast({ type, title, description: opts?.description })
}

/** 与 vue-sonner toast 同形状的桥接对象（成功/错误/警告/信息） */
export const toast = {
  success: (title: string, opts?: { description?: string }): void => push('success', title, opts),
  error: (title: string, opts?: { description?: string }): void => push('error', title, opts),
  warning: (title: string, opts?: { description?: string }): void => push('warning', title, opts),
  info: (title: string, opts?: { description?: string }): void => push('info', title, opts),
  message: (title: string, opts?: { description?: string }): void => push('message', title, opts),
}

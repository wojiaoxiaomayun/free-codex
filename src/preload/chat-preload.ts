/**
 * ChatGPT 视图专用 preload：
 * 1. 通过 webFrame.executeJavaScript 把 MENTION_SCRIPT 注入页面主 world（早于页面脚本）
 * 2. 监听页面 postMessage（@ 提及 / / 技能触发），桥接到主进程
 *
 * 与主窗口的 preload（index.ts）分离：ChatGPT 页面不暴露任何 API 给 renderer。
 */

import { webFrame, ipcRenderer } from 'electron'
import { NAVIGATOR_FIX_SCRIPT } from '../main/ua'
import { MENTION_SCRIPT } from '../main/mention-script'

try {
  // 页面脚本运行前覆盖 navigator/userAgentData/window.chrome 指纹
  // （ChatGPT 凭 UA 与实际 Chromium 版本一致性判定浏览器是否安全）
  webFrame.executeJavaScript(NAVIGATOR_FIX_SCRIPT)
} catch (err) {
  console.error('[chat-preload] 注入 navigator 指纹失败:', err)
}

try {
  webFrame.executeJavaScript(MENTION_SCRIPT)
} catch (err) {
  console.error('[chat-preload] 注入 mention script 失败:', err)
}

window.addEventListener('message', (event) => {
  const data = event.data as { type?: string }
  if (!data || typeof data.type !== 'string') return
  if (data.type === 'freehub:mention-open') {
    ipcRenderer.send('freecodex:mentionOpen')
  } else if (data.type === 'freehub:skill-open') {
    ipcRenderer.send('freecodex:skillOpen')
  } else if (data.type === 'freecodex:inject') {
    // 项目路径注入统计上报（诊断用）
    ipcRenderer.send('freecodex:injectStats', event.data)
  }
})

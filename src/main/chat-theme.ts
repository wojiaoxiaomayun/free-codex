/**
 * ChatGPT 页面主题同步（从 freehub plugins/chatgpt/src/theme.ts 复制）
 *
 * freehub 实测的真实机制（2026-08）：
 * - 持久化：localStorage['theme'] = "dark" | "light"（旧版本 oai-theme）
 * - 视觉开关：<html> 上的 dark / light class（html.dark 切换整套 CSS 变量）
 *
 * 取代 free-codex 旧的 invert 反色 hack：直接设置 ChatGPT 自身的主题偏好并
 * 切换 class，主题与主界面一致，且对图片/媒体无副作用。
 */

/**
 * 应用主题脚本（主进程控制 ChatGPT 亮暗主题）。
 * 注意：返回的不是 IIFE 调用结果，而是函数体（执行时传入主题名）。
 */
export const APPLY_THEME_SCRIPT = `(function (theme) {
  var dark = theme === 'dark';
  var root = document.documentElement;
  try {
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    localStorage.setItem('oai-theme', dark ? 'dark' : 'light');
  } catch (e) { /* ignore */ }
  root.classList.toggle('dark', dark);
  root.classList.toggle('light', !dark);
  root.classList.toggle('fh-theme-dark', dark);
  root.classList.toggle('fh-theme-light', !dark);
  document.body.classList.toggle('dark', dark);
  document.body.classList.toggle('light', !dark);
  return {
    ok: true,
    theme: dark ? 'dark' : 'light',
    htmlClass: root.className,
    bodyClass: document.body.className
  };
})`

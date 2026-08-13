/**
 * 浏览器指纹伪装（从 freehub apps/desktop/src/main/ua.ts 复制）
 *
 * Electron 的 WebContentsView 默认 UA 形如：
 *   ... Chrome/128.0.0.0 Electron/32.3.3 Safari/537.36（且带应用名 free-codex）
 * 站点（如 ChatGPT）通过 UA 中的 "Electron" 即可识别非真实浏览器，或通过
 * UA 版本与实际 Chromium 版本（Sec-CH-UA Client Hints）不一致判定"不安全浏览器"。
 * 这里伪装为同版本 Chromium 的桌面 Chrome UA，并同步 HTTP 请求头与
 * navigator.userAgentData / window.chrome 指纹。
 */

import { app, session } from 'electron'

/** 与 Electron 32 (Chromium 128) 匹配的 Chrome UA */
export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

/** 真实 Chrome 的 Sec-CH-UA 客户端提示头 */
export const SEC_CH_UA = '"Chromium";v="128", "Google Chrome";v="128", "Not-A.Brand";v="24"'
export const SEC_CH_UA_PLATFORM = '"Windows"'
export const SEC_CH_UA_MOBILE = '?0'

/**
 * 在主 world 覆盖 navigator 指纹的脚本（由 preload 通过 webFrame.executeJavaScript 注入，
 * 早于页面自身脚本执行）。
 */
export const NAVIGATOR_FIX_SCRIPT = `
(() => {
  const UA = ${JSON.stringify(CHROME_UA)};
  const define = (obj, key, value) => {
    try { Object.defineProperty(obj, key, { get: () => value, configurable: true }); }
    catch (e) { /* ignore */ }
  };
  define(navigator, 'userAgent', UA);
  define(navigator, 'appVersion', UA.replace(/^Mozilla\\//, ''));
  define(navigator, 'userAgentData', {
    brands: [
      { brand: 'Chromium', version: '128' },
      { brand: 'Google Chrome', version: '128' },
      { brand: 'Not-A.Brand', version: '24' },
    ],
    mobile: false,
    platform: 'Windows',
    getHighEntropyValues: () => Promise.resolve({
      architecture: 'x86',
      bitness: '64',
      brands: [
        { brand: 'Chromium', version: '128' },
        { brand: 'Google Chrome', version: '128' },
        { brand: 'Not-A.Brand', version: '24' },
      ],
      fullVersionList: [
        { brand: 'Chromium', version: '128.0.6613.86' },
        { brand: 'Google Chrome', version: '128.0.6613.86' },
        { brand: 'Not-A.Brand', version: '24.0.0.0' },
      ],
      mobile: false,
      platform: 'Windows',
      platformVersion: '15.0.0',
    }),
    toJSON: () => undefined,
  });
  define(navigator, 'webdriver', false);
  // Chrome 对象完整性
  if (!window.chrome) window.chrome = {};
  const chromeShim = {
    app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { NORMAL: 'normal', RELAUNCHING: 'relaunching', NOT_RUNNING: 'not_running' }, getDetails: () => null, getIsInstalled: () => false, getRunningState: () => 'not_running' },
    csi: () => ({}),
    loadTimes: () => ({ commitLoadTime: 0, connectionInfo: '', finishDocumentLoadTime: 0, finishLoadTime: 0, firstPaintAfterLoadTime: 0, firstPaintTime: 0, navigationType: 'Other', redirectCount: 0, requestTime: 0, startLoadTime: 0, wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: false, wasNpnNegotiated: false, wasAlternateProtocolAvailable: false }),
    runtime: {},
    send: () => undefined,
  };
  for (const k in chromeShim) { if (!(k in window.chrome)) { try { window.chrome[k] = chromeShim[k]; } catch (e) {} } }
})();
`

/**
 * 全局 UA fallback（模块加载时设置，app ready 前可用）。
 * 影响所有 webContents 的 navigator.userAgent。
 */
export function applyUserAgentFallback(): void {
  app.userAgentFallback = CHROME_UA
}

/**
 * Session 级伪装（必须在 app ready 后调用）
 * - session.setUserAgent：HTTP 请求头 UA
 * - onBeforeSendHeaders：同步 Sec-CH-UA 客户端提示头
 */
export function applySessionSpoofing(): void {
  session.defaultSession.setUserAgent(CHROME_UA)

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = CHROME_UA
    details.requestHeaders['sec-ch-ua'] = SEC_CH_UA
    details.requestHeaders['sec-ch-ua-mobile'] = SEC_CH_UA_MOBILE
    details.requestHeaders['sec-ch-ua-platform'] = SEC_CH_UA_PLATFORM
    callback({ requestHeaders: details.requestHeaders })
  })
}

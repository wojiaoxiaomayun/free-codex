/**
 * overlay 子窗口专用 preload。
 *
 * 与主窗口 preload（index.ts）共用同一套 `window.freeCodex` API：
 * 命令面板 / Diff / Toast 都跑在这个透明的置顶子窗口里，
 * 组件内部原有的 `window.freeCodex.*` 调用无需改动。
 */

import { exposeFreeCodexApi } from './api'

exposeFreeCodexApi()

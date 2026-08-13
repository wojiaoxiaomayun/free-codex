import { createApp } from 'vue'
import './overlay.css'
import '../renderer/styles/globals.css'
import 'vue-sonner/style.css'
import OverlayApp from './OverlayApp.vue'

// overlay 是独立窗口，主题由主进程通过 overlay:theme 事件推送，
// 这里不做 localStorage 初始化（与主窗口隔离）。
const app = createApp(OverlayApp)
app.mount('#app')

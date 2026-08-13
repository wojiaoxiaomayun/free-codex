import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import './styles/globals.css'
import 'vue-sonner/style.css'
import App from './App.vue'

// 主题初始化：默认白色（light），优先读取用户选择（在挂载前设置，避免闪烁）
const theme = localStorage.getItem('free-codex-theme') ?? 'light'
document.documentElement.classList.toggle('dark', theme === 'dark')

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('./views/HomeView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('./views/SettingsView.vue'),
    },
  ],
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

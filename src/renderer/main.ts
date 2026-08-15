import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import './styles/globals.css'
import 'vue-sonner/style.css'
import App from './App.vue'
import { theme } from './composables/useTheme'

// 主题初始化：useColorMode 模块级实例在挂载前即已同步 <html> 的 dark class
// （读取 localStorage['free-codex-theme']，避免首帧闪烁）
void theme

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
    {
      path: '/welcome',
      name: 'welcome',
      component: () => import('./views/WelcomeView.vue'),
    },
  ],
})

const app = createApp(App)
app.use(router)
app.mount('#app')

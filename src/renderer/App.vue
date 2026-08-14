<template>
  <div class="flex h-dvh w-full flex-col bg-background text-foreground">
    <!-- 自定义标题栏（拖拽 + 窗口按钮 + 项目切换 + 设置 + 主题） -->
    <TitleBar />

    <!-- 主体：中间 ChatGPT 网页视图 / 应用页面 + 右侧工具面板 -->
    <div class="flex min-h-0 flex-1">
      <main class="min-w-0 flex-1 overflow-hidden bg-background">
        <router-view />
      </main>

      <!-- 右侧工具面板仅在 AI 应用页面显示（设置/欢迎页展示工具调用记录无意义） -->
      <RightPanel v-if="!isAppPage" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TitleBar from './components/TitleBar.vue'
import RightPanel from './components/RightPanel.vue'

const route = useRoute()
const router = useRouter()

/** 应用内页面（隐藏右侧工具面板；欢迎/设置页展示工具记录无意义） */
const isAppPage = computed(() => route.name === 'settings' || route.name === 'welcome')

// WebContentsView 是原生层，CSS z-index 无法让 renderer UI 覆盖它。
// 因此 ChatGPT 视图的显示/隐藏只由路由决定：应用页隐藏，首页恢复。
// 命令面板 / Diff / Toast 已搬到 overlay 子窗口（浮在原生视图之上）。
watch(
  () => route.name,
  async (name) => {
    if (name === 'home') {
      await window.freeCodex.showActiveView().catch(() => undefined)
    } else {
      await window.freeCodex.hideViews().catch(() => undefined)
    }
  },
  { immediate: true },
)

// 首次启动且未配置（也没有可用的 codex-mcp 配置）→ 进入欢迎向导
onMounted(async () => {
  try {
    const s = await window.freeCodex.onboardingStatus()
    if (s.needsOnboarding && route.name !== 'welcome') {
      await router.replace('/welcome')
    }
  } catch {
    /* 状态读取失败不阻塞启动 */
  }
})
</script>

<style>
html,
body,
#app {
  height: 100%;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',
    Arial, sans-serif;
}
</style>

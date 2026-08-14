<template>
  <!-- 首页主体 = ChatGPT 原生 WebContentsView（盖在本渲染层上），这里无需渲染内容；
       路由变化时由 App.vue 控制视图显隐，避免切换时露出被盖住的残留内容（闪现）。 -->
  <div class="h-full bg-background" />
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

/** 进入设置：先切路由再隐藏 ChatGPT 视图，避免中间露出被盖住的首页内容（闪现） */
async function openSettings(): Promise<void> {
  router.push('/settings')
  await window.freeCodex.hideViews().catch(() => undefined)
}
</script>

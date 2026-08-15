<template>
  <!-- 副工具栏：位于 titlebar 与 ChatGPT 原生 WebContentsView 之间（App.vue 布局）。
       首页 / 刷新在左，公网状态 / 插件状态检测在右。
       宽度由其父容器（聊天内容列）决定，与 ChatGPT / 终端视图一致，不越过右侧面板。 -->
  <div class="flex h-9 shrink-0 items-center gap-0.5 border-b border-border bg-muted/40 px-2">
    <!-- 左：回到 ChatGPT 首页（Free Codex 特有：WebContentsView 加载起始 URL） -->
    <button
      class="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label="回到 ChatGPT 首页"
      title="回到 ChatGPT 首页"
      @click="goHomeChat"
    >
      <HomeIcon class="size-3.5" />
      首页
    </button>

    <!-- 左：刷新当前页面（首页 → 刷新 ChatGPT 视图；设置/欢迎页 → 刷新本页） -->
    <button
      class="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label="刷新当前页面"
      :title="'刷新当前页面（' + (isChatViewVisible ? 'ChatGPT 视图' : '本页') + '）'"
      :disabled="refreshing"
      @click="refreshCurrent"
    >
      <RefreshCwIcon :class="refreshing ? 'size-3.5 animate-spin' : 'size-3.5'" />
      刷新
    </button>

    <div class="flex-1"></div>

    <!-- 右：公网连通状态（点击重新检测） -->
    <button
      class="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label="公网连通状态"
      :title="tunnelTitle"
      @click="refreshTunnelStatus"
    >
      <Loader2Icon v-if="tunnelState === 'checking'" class="size-3.5 animate-spin text-yellow-500" />
      <WifiIcon v-else-if="tunnelState === 'online'" class="size-3.5 text-emerald-500" />
      <WifiOffIcon v-else-if="tunnelState === 'offline'" class="size-3.5 text-red-500" />
      <WifiIcon v-else-if="tunnelState === 'local'" class="size-3.5 text-muted-foreground" />
      <WifiOffIcon v-else class="size-3.5 text-muted-foreground" />
      <span>{{ tunnelLabel }}</span>
    </button>

    <!-- 右：插件状态（freecodex 连接器；点击即时重新检测） -->
    <button
      class="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label="插件状态"
      :title="pluginTitle"
      @click="refreshPluginStatus"
    >
      <Loader2Icon v-if="pluginState === 'checking'" class="size-3.5 animate-spin text-yellow-500" />
      <PlugZapIcon v-else-if="pluginState === 'installed'" class="size-3.5 text-emerald-500" />
      <PlugZapIcon v-else-if="pluginState === 'not-installed'" class="size-3.5 text-red-500" />
      <PlugZapIcon v-else class="size-3.5 text-muted-foreground" />
      <span>{{ pluginLabel }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  HomeIcon,
  Loader2Icon,
  PlugZapIcon,
  RefreshCwIcon,
  WifiIcon,
  WifiOffIcon,
} from 'lucide-vue-next'
import type { PluginStatus, TunnelStatus } from '../freecodex'

const route = useRoute()

// ---------- 回到 ChatGPT 首页（加载起始 URL，避免刷新只重载当前链接）----------
async function goHomeChat(): Promise<void> {
  await window.freeCodex.goHomeChat()
}

// ---------- 公网连通状态（副工具栏指示器）----------
const tunnelStatus = ref<TunnelStatus>({
  state: 'checking',
  publicUrl: '',
  checkedAt: 0,
  detail: '检测中…',
})
let unsubscribeTunnelStatus: (() => void) | undefined

const tunnelState = computed(() => tunnelStatus.value.state)

/** 悬浮提示：状态详情 + 公网地址 */
const tunnelTitle = computed(() => {
  const s = tunnelStatus.value
  return s.publicUrl ? `${s.detail}\n公网地址: ${s.publicUrl}` : s.detail
})

/** 副工具栏短标签 */
const tunnelLabel = computed(() => {
  switch (tunnelState.value) {
    case 'checking':
      return '检测中…'
    case 'online':
      return '公网正常'
    case 'offline':
      return '公网不可达'
    case 'local':
      return '本地模式'
    case 'gateway_stopped':
      return '网关未运行'
    default:
      return '未知'
  }
})

/** 手动触发重新检测 */
async function refreshTunnelStatus(): Promise<void> {
  tunnelStatus.value = await window.freeCodex.tunnelStatus()
}

// ---------- 插件状态（freecodex 连接器）----------
const pluginStatus = ref<PluginStatus>({ state: 'checking', checkedAt: 0 })
let unsubscribePluginStatus: (() => void) | undefined

const pluginState = computed(() => pluginStatus.value.state)

/** 悬浮提示：插件状态详情 */
const pluginTitle = computed(() => {
  const s = pluginStatus.value
  switch (s.state) {
    case 'installed':
      return `插件: 已安装 (${s.displayName ?? ''})`
    case 'not-installed':
      return '插件: 未安装'
    case 'no-login':
      return '插件: 未登录 ChatGPT'
    case 'no-domain':
      return '插件: 未配置公网域名'
    default:
      return '插件: 检测中…'
  }
})

/** 副工具栏短标签 */
const pluginLabel = computed(() => {
  const s = pluginStatus.value
  switch (s.state) {
    case 'installed':
      return `插件已安装${s.displayName ? ` · ${s.displayName}` : ''}`
    case 'not-installed':
      return '插件未安装'
    case 'no-login':
      return '插件未登录'
    case 'no-domain':
      return '插件未配置域名'
    default:
      return '插件检测中…'
  }
})

/** 点击插件图标 → 即时重新检测（先转圈给反馈，避免"点了没反应"的错觉） */
async function refreshPluginStatus(): Promise<void> {
  pluginStatus.value = { state: 'checking', checkedAt: Date.now() }
  try {
    pluginStatus.value = await window.freeCodex.pluginStatus()
  } catch {
    pluginStatus.value = { state: 'checking', checkedAt: Date.now() }
  }
}

// ---------- 刷新当前页面 ----------
const refreshing = ref(false)

/** 当前显示的是 ChatGPT 原生视图（首页路由）→ 刷新按钮作用于视图；否则作用于本渲染层页面 */
const isChatViewVisible = computed(() => route.name === 'home')

/** 刷新当前页面（主进程按可见层选择目标：ChatGPT 视图 / 主渲染层） */
async function refreshCurrent(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await window.freeCodex.refreshView()
  } finally {
    // 刷新主渲染层时页面会被整体重载，这里不会执行到（无害）
    refreshing.value = false
  }
}

onMounted(() => {
  // 订阅先行：即使初始化查询失败，副工具栏仍能收到实时推送
  unsubscribeTunnelStatus = window.freeCodex.onTunnelStatus((status) => {
    tunnelStatus.value = status as TunnelStatus
  })
  unsubscribePluginStatus = window.freeCodex.onPluginStatus((status) => {
    pluginStatus.value = status as PluginStatus
  })
  // 初始化查询：各自兜底，失败不阻塞其余
  void refreshTunnelStatus().catch(() => undefined)
})

onUnmounted(() => {
  unsubscribeTunnelStatus?.()
  unsubscribePluginStatus?.()
})
</script>

<template>
  <header
    class="titlebar-drag flex h-9 shrink-0 items-center border-b border-border bg-background"
    @dblclick="toggleMaximize"
  >
    <!-- 左侧：应用标识 + 项目切换 -->
    <div class="flex min-w-0 items-center gap-1.5 px-3">
      <span class="text-sm">◈</span>
      <span class="text-xs font-medium tracking-wide text-muted-foreground">Free Codex</span>
      <div class="titlebar-no-drag ml-1">
        <button
          class="flex h-7 max-w-44 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="选择项目"
          :title="activeProject?.active ?? '选择项目'"
          @click="openProjectPalette"
        >
          <FolderOpenIcon class="size-3.5 shrink-0" />
          <span class="truncate font-medium">{{ activeProjectName ?? '选择项目' }}</span>
        </button>
      </div>
    </div>

    <!-- 中间：可拖拽区域（占满） -->
    <div class="flex-1"></div>

    <!-- 右侧：公网状态 + 回到首页 + 设置 + 主题切换 + 窗口控制按钮 -->
    <div class="titlebar-no-drag flex items-center">
      <!-- 公网连通状态（点击重新检测） -->
      <button
        class="flex h-9 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label="公网连通状态"
        :title="tunnelTitle"
        @click="refreshTunnelStatus"
      >
        <Loader2Icon v-if="tunnelState === 'checking'" class="size-4 animate-spin text-yellow-500" />
        <WifiIcon v-else-if="tunnelState === 'online'" class="size-4 text-emerald-500" />
        <WifiOffIcon v-else-if="tunnelState === 'offline'" class="size-4 text-red-500" />
        <WifiIcon v-else-if="tunnelState === 'local'" class="size-4 text-muted-foreground" />
        <WifiOffIcon v-else class="size-4 text-muted-foreground" />
      </button>

      <!-- 插件状态（freecodex 连接器；点击即时重新检测） -->
      <button
        class="flex h-9 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label="插件状态"
        :title="pluginTitle"
        @click="refreshPluginStatus"
      >
        <Loader2Icon v-if="pluginState === 'checking'" class="size-4 animate-spin text-yellow-500" />
        <PlugZapIcon v-else-if="pluginState === 'installed'" class="size-4 text-emerald-500" />
        <PlugZapIcon v-else-if="pluginState === 'not-installed'" class="size-4 text-red-500" />
        <PlugZapIcon v-else class="size-4 text-muted-foreground" />
      </button>

      <!-- 回到 ChatGPT 首页（Free Codex 特有：WebContentsView 加载起始 URL） -->
      <button
        class="flex h-9 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label="回到 ChatGPT 首页"
        title="回到 ChatGPT 首页"
        @click="goHomeChat"
      >
        <HomeIcon class="size-4" />
      </button>

      <!-- 设置 -->
      <button
        class="flex h-9 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label="设置"
        @click="openSettings"
      >
        <SettingsIcon class="size-4" />
      </button>

      <!-- 主题切换 -->
      <button
        class="flex h-9 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        :aria-label="isDark ? '切换亮色主题' : '切换暗色主题'"
        @click="toggleTheme"
      >
        <SunIcon v-if="isDark" class="size-4" />
        <MoonIcon v-else class="size-4" />
      </button>
      <button
        class="flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label="最小化"
        @click="minimize"
      >
        <MinusIcon class="size-4" />
      </button>
      <button
        class="flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label="最大化"
        @click="toggleMaximize"
      >
        <CopyIcon v-if="maximized" class="size-3.5" />
        <SquareIcon v-else class="size-3.5" />
      </button>
      <button
        class="flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-white"
        aria-label="关闭"
        @click="close"
      >
        <XIcon class="size-4" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from '@/lib/toast-bridge'
import {
  CopyIcon,
  FolderOpenIcon,
  HomeIcon,
  Loader2Icon,
  MinusIcon,
  MoonIcon,
  PlugZapIcon,
  SettingsIcon,
  SquareIcon,
  SunIcon,
  WifiIcon,
  WifiOffIcon,
  XIcon,
} from 'lucide-vue-next'
import type { FreeCodexWindowControls, PluginStatus, ProjectState, TunnelStatus } from '../freecodex'

const windowControls: FreeCodexWindowControls = window.freeCodex.windowControls
const router = useRouter()

const maximized = ref(false)

// ---------- 项目（Project）----------
const activeProject = ref<ProjectState | null>(null)

/** 当前项目名（路径最后一段），无项目时为 null */
const activeProjectName = computed(() => {
  const active = activeProject.value?.active
  if (!active) return null
  return active.split(/[\\/]/).filter(Boolean).pop() ?? active
})

// ---------- 设置 ----------
/** 打开设置：先切路由再隐藏 ChatGPT 视图，避免中间露出被盖住的首页内容（闪现） */
async function openSettings(): Promise<void> {
  router.push('/settings')
  await window.freeCodex.hideViews().catch(() => undefined)
}

/** 回到 ChatGPT 首页（加载起始 URL，避免刷新只重载当前链接） */
async function goHomeChat(): Promise<void> {
  await window.freeCodex.goHomeChat()
}

// ---------- 公网连通状态（右上角指示器）----------
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

/** 手动触发重新检测 */
async function refreshTunnelStatus(): Promise<void> {
  tunnelStatus.value = await window.freeCodex.tunnelStatus()
}

// ---------- 右上角插件状态（freecodex 连接器）----------
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

/** 点击插件图标 → 即时重新检测（先转圈给反馈，避免"点了没反应"的错觉） */
async function refreshPluginStatus(): Promise<void> {
  pluginStatus.value = { state: 'checking', checkedAt: Date.now() }
  try {
    pluginStatus.value = await window.freeCodex.pluginStatus()
  } catch {
    pluginStatus.value = { state: 'checking', checkedAt: Date.now() }
  }
}

// ---------- 主题切换 ----------
const isDark = ref(document.documentElement.classList.contains('dark'))

function toggleTheme(): void {
  const dark = !isDark.value
  document.documentElement.classList.toggle('dark', dark)
  localStorage.setItem('free-codex-theme', dark ? 'dark' : 'light')
  isDark.value = dark
  // 同步 ChatGPT 页面主题（主进程注入覆盖样式）
  window.freeCodex.setTheme(dark).catch(() => toast.error('ChatGPT 主题同步失败'))
}

// ---------- 窗口控制 ----------
function minimize(): void {
  windowControls.minimize()
}

function toggleMaximize(): void {
  windowControls.toggleMaximize()
}

function close(): void {
  windowControls.close()
}

let unsubscribe: (() => void) | undefined
let unsubscribeProjectChanged: (() => void) | undefined

/** 打开项目选择面板（overlay 子窗口内的命令面板） */
function openProjectPalette(): void {
  void window.freeCodex.openProjectPalette()
}

onMounted(async () => {
  maximized.value = await windowControls.isMaximized()
  unsubscribe = windowControls.onMaximizedChange((value) => {
    maximized.value = value
  })
  activeProject.value = await window.freeCodex.projects.get()
  // 项目在 overlay 面板里被激活后，主进程推送 project:changed 刷新标题栏
  unsubscribeProjectChanged = window.freeCodex.onProjectChanged((state) => {
    activeProject.value = state as ProjectState
  })
  // 公网连通状态：订阅主进程推送 + 启动时立即检测一次
  unsubscribeTunnelStatus = window.freeCodex.onTunnelStatus((status) => {
    tunnelStatus.value = status as TunnelStatus
  })
  void refreshTunnelStatus()
  // 右上角插件状态：订阅主进程推送（主进程 30s 轮询 + 安装/登录后即时推）
  unsubscribePluginStatus = window.freeCodex.onPluginStatus((status) => {
    pluginStatus.value = status as PluginStatus
  })
  // 启动时应用当前主题到 ChatGPT 页面（ChatGPT 视图可能已打开）
  window.freeCodex.setTheme(isDark.value).catch(() => undefined)
})

onUnmounted(() => {
  unsubscribe?.()
  unsubscribeProjectChanged?.()
  unsubscribeTunnelStatus?.()
  unsubscribePluginStatus?.()
})
</script>

<style scoped>
/* 标题栏拖拽：Windows/macOS 无边框窗口拖拽区 */
.titlebar-drag {
  -webkit-app-region: drag;
  user-select: none;
}

.titlebar-no-drag {
  -webkit-app-region: no-drag;
}
</style>

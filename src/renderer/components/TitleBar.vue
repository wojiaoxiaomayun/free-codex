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

    <!-- 右侧：刷新 ChatGPT + 设置 + 主题切换 + 窗口控制按钮 -->
    <div class="titlebar-no-drag flex items-center">
      <!-- 刷新 ChatGPT（Free Codex 特有：WebContentsView 直接 reload） -->
      <button
        class="flex h-9 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label="刷新 ChatGPT"
        title="刷新 ChatGPT"
        @click="reloadChat"
      >
        <RefreshCwIcon class="size-4" />
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
  MinusIcon,
  MoonIcon,
  RefreshCwIcon,
  SettingsIcon,
  SquareIcon,
  SunIcon,
  XIcon,
} from 'lucide-vue-next'
import type { FreeCodexWindowControls, ProjectState } from '../freecodex'

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
/** 打开设置：先隐藏 ChatGPT 视图（避免被 WebContentsView 覆盖） */
async function openSettings(): Promise<void> {
  await window.freeCodex.hideViews()
  router.push('/settings')
}

/** 刷新 ChatGPT 网页 */
async function reloadChat(): Promise<void> {
  await window.freeCodex.reloadChat()
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
  // 启动时应用当前主题到 ChatGPT 页面（ChatGPT 视图可能已打开）
  window.freeCodex.setTheme(isDark.value).catch(() => undefined)
})

onUnmounted(() => {
  unsubscribe?.()
  unsubscribeProjectChanged?.()
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

<template>
  <div class="overlay-root">
    <!-- Toast：与主窗口内容区对齐（主窗口标题栏 36px 高，往下留出安全间距） -->
    <Toaster
      position="top-center"
      :offset="{ top: '44px' }"
      :theme="dark ? 'dark' : 'light'"
      close-button
    />

    <!-- 命令面板 / Diff：渲染在 overlay 子窗口，天然浮在 ChatGPT 原生视图之上 -->
    <FilePalette v-model:open="fileOpen" />
    <SkillPalette v-model:open="skillOpen" />
    <ProjectPalette v-model:open="projectOpen" />
    <DiffViewer
      v-model:open="diffOpen"
      :diff="diffRecord"
      @reverted="diffOpen = false"
      @confirmed="diffOpen = false"
      @undo-result="onUndoResult"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue'
import { toast, Toaster, useVueSonner } from 'vue-sonner'
import FilePalette from '../renderer/components/FilePalette.vue'
import SkillPalette from '../renderer/components/SkillPalette.vue'
import ProjectPalette from '../renderer/components/ProjectPalette.vue'
import DiffViewer from '../renderer/components/DiffViewer.vue'
import type { FileDiffRecord, ToastBridgeInput } from '../renderer/freecodex'

// ---------- 各面板 / Diff 的打开状态（overlay 内部统一管理）----------
const fileOpen = ref(false)
const skillOpen = ref(false)
const projectOpen = ref(false)
const diffOpen = ref(false)
const diffRecord = ref<FileDiffRecord | null>(null)

// ---------- 主题（主进程 overlay:theme 推送）----------
const dark = ref(false)

// ---------- 交互模式上报（穿透控制）----------
// none：无 toast 无面板 → 隐藏 overlay 窗口
// toast：仅 toast（非阻塞）→ 显示 + 鼠标穿透，悬停 toast 时临时放开
// modal：面板/Diff 打开 → 显示 + 拦截交互 + 聚焦
const { activeToasts } = useVueSonner()
const toastCount = computed(() => activeToasts.value.length)
const modalOpen = computed(() => fileOpen.value || skillOpen.value || projectOpen.value || diffOpen.value)

let lastInteractive = false

function onMouseMove(e: MouseEvent): void {
  // 模态时无需 hover 穿透判断（整窗已可交互）
  if (modalOpen.value) return
  const target = e.target as HTMLElement | null
  const over = !!target?.closest?.('[data-sonner-toast]')
  if (over !== lastInteractive) {
    lastInteractive = over
    window.freeCodex.setOverlayInteractive(over)
  }
}

watchEffect(() => {
  const mode = modalOpen.value ? 'modal' : toastCount.value > 0 ? 'toast' : 'none'
  // 离开 toast 模式（toast 消失 / 面板打开）时，重置悬停穿透标记，避免主进程残留 interactive=true
  if (mode !== 'toast' && lastInteractive) {
    lastInteractive = false
    window.freeCodex.setOverlayInteractive(false)
  }
  window.freeCodex.setOverlayState(mode)
})

let removeTheme: (() => void) | undefined
let removeProjectPalette: (() => void) | undefined
let removeOpenDiff: (() => void) | undefined
let removeToast: (() => void) | undefined

/** 主窗口发来的 toast → 本地 vue-sonner store（渲染 + 触发 overlay 显示） */
function onBridgeToast(input: ToastBridgeInput): void {
  const opts = input.description !== undefined ? { description: input.description } : undefined
  switch (input.type) {
    case 'success':
      toast.success(input.title, opts)
      break
    case 'error':
      toast.error(input.title, opts)
      break
    case 'warning':
      toast.warning(input.title, opts)
      break
    case 'info':
      toast.info(input.title, opts)
      break
    default:
      toast.message(input.title, opts)
  }
}

/** 整段撤销完成：文件已恢复原状（diff=null）→ 关闭；否则用重算后的 diff 刷新视图 */
function onUndoResult(payload: { id: string; diff: FileDiffRecord | null }): void {
  if (payload.diff === null) {
    diffOpen.value = false
    diffRecord.value = null
  } else {
    diffRecord.value = payload.diff
  }
}

onMounted(() => {
  window.addEventListener('mousemove', onMouseMove, { passive: true })

  removeTheme = window.freeCodex.onTheme((value) => {
    dark.value = value === true
    document.documentElement.classList.toggle('dark', dark.value)
  })

  removeProjectPalette = window.freeCodex.onOpenProjectPalette(() => {
    projectOpen.value = true
  })

  removeOpenDiff = window.freeCodex.onOpenDiff((record) => {
    diffRecord.value = record as FileDiffRecord
    diffOpen.value = true
  })

  removeToast = window.freeCodex.onToast(onBridgeToast)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove)
  removeTheme?.()
  removeProjectPalette?.()
  removeOpenDiff?.()
  removeToast?.()
})
</script>

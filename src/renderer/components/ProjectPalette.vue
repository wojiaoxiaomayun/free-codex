<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="gap-0 overflow-hidden p-0 outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 sm:max-w-xl"
      :show-close-button="false"
    >
      <DialogHeader class="sr-only">
        <DialogTitle>切换项目</DialogTitle>
        <DialogDescription>打开文件夹或从历史项目切换</DialogDescription>
      </DialogHeader>

      <Command>
        <CommandInput placeholder="搜索项目…" />
        <CommandList class="h-[min(24rem,60vh)] max-h-[min(24rem,60vh)]">
          <!-- 动作 -->
          <CommandGroup>
            <CommandItem value="open-folder" @select="openFolder">
              <FolderOpenIcon />
              <span class="flex-1 text-left text-sm">打开文件夹</span>
            </CommandItem>
          </CommandGroup>

          <!-- 历史项目 -->
          <CommandGroup v-if="state.history.length" heading="历史项目">
            <CommandItem
              v-for="project in state.history"
              :key="project.path"
              :value="project.path"
              @select="activateProject(project.path)"
            >
              <FolderIcon />
              <span class="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span class="max-w-full truncate text-sm">{{ project.name }}</span>
                <span class="max-w-full text-left text-xs leading-snug text-muted-foreground line-clamp-2">{{ project.path }}</span>
              </span>
              <CheckIcon v-if="isActive(project.path)" class="text-primary" />
            </CommandItem>
          </CommandGroup>

          <CommandEmpty>没有匹配的项目</CommandEmpty>
        </CommandList>
      </Command>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { CheckIcon, FolderIcon, FolderOpenIcon } from 'lucide-vue-next'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import type { ProjectActionResult, ProjectState } from '../freecodex'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  /** 项目激活成功（携带最新状态，供标题栏刷新显示） */
  activated: [state: ProjectState]
}>()

const state = ref<ProjectState>({ active: null, history: [] })

function isActive(path: string): boolean {
  const active = state.value.active
  if (!active) return false
  // Windows 路径大小写不敏感
  if (window.electronAPI?.platform === 'win32') {
    return path.toLowerCase() === active.toLowerCase()
  }
  return path === active
}

/** 面板打开时刷新状态 */
async function refresh(): Promise<void> {
  state.value = await window.freeCodex.projects.get()
}

watch(open, async (opened) => {
  if (opened) {
    // overlay 子窗口天然浮在 ChatGPT 原生视图之上，无需再隐藏视图
    await refresh()
  }
})

/** 统一结果处理：成功 → 关闭 + toast + 通知标题栏；取消 → 保持面板；失败 → toast 错误 */
function handleResult(actionName: string, result: ProjectActionResult): void {
  if (result.ok) {
    open.value = false
    if (result.state) state.value = result.state
    emit('activated', result.state ?? state.value)
    const gw = result.gateway
    const desc = [result.state?.active ?? '', gw ? (gw.restarted ? '（网关已自动重启）' : gw.restartError ? `（网关重启失败：${gw.restartError}）` : '（网关未运行，下次启动生效）') : ''].filter(Boolean).join('\n')
    toast.success('已切换到项目', { description: desc })
    return
  }
  if (result.canceled) return // 用户取消选择器，面板保持打开
  if (result.error) {
    toast.error(`${actionName}失败`, { description: result.error })
  }
}

/** 打开文件夹：选择已有文件夹 */
async function openFolder(): Promise<void> {
  handleResult('打开文件夹', await window.freeCodex.projects.openFolder())
}

/** 从历史激活 */
async function activateProject(path: string): Promise<void> {
  handleResult('激活项目', await window.freeCodex.projects.activate(path))
}

onMounted(() => {
  if (open.value) void refresh()
})
</script>

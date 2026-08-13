<template>
  <div class="flex h-full items-center justify-center p-8">
    <Card class="w-full max-w-md">
      <CardHeader>
        <div class="flex items-center gap-3">
          <div class="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-2xl">
            ◈
          </div>
          <div class="flex flex-col gap-0.5">
            <CardTitle class="text-xl">Free Codex</CardTitle>
            <CardDescription>ChatGPT 桌面客户端 + Node.js codex-mcp 网关</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <p class="text-sm text-muted-foreground">
          {{ activeProjectName ? `当前项目：${activeProjectName}` : '尚未选择项目，从标题栏选择一个项目开始' }}
        </p>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" @click="openProjectPalette">
            <FolderOpenIcon class="size-4" />
            选择项目
          </Button>
          <Button variant="outline" size="sm" @click="openSettings">
            <SettingsIcon class="size-4" />
            进入设置
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { FolderOpenIcon, SettingsIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { ProjectState } from '../freecodex'

const router = useRouter()
const project = ref<ProjectState | null>(null)

const activeProjectName = computed(() => {
  const active = project.value?.active
  if (!active) return null
  return active.split(/[\\/]/).filter(Boolean).pop() ?? active
})

/** 进入设置：先隐藏 ChatGPT 视图 */
async function openSettings(): Promise<void> {
  await window.freeCodex.hideViews()
  router.push('/settings')
}

/** 打开项目选择面板（overlay 子窗口内的命令面板） */
function openProjectPalette(): void {
  void window.freeCodex.openProjectPalette()
}

onMounted(async () => {
  project.value = await window.freeCodex.projects.get()
})
</script>

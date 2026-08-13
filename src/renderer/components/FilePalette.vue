<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="gap-0 overflow-hidden p-0 outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 sm:max-w-xl"
      :show-close-button="false"
    >
      <DialogHeader class="sr-only">
        <DialogTitle>搜索文件</DialogTitle>
        <DialogDescription>输入 @ 引用项目文件</DialogDescription>
      </DialogHeader>

      <Command>
        <CommandInput placeholder="搜索文件…（输入 @ 触发）" />
        <CommandList class="h-[min(24rem,60vh)] max-h-[min(24rem,60vh)]">
          <template v-if="noProject">
            <p class="py-8 text-center text-xs text-muted-foreground">
              尚未选择项目，请先在标题栏选择项目文件夹
            </p>
          </template>
          <template v-else-if="loading">
            <p class="py-8 text-center text-xs text-muted-foreground">加载中…</p>
          </template>
          <template v-else-if="files.length">
            <CommandGroup>
              <CommandItem
                v-for="file in files"
                :key="file.path"
                :value="file.relPath"
                @select="insertFile(file)"
              >
                <FileIcon />
                <span class="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                  <span class="max-w-full truncate text-sm">{{ file.name }}</span>
                  <span class="max-w-full text-left text-xs leading-snug text-muted-foreground line-clamp-2">{{ file.relPath }}</span>
                </span>
              </CommandItem>
            </CommandGroup>
            <CommandEmpty>没有匹配的文件</CommandEmpty>
          </template>
          <p v-else class="py-8 text-center text-xs text-muted-foreground">项目中没有文件</p>
        </CommandList>
      </Command>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { FileIcon } from 'lucide-vue-next'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import type { ProjectFileEntry } from '../freecodex'

const open = defineModel<boolean>('open', { default: false })
const files = ref<ProjectFileEntry[]>([])
const noProject = ref(false)
const loading = ref(false)

watch(open, async (opened) => {
  if (opened) {
    // overlay 子窗口天然浮在 ChatGPT 原生视图之上，无需再隐藏视图
    await refresh()
  }
})

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const result = await window.freeCodex.listProjectFiles()
    files.value = result.files
    noProject.value = result.noProject
  } catch (err) {
    files.value = []
    noProject.value = false
    toast.error('加载文件失败', { description: err instanceof Error ? err.message : String(err) })
  } finally {
    loading.value = false
  }
}

/** 选中文件：把 @file:相对路径 插入到 ChatGPT 输入框（替换触发的 @） */
async function insertFile(file: ProjectFileEntry): Promise<void> {
  const reference = `@file:${file.relPath}`
  const result = await window.freeCodex.insertFileReference(reference)
  if (!result.ok) {
    toast.error('插入文件失败', { description: result.error })
    return
  }
  open.value = false
  toast.success('已插入文件引用', { description: reference })
}

let unsubscribe: (() => void) | undefined

onMounted(() => {
  unsubscribe = window.freeCodex.onOpenFilePalette(() => {
    open.value = true
  })
})

onUnmounted(() => unsubscribe?.())
</script>

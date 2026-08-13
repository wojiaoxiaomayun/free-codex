<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      :show-close-button="false"
    >
      <!-- 顶部：文件信息 + 统计 + 复制/关闭 -->
      <div class="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <FileDiffIcon class="size-4 shrink-0 text-muted-foreground" />
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate font-mono text-sm text-foreground">{{ diff?.path }}</span>
          <span class="text-[11px] text-muted-foreground">
            {{ toolLabel }} · {{ timeLabel }}
          </span>
        </div>
        <span class="shrink-0 font-mono text-[11px]">
          <span class="text-emerald-600 dark:text-emerald-400">+{{ diff?.additions ?? 0 }}</span>
          <span class="mx-1 text-muted-foreground">/</span>
          <span class="text-destructive">-{{ diff?.deletions ?? 0 }}</span>
        </span>
        <Button variant="ghost" size="sm" class="h-7 gap-1.5 px-2 text-xs" @click="copyDiff">
          <Copy class="size-3.5" />
          复制
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="size-7 shrink-0 px-0 text-muted-foreground hover:text-foreground"
          aria-label="关闭"
          title="关闭"
          @click="open = false"
        >
          <X class="size-4" />
        </Button>
      </div>

      <!-- diff 内容（unified hunks + 行号） -->
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div class="p-1">
          <div v-for="(rows, hi) in rowsByHunk" :key="hi" class="font-mono text-[11px] leading-relaxed">
            <!-- hunk 头 + 整段撤销 -->
            <div
              class="sticky top-0 z-10 flex items-center justify-between gap-2 border-y border-border bg-muted px-2 py-1 text-muted-foreground"
            >
              <span>@@ -{{ diff?.hunks[hi].oldStart }} +{{ diff?.hunks[hi].newStart }} @@</span>
              <button
                class="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-30"
                title="撤销此段变更（恢复为原文件内容）"
                :disabled="undoing"
                @click="undoHunk(hi)"
              >
                <Undo2 class="size-3.5" />
                撤销此段
              </button>
            </div>
            <div
              v-for="(row, li) in rows"
              :key="li"
              class="flex items-stretch"
              :class="rowClass(row.type)"
            >
              <span class="w-10 shrink-0 px-1 text-right opacity-60 select-none">{{ row.oldNo }}</span>
              <span class="w-10 shrink-0 px-1 text-right opacity-60 select-none">{{ row.newNo }}</span>
              <span class="w-4 shrink-0 text-center select-none">{{ prefix(row.type) }}</span>
              <span class="min-w-0 flex-1 whitespace-pre-wrap break-all px-1">{{ row.text }}</span>
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Copy, FileDiff as FileDiffIcon, Undo2, X } from 'lucide-vue-next'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { DiffHunk, DiffLine, FileDiffRecord } from '../freecodex'

const props = defineProps<{ open: boolean; diff: FileDiffRecord | null }>()
const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  /** 整段撤销完成：diff 为 null 表示该文件已恢复原状（父组件应移除记录） */
  (e: 'undo-result', payload: { id: string; diff: FileDiffRecord | null }): void
}>()

const open = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
})

/** 按 hunk 展开行号（旧行号 / 新行号，add 无旧号，del 无新号） */
interface DiffRow {
  type: DiffLine['type']
  oldNo: string
  newNo: string
  text: string
}

const rowsByHunk = computed<DiffRow[][]>(() =>
  (props.diff?.hunks ?? []).map((hunk: DiffHunk) => {
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart
    return hunk.lines.map((line) => {
      const row: DiffRow = {
        type: line.type,
        oldNo: line.type === 'add' ? '' : String(oldNo),
        newNo: line.type === 'del' ? '' : String(newNo),
        text: line.text,
      }
      if (line.type !== 'add') oldNo++
      if (line.type !== 'del') newNo++
      return row
    })
  }),
)

function prefix(type: DiffLine['type']): string {
  return type === 'add' ? '+' : type === 'del' ? '-' : ' '
}

function rowClass(type: DiffLine['type']): string {
  if (type === 'add') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (type === 'del') return 'bg-red-500/10 text-red-700 dark:text-red-300'
  return 'text-foreground'
}

const toolLabel = computed(() => {
  const name = props.diff?.toolName ?? ''
  return name.slice(name.lastIndexOf(':') + 1) || '工具'
})

const timeLabel = computed(() => {
  if (!props.diff) return ''
  const d = new Date(props.diff.timestamp)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})

/** 复制 unified diff 文本 */
async function copyDiff(): Promise<void> {
  const d = props.diff
  if (!d) return
  const parts = [`--- ${d.path}`, `+++ ${d.path}`]
  for (const hunk of d.hunks) {
    parts.push(`@@ -${hunk.oldStart} +${hunk.newStart} @@`)
    for (const line of hunk.lines) {
      parts.push((line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ') + line.text)
    }
  }
  try {
    await navigator.clipboard.writeText(parts.join('\n'))
    toast.success('已复制 diff')
  } catch {
    toast.error('复制失败')
  }
}

/** 整段撤销：调用主进程把该块替换回原内容并重算 diff，成功后通知父组件刷新记录 */
const undoing = ref(false)

async function undoHunk(hunkIndex: number): Promise<void> {
  const d = props.diff
  if (!d || undoing.value) return
  undoing.value = true
  try {
    const result = await window.freeCodex.undoDiffHunk({ id: d.id, hunkIndex })
    if (!result.ok) {
      toast.error('撤销失败', { description: result.error ?? '未知错误' })
      return
    }
    toast.success('已撤销该段变更')
    emit('undo-result', { id: d.id, diff: result.diff ?? null })
  } catch (err) {
    toast.error('撤销失败', { description: err instanceof Error ? err.message : String(err) })
  } finally {
    undoing.value = false
  }
}
</script>

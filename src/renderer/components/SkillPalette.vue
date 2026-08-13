<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="gap-0 overflow-hidden p-0 outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 sm:max-w-xl"
      :show-close-button="false"
    >
      <DialogHeader class="sr-only">
        <DialogTitle>选择技能</DialogTitle>
        <DialogDescription>选择技能插入 /skill:技能名 到输入框</DialogDescription>
      </DialogHeader>

      <Command>
        <CommandInput placeholder="选择技能（/skill:技能名 触发）…" />
        <CommandList class="h-[min(24rem,60vh)] max-h-[min(24rem,60vh)]">
          <template v-if="loading">
            <p class="py-8 text-center text-xs text-muted-foreground">加载中…</p>
          </template>
          <template v-else-if="visibleSkills.length">
            <CommandGroup>
              <CommandItem
                v-for="skill in visibleSkills"
                :key="skill.name"
                :value="skill.name"
                @select="insertSkill(skill.name)"
              >
                <SparklesIcon />
                <span class="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                  <span class="flex items-center gap-2">
                    <code class="text-sm text-primary">/{{ skill.name }}</code>
                    <span v-if="skill.scope === 'project'" class="rounded bg-muted px-1 text-[10px] text-muted-foreground">项目级</span>
                  </span>
                  <span class="max-w-full text-left text-xs leading-snug text-muted-foreground line-clamp-2">
                    {{ skill.description || '（无描述）' }}
                  </span>
                </span>
              </CommandItem>
            </CommandGroup>
            <CommandEmpty>没有匹配的技能</CommandEmpty>
          </template>
          <p v-else class="py-8 text-center text-xs text-muted-foreground">
            暂无可用技能，可在设置页新建
          </p>
        </CommandList>
      </Command>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { SparklesIcon } from 'lucide-vue-next'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import type { SkillEntry } from '../freecodex'

const open = defineModel<boolean>('open', { default: false })
const skills = ref<SkillEntry[]>([])
const loading = ref(false)
/** 本次打开是否已选中技能（选中后关闭无需恢复被拦截的 /） */
let inserted = false

/** 只列启用且解析成功的技能；项目级排前（同名项目级覆盖用户级由主进程去重） */
const visibleSkills = computed(() => {
  return skills.value
    .filter((s) => s.enabled && !s.invalid)
    .sort((a, b) => {
      if (a.scope === b.scope) return 0
      return a.scope === 'project' ? -1 : 1
    })
})

watch(open, async (opened) => {
  if (opened) {
    // overlay 子窗口天然浮在 ChatGPT 原生视图之上，无需再隐藏视图
    inserted = false
    await refresh()
    return
  }
  // 关闭：未选中技能（Esc/点击外部）→ 主进程把被拦截的消息开头 / 写回 ChatGPT 输入框
  if (!inserted) {
    window.freeCodex.skillPaletteClosed()
  }
  inserted = false
})

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const result = await window.freeCodex.skills.list()
    skills.value = result.skills
  } catch (err) {
    skills.value = []
    toast.error('加载技能失败', { description: err instanceof Error ? err.message : String(err) })
  } finally {
    loading.value = false
  }
}

/** 选中技能：把 /skill:技能名 插入 ChatGPT 输入框（替换触发的 /） */
async function insertSkill(name: string): Promise<void> {
  const result = await window.freeCodex.insertSkillTrigger(name)
  if (!result.ok) {
    toast.error('插入技能失败', { description: result.error })
    return
  }
  inserted = true
  open.value = false
}

let unsubscribe: (() => void) | undefined

onMounted(() => {
  unsubscribe = window.freeCodex.onOpenSkillPalette(() => {
    open.value = true
  })
})

onUnmounted(() => unsubscribe?.())
</script>

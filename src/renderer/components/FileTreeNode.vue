<template>
  <div>
    <div
      class="group flex cursor-pointer select-none items-center gap-1 rounded px-1.5 py-[3px] text-xs"
      :class="isSelected ? 'bg-accent text-accent-foreground' : 'text-foreground/90 hover:bg-accent/50'"
      @click="onClick"
    >
      <span class="flex w-4 shrink-0 justify-center text-muted-foreground/70">
        <ChevronRight
          v-if="node.kind === 'dir'"
          class="size-3 transition-transform duration-100"
          :class="isCollapsed ? '' : 'rotate-90'"
        />
      </span>
      <component
        :is="node.kind === 'dir' ? FolderIcon : FileIcon"
        class="size-3.5 shrink-0"
        :class="node.kind === 'dir' ? 'text-sky-500/90' : 'text-muted-foreground/80'"
      />
      <span class="min-w-0 flex-1 truncate" :title="node.relPath">{{ node.name }}</span>
    </div>
    <template v-if="node.kind === 'dir' && !isCollapsed">
      <div class="ml-[11px] border-l border-border/60 pl-1">
        <FileTreeNode
          v-for="child in node.children"
          :key="child.relPath"
          :node="child"
          :selected="selected"
          :collapsed="collapsed"
          @select="(p: string) => emit('select', p)"
          @toggle="(p: string) => emit('toggle', p)"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight, File as FileIcon, Folder as FolderIcon } from 'lucide-vue-next'

export interface TreeNode {
  name: string
  relPath: string
  kind: 'dir' | 'file'
  children: TreeNode[]
  /** 文件节点对应的原始条目（dir 无） */
  filePath?: string
}

const props = defineProps<{
  node: TreeNode
  selected: string | null
  collapsed: Set<string>
}>()

const emit = defineEmits<{
  (e: 'select', relPath: string): void
  (e: 'toggle', relPath: string): void
}>()

const isSelected = computed(() => props.node.kind === 'file' && props.node.relPath === props.selected)
const isCollapsed = computed(() => props.node.kind === 'dir' && props.collapsed.has(props.node.relPath))

function onClick(): void {
  if (props.node.kind === 'dir') emit('toggle', props.node.relPath)
  else emit('select', props.node.relPath)
}
</script>

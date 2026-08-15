<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="flex h-[90vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[96vw]"
      :show-close-button="false"
      @escape-key-down="onEscapeKeyDown"
      @pointer-down-outside.prevent
      @click="closeCtxMenu"
    >
      <!-- 顶部工具栏 -->
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <span class="flex min-w-0 items-center gap-1.5 font-mono text-xs">
          <FileIcon class="size-4 shrink-0 text-muted-foreground" />
          <span class="truncate" :title="current ? current.relPath : ''">
            {{ current ? current.relPath : '文件预览 / 编辑' }}
          </span>
          <span v-if="dirty" class="size-2 shrink-0 rounded-full bg-amber-400" title="有未保存的改动"></span>
        </span>
        <div class="ml-auto flex shrink-0 items-center gap-1">
          <Badge v-if="readOnly && current" variant="secondary" class="text-[10px]">只读</Badge>
          <Badge v-if="truncated" variant="secondary" class="text-[10px] text-amber-500">已截断</Badge>
          <Button
            variant="outline"
            size="sm"
            class="h-7 gap-1 px-2 text-xs"
            :disabled="!current || kind !== 'text'"
            @click="toggleReadOnly"
          >
            {{ readOnly ? '编辑' : '只读' }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="h-7 gap-1 px-2 text-xs"
            :disabled="!current"
            @click="openExternal"
          >
            <ExternalLink class="size-3.5" />
            系统打开
          </Button>
          <Button
            size="sm"
            class="h-7 gap-1 px-3 text-xs"
            :disabled="!dirty || saving || truncated"
            :title="truncated ? '大文件仅预览，请用系统编辑器修改' : undefined"
            @click="save"
          >
            <Save class="size-3.5" />
            {{ saving ? '保存中…' : '保存' }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="size-7 shrink-0 px-0 text-muted-foreground hover:text-foreground"
            aria-label="关闭"
            title="关闭（Esc）"
            @click="close"
          >
            <X class="size-4" />
          </Button>
        </div>
      </div>

      <div class="flex min-h-0 flex-1">
        <!-- 左侧：文件树 / 全文搜索 -->
        <div class="flex w-80 shrink-0 flex-col border-r border-border bg-muted/20">
          <!-- 模式切换 + 刷新 -->
          <div class="flex items-center gap-1 p-2 pb-1">
            <div class="flex rounded-lg border border-border bg-background p-0.5">
              <button
                class="rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors"
                :class="searchMode === 'name' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'"
                title="按文件名过滤"
                @click="switchMode('name')"
              >
                文件名
              </button>
              <button
                class="rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors"
                :class="searchMode === 'content' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'"
                title="跨项目全文搜索（ripgrep）"
                @click="switchMode('content')"
              >
                内容
              </button>
            </div>
            <Button
              v-if="searchMode === 'name'"
              variant="ghost"
              size="sm"
              class="size-7 shrink-0 px-0 text-muted-foreground"
              aria-label="刷新文件列表"
              title="刷新文件列表"
              :disabled="loading"
              @click="refreshFiles"
            >
              <RefreshCw class="size-3.5" :class="loading ? 'animate-spin' : ''" />
            </Button>
          </div>

          <!-- 文件名过滤输入 -->
          <div v-if="searchMode === 'name'" class="px-2 pb-1.5">
            <Input
              v-model="nameFilter"
              placeholder="按文件名过滤…"
              class="h-7 text-xs"
            />
          </div>

          <!-- 内容搜索输入 + 匹配选项（与文件名过滤独立） -->
          <div v-else class="px-2 pb-1.5">
            <Input
              v-model="searchPattern"
              placeholder="搜索文件内容…"
              class="h-7 text-xs"
            />
            <div class="mt-1 flex items-center gap-1">
              <button
                class="flex size-6 items-center justify-center rounded-md transition-colors"
                :class="searchOptions.caseSensitive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'"
                title="区分大小写"
                @click="toggleSearchOption('caseSensitive')"
              >
                <CaseSensitive class="size-3.5" />
              </button>
              <button
                class="flex size-6 items-center justify-center rounded-md transition-colors"
                :class="searchOptions.regex ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'"
                title="正则匹配"
                @click="toggleSearchOption('regex')"
              >
                <Regex class="size-3.5" />
              </button>
              <button
                class="flex size-6 items-center justify-center rounded-md transition-colors"
                :class="searchOptions.wholeWord ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'"
                title="全词匹配"
                @click="toggleSearchOption('wholeWord')"
              >
                <WholeWord class="size-3.5" />
              </button>
              <span class="mx-0.5 h-3.5 w-px bg-border"></span>
              <button
                class="flex size-6 items-center justify-center rounded-md transition-colors"
                :class="showSearchFilters ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'"
                title="包含 / 排除（限定搜索范围）"
                @click="showSearchFilters = !showSearchFilters"
              >
                <Filter class="size-3.5" />
              </button>
            </div>

            <!-- 包含 / 排除（VS Code 风格，可展开） -->
            <div v-if="showSearchFilters" class="mt-1.5 flex flex-col gap-1">
              <div class="flex items-center gap-1.5">
                <span class="w-8 shrink-0 text-right text-[10px] text-muted-foreground/70">包含</span>
                <Input
                  v-model="searchInclude"
                  placeholder="*.ts, src/**"
                  class="h-6 min-w-0 flex-1 text-[11px]"
                />
              </div>
              <div class="flex items-center gap-1.5">
                <span class="w-8 shrink-0 text-right text-[10px] text-muted-foreground/70">排除</span>
                <Input
                  v-model="searchExclude"
                  placeholder="dist, **/*.min.js"
                  class="h-6 min-w-0 flex-1 text-[11px]"
                />
              </div>
              <p class="text-[10px] leading-relaxed text-muted-foreground/60">
                逗号分隔多个模式；裸目录名自动匹配任意层级（dist ≡ **/dist/**）
              </p>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
            <!-- 文件名模式：过滤 + 目录树 -->
            <template v-if="searchMode === 'name'">
              <p v-if="loading" class="px-2 py-6 text-center text-xs text-muted-foreground">加载中…</p>
              <p v-else-if="noProject" class="px-2 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                尚未选择项目，请在标题栏选择项目文件夹
              </p>
              <p v-else-if="!files.length" class="px-2 py-6 text-center text-xs text-muted-foreground">
                项目中没有文件
              </p>
              <!-- 搜索过滤：扁平列表 -->
              <div v-else-if="filteredEntries" class="flex flex-col">
                <button
                  v-for="f in filteredEntries"
                  :key="f.relPath"
                  class="flex items-center gap-1.5 rounded px-1.5 py-[3px] text-left text-xs"
                  :class="f.relPath === selected ? 'bg-accent text-accent-foreground' : 'text-foreground/90 hover:bg-accent/50'"
                  @click="openFile(f.relPath)"
                >
                  <FileIcon class="size-3.5 shrink-0 text-muted-foreground/80" />
                  <span class="min-w-0 flex-1 truncate" :title="f.relPath">{{ f.relPath }}</span>
                </button>
                <p v-if="!filteredEntries.length" class="px-2 py-4 text-center text-xs text-muted-foreground">
                  没有匹配的文件
                </p>
              </div>
              <!-- 目录树 -->
              <div v-else class="flex flex-col">
                <FileTreeNode
                  v-for="node in tree"
                  :key="node.relPath"
                  :node="node"
                  :selected="selected"
                  :collapsed="collapsedDirs"
                  @select="openFile"
                  @toggle="toggleDir"
                />
              </div>
            </template>

            <!-- 内容模式：搜索结果 -->
            <template v-else>
              <p v-if="!searchPattern.trim()" class="px-2 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                输入关键字搜索文件内容<br />支持正则 / 大小写 / 全词匹配
              </p>
              <p v-else-if="searching" class="flex items-center justify-center gap-1.5 px-2 py-6 text-xs text-muted-foreground">
                <RefreshCw class="size-3 animate-spin" />
                搜索中…
              </p>
              <p v-else-if="searchError" class="px-2 py-6 text-center text-xs text-destructive">{{ searchError }}</p>
              <p v-else-if="searchResults && !searchResults.results.length" class="px-2 py-6 text-center text-xs text-muted-foreground">
                未找到匹配
              </p>
              <template v-else-if="searchResults">
                <p
                  v-if="searchResults.truncated"
                  class="mb-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-500"
                >
                  结果超过 1000 条，已截断
                </p>
                <div v-for="group in groupedResults" :key="group.file" class="mb-2">
                  <div
                    class="sticky top-0 z-10 flex items-center gap-1.5 border-b border-border bg-muted px-1.5 py-1"
                  >
                    <FileIcon class="size-3 shrink-0 text-muted-foreground" />
                    <span class="min-w-0 flex-1 truncate font-mono text-[11px]" :title="group.file">{{ group.file }}</span>
                    <span class="shrink-0 text-[10px] text-muted-foreground/70">{{ group.matches.length }}</span>
                  </div>
                  <button
                    v-for="(m, mi) in group.matches"
                    :key="`${m.line}-${mi}`"
                    class="flex w-full items-start gap-1.5 rounded px-1.5 py-[2px] text-left font-mono text-[11px] leading-relaxed hover:bg-accent/50"
                    :class="m.file === selected && m.line === cursorLine ? 'bg-accent/60' : ''"
                    :title="`${m.file}:${m.line}${m.text ? ' — ' + m.text : ''}`"
                    @click="openSearchResult(m)"
                  >
                    <span class="w-8 shrink-0 select-none text-right text-muted-foreground/60">{{ m.line }}</span>
                    <span class="line-clamp-3 min-w-0 flex-1 break-all whitespace-pre-wrap">
                      <template v-for="(seg, si) in highlightSegments(m.text, m.highlights)" :key="si">
                        <mark
                          v-if="seg.hit"
                          class="rounded-sm bg-amber-300/60 px-0 text-amber-950 dark:bg-amber-400/40 dark:text-amber-100"
                        >{{ seg.text }}</mark>
                        <template v-else>{{ seg.text }}</template>
                      </template>
                    </span>
                  </button>
                </div>
              </template>
            </template>
          </div>
        </div>

        <!-- 右侧：编辑器 / 占位 -->
        <div class="flex min-w-0 flex-1 flex-col">
          <div v-if="!current" class="flex flex-1 flex-col items-center justify-center gap-2">
            <FileSearch class="size-10 text-muted-foreground/30" />
            <p class="text-xs text-muted-foreground">从左侧选择文件进行预览 / 编辑</p>
          </div>
          <div v-else-if="errorMsg" class="flex flex-1 flex-col items-center justify-center gap-2">
            <TriangleAlert class="size-8 text-destructive/60" />
            <p class="max-w-md text-center text-xs text-destructive">{{ errorMsg }}</p>
          </div>
          <div v-else-if="kind === 'binary'" class="flex flex-1 flex-col items-center justify-center gap-2">
            <FileQuestion class="size-8 text-muted-foreground/40" />
            <p class="text-xs text-muted-foreground">暂不支持预览二进制文件</p>
            <Button variant="outline" size="sm" class="mt-1" @click="openExternal">在系统编辑器中打开</Button>
          </div>
          <div v-else class="flex min-h-0 flex-1 flex-col" @contextmenu.prevent="onEditorContextMenu">
            <div
              v-if="truncated"
              class="shrink-0 border-b border-border bg-amber-500/10 px-3 py-1 text-[10px] text-amber-500"
            >
              文件超过 1MB，仅预览前 1MB · 保存已禁用，请用系统编辑器修改
            </div>
            <div ref="editorHost" class="min-h-0 flex-1 overflow-hidden" />
          </div>
        </div>
      </div>

      <!-- 右键菜单：添加到聊天框 -->
      <div
        v-if="ctxMenu"
        class="fixed z-50 min-w-60 rounded-md border border-border bg-popover p-1 shadow-lg"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @contextmenu.prevent
        @click.stop
      >
        <button
          class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
          :disabled="!current"
          @click="ctxInsertFile"
        >
          <FilePlus class="size-3.5 shrink-0" />
          <span class="flex-1">添加文件到聊天框</span>
          <span class="truncate font-mono text-[10px] text-muted-foreground/70" :title="current ? current.relPath : ''">
            {{ current ? current.relPath : '' }}
          </span>
        </button>
        <button
          class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
          :disabled="!ctxMenu.selection"
          @click="ctxInsertSelection"
        >
          <TextSelect class="size-3.5 shrink-0" />
          <span class="flex-1">添加选中到聊天框</span>
          <span v-if="ctxMenu.selection" class="shrink-0 font-mono text-[10px] text-muted-foreground">
            {{ ctxMenu.selection.fromLine === ctxMenu.selection.toLine
              ? `L${ctxMenu.selection.fromLine}`
              : `L${ctxMenu.selection.fromLine}-${ctxMenu.selection.toLine}` }}
          </span>
        </button>
      </div>

      <!-- 底部状态栏 -->
      <div class="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-muted/30 px-3 text-[10px] text-muted-foreground">
        <span class="font-mono">{{ statusText }}</span>
        <span v-if="sizeText" class="font-mono">{{ sizeText }}</span>
        <span class="ml-auto">Ctrl+S 保存 · Ctrl+Z 撤销 · Ctrl+Y / Ctrl+Shift+Z 重做</span>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  CaseSensitive,
  ExternalLink,
  File as FileIcon,
  FilePlus,
  FileQuestion,
  FileSearch,
  Filter,
  RefreshCw,
  Regex,
  Save,
  TextSelect,
  TriangleAlert,
  WholeWord,
  X,
} from 'lucide-vue-next'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import FileTreeNode from './FileTreeNode.vue'
import { createCodeMirror, detectLanguage, type CodeMirrorController } from '@/composables/useCodeMirror'
import type { FileKind, ProjectFileEntry, SearchHighlight, SearchMatch, SearchRunResult, SearchOptions } from '../freecodex'

interface TreeNode {
  name: string
  relPath: string
  kind: 'dir' | 'file'
  children: TreeNode[]
}

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ dark: boolean }>()

const files = ref<ProjectFileEntry[]>([])
const loading = ref(false)
const noProject = ref(false)
/** 文件名过滤（与内容搜索独立） */
const nameFilter = ref('')
/** 内容搜索关键字 */
const searchPattern = ref('')
const selected = ref<string | null>(null)
const collapsedDirs = ref<Set<string>>(new Set())

const current = ref<ProjectFileEntry | null>(null)
const kind = ref<FileKind | null>(null)
const errorMsg = ref('')
const truncated = ref(false)
const eol = ref('\n')
const mtimeMs = ref(0)
const fileSize = ref(0)
const lastSavedContent = ref('')
const dirty = ref(false)
const saving = ref(false)
const readOnly = ref(false)
const cursor = ref({ line: 1, col: 1 })

const editorHost = ref<HTMLElement | null>(null)
let cm: CodeMirrorController | null = null

// ---------- 搜索状态（文件名过滤 / 全文内容搜索）----------
const searchMode = ref<'name' | 'content'>('name')
const searchOptions = ref<SearchOptions>({ caseSensitive: false, regex: false, wholeWord: false })
const searchResults = ref<SearchRunResult | null>(null)
const searching = ref(false)
const searchError = ref('')
/** 最近一次跳转的行（结果行高亮） */
const cursorLine = ref(0)
/** include/exclude 过滤面板（VS Code 风格，可展开收起） */
const showSearchFilters = ref(false)
const searchInclude = ref('')
const searchExclude = ref('')
let searchSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined

/** glob 元字符（裸目录名不含这些字符时自动补成任意层级） */
const GLOB_META = /[*?{\[]/

/** 把逗号分隔的 include/exclude 输入解析为 glob 列表；裸目录名自动补成任意层级（dist → dist 目录及其子级） */
function parseGlobList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => (GLOB_META.test(token) ? token : `**/${token}/**`))
}

const sizeText = computed(() => {
  const s = fileSize.value
  if (!s) return ''
  if (s < 1024) return `${s} B`
  if (s < 1024 * 1024) return `${(s / 1024).toFixed(1)} KB`
  return `${(s / (1024 * 1024)).toFixed(1)} MB`
})

const statusText = computed(() => {
  if (!current.value) return ''
  const parts: string[] = [`${cursor.value.line}:${cursor.value.col}`]
  if (readOnly.value) parts.push('只读')
  if (dirty.value) parts.push('未保存')
  return parts.join(' · ')
})

// ---------- 文件树 ----------
const filteredEntries = computed(() => {
  const q = nameFilter.value.trim().toLowerCase()
  if (!q) return null
  return files.value.filter((f) => f.relPath.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
})

const tree = computed<TreeNode[]>(() => {
  const root: TreeNode[] = []
  const dirs = new Map<string, TreeNode>()
  for (const f of files.value) {
    const parts = f.relPath.split('/')
    let current: TreeNode[] = root
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      if (i === parts.length - 1) {
        current.push({ name: parts[i], relPath: acc, kind: 'file', children: [] })
      } else {
        let node = dirs.get(acc)
        if (!node) {
          node = { name: parts[i], relPath: acc, kind: 'dir', children: [] }
          dirs.set(acc, node)
          current.push(node)
        }
        current = node.children
      }
    }
  }
  const sortNodes = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) if (n.kind === 'dir') sortNodes(n.children)
  }
  sortNodes(root)
  return root
})

function toggleDir(relPath: string): void {
  const s = collapsedDirs.value
  if (s.has(relPath)) s.delete(relPath)
  else s.add(relPath)
}

// ---------- 全文搜索（内容模式）----------
/** 按文件分组的搜索结果（保持首次出现顺序） */
const groupedResults = computed(() => {
  const groups: { file: string; matches: SearchMatch[] }[] = []
  const index = new Map<string, { file: string; matches: SearchMatch[] }>()
  for (const m of searchResults.value?.results ?? []) {
    let g = index.get(m.file)
    if (!g) {
      g = { file: m.file, matches: [] }
      index.set(m.file, g)
      groups.push(g)
    }
    g.matches.push(m)
  }
  return groups
})

interface HighlightSegment {
  text: string
  hit: boolean
}

/** 把行文本按匹配区间切成高亮片段（合并重叠区间） */
function highlightSegments(text: string, highlights: SearchHighlight[]): HighlightSegment[] {
  if (!highlights.length) return [{ text, hit: false }]
  const ranges = [...highlights].sort((a, b) => a.start - b.start)
  const merged: SearchHighlight[] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else merged.push({ ...r })
  }
  const segs: HighlightSegment[] = []
  let pos = 0
  for (const r of merged) {
    if (r.start > pos) segs.push({ text: text.slice(pos, r.start), hit: false })
    if (r.end > r.start) segs.push({ text: text.slice(r.start, r.end), hit: true })
    pos = r.end
  }
  if (pos < text.length) segs.push({ text: text.slice(pos), hit: false })
  return segs
}

function switchMode(mode: 'name' | 'content'): void {
  if (mode === searchMode.value) return
  searchMode.value = mode
  if (mode === 'name') {
    // 切回文件名模式：取消进行中的搜索并清空结果
    searchSeq++
    if (searchTimer) clearTimeout(searchTimer)
    searching.value = false
    searchResults.value = null
    searchError.value = ''
    cursorLine.value = 0
    void window.freeCodex.search.cancel()
  }
}

function toggleSearchOption(key: keyof SearchOptions): void {
  searchOptions.value = { ...searchOptions.value, [key]: !searchOptions.value[key] }
}

/** 内容搜索：防抖 250ms + 序号防串 + 先取消上一次（与文件名过滤的 nameFilter 完全独立） */
watch([searchMode, searchPattern, searchOptions, searchInclude, searchExclude], () => {
  if (searchTimer) clearTimeout(searchTimer)
  if (searchMode.value !== 'content') return
  const seq = ++searchSeq
  const pattern = searchPattern.value.trim()
  if (!pattern) {
    searching.value = false
    searchResults.value = null
    searchError.value = ''
    return
  }
  searching.value = true
  searchError.value = ''
  searchTimer = setTimeout(async () => {
    try {
      await window.freeCodex.search.cancel()
      const res = await window.freeCodex.search.run({
        pattern,
        options: {
          ...searchOptions.value,
          include: parseGlobList(searchInclude.value),
          exclude: parseGlobList(searchExclude.value),
        },
      })
      if (seq !== searchSeq) return
      searching.value = false
      if (!res.ok) {
        searchError.value = res.error ?? '搜索失败'
        searchResults.value = null
      } else {
        searchResults.value = res
      }
    } catch (err) {
      if (seq !== searchSeq) return
      searching.value = false
      searchError.value = err instanceof Error ? err.message : String(err)
    }
  }, 250)
})

/** 点击搜索结果：打开文件、高亮匹配文本并滚动到匹配行 */
async function openSearchResult(m: SearchMatch): Promise<void> {
  await openFile(m.file)
  await nextTick()
  if (current.value?.relPath === m.file && cm) {
    if (m.highlights.length > 0) cm.highlightMatch(m.line, m.highlights.map((h) => ({ from: h.start, to: h.end })))
    else cm.gotoLine(m.line)
    cursorLine.value = m.line
  }
}

// ---------- 右键菜单（添加到聊天框）----------
interface CtxMenuState {
  x: number
  y: number
  /** 右键时编辑器选区（无选区为 null） */
  selection: { fromLine: number; toLine: number } | null
}
const ctxMenu = ref<CtxMenuState | null>(null)

function closeCtxMenu(): void {
  ctxMenu.value = null
}

function onEditorContextMenu(e: MouseEvent): void {
  if (!current.value || kind.value !== 'text') return
  const sel = cm?.getSelectionRange() ?? null
  ctxMenu.value = {
    x: e.clientX,
    y: e.clientY,
    selection: sel ? { fromLine: sel.fromLine, toLine: sel.toLine } : null,
  }
}

/** 插入文本到 ChatGPT 输入框；成功后关闭工作区让输入框可见（有未保存改动会先确认） */
async function insertToChat(text: string): Promise<void> {
  try {
    const result = await window.freeCodex.insertToChat(text)
    if (!result.ok) {
      toast.error('插入聊天框失败', { description: result.error ?? '未知错误' })
      return
    }
    toast.success('已插入聊天框')
    close()
  } catch (err) {
    toast.error('插入聊天框失败', { description: err instanceof Error ? err.message : String(err) })
  }
}

function ctxInsertFile(): void {
  closeCtxMenu()
  if (!current.value) return
  void insertToChat(`@file:${current.value.relPath}`)
}

function ctxInsertSelection(): void {
  const sel = ctxMenu.value?.selection
  closeCtxMenu()
  if (!current.value || !sel) return
  const range = sel.fromLine === sel.toLine ? `lines:${sel.fromLine}` : `lines:${sel.fromLine}-${sel.toLine}`
  void insertToChat(`@file:${current.value.relPath} ${range}`)
}

// ---------- 打开 / 保存 ----------
function ensureEditor(): void {
  if (!editorHost.value || cm) return
  cm = createCodeMirror(editorHost.value, {
    dark: props.dark,
    onSave: () => void save(),
    onDocChange: () => {
      if (cm) dirty.value = cm.getContent() !== lastSavedContent.value
    },
    onCursorChange: (pos) => {
      cursor.value = pos
    },
  })
}

async function openFile(relPath: string): Promise<void> {
  closeCtxMenu()
  if (dirty.value && current.value && current.value.relPath !== relPath) {
    if (!confirm(`「${current.value.relPath}」有未保存的改动，放弃并打开其他文件？`)) return
  }
  selected.value = relPath
  const entry = files.value.find((f) => f.relPath === relPath) ?? null
  current.value = entry
  kind.value = null
  errorMsg.value = ''
  truncated.value = false
  dirty.value = false
  lastSavedContent.value = ''
  readOnly.value = false
  cursor.value = { line: 1, col: 1 }
  cursorLine.value = 0

  const result = await window.freeCodex.readFile(relPath)
  if (!result.ok) {
    errorMsg.value = result.error ?? '读取失败'
    toast.error('读取文件失败', { description: result.error })
    return
  }
  kind.value = result.kind ?? 'text'
  fileSize.value = result.size ?? 0
  mtimeMs.value = result.mtimeMs ?? 0
  eol.value = result.eol ?? '\n'
  truncated.value = !!result.truncated

  if (result.kind === 'text') {
    const content = result.content ?? ''
    await nextTick()
    ensureEditor()
    if (cm) {
      cm.setLanguage(detectLanguage(entry?.name ?? relPath))
      cm.setContent(content)
      cm.setReadOnly(false)
      lastSavedContent.value = content
      dirty.value = false
      cm.focus()
    }
  }
}

async function save(): Promise<void> {
  if (!current.value || !cm || !dirty.value || saving.value || truncated.value) return
  saving.value = true
  try {
    const content = cm.getContent()
    const write = (expect: number | undefined) =>
      window.freeCodex.writeFile({
        relPath: current.value!.relPath,
        content,
        eol: eol.value,
        expectMtimeMs: expect,
      })
    let result = await write(mtimeMs.value)
    if (!result.ok && result.conflict) {
      if (!confirm('文件已在磁盘上被外部修改，确定覆盖？')) return
      result = await write(undefined)
    }
    if (!result.ok) {
      toast.error('保存失败', { description: result.error ?? '未知错误' })
      return
    }
    lastSavedContent.value = content
    dirty.value = false
    // 保存后 mtime 已变：重读刷新 mtimeMs / eol，避免下次保存误报冲突
    const fresh = await window.freeCodex.readFile(current.value.relPath)
    if (fresh.ok) {
      mtimeMs.value = fresh.mtimeMs ?? 0
      eol.value = fresh.eol ?? '\n'
    }
    toast.success('已保存')
  } catch (err) {
    toast.error('保存失败', { description: err instanceof Error ? err.message : String(err) })
  } finally {
    saving.value = false
  }
}

function toggleReadOnly(): void {
  readOnly.value = !readOnly.value
  cm?.setReadOnly(readOnly.value)
}

async function openExternal(): Promise<void> {
  if (!current.value) return
  const result = await window.freeCodex.openFileExternally(current.value.relPath)
  if (!result.ok) toast.error('打开失败', { description: result.error })
}

function onEscapeKeyDown(event: { preventDefault: () => void }): void {
  event.preventDefault()
  if (ctxMenu.value) {
    closeCtxMenu()
    return
  }
  close()
}

function close(): void {
  if (dirty.value && !confirm('有未保存的改动，确定关闭？改动将丢失。')) return
  open.value = false
}

// ---------- 生命周期 ----------
/** 收集文件清单里的全部目录路径（默认全部折叠用） */
function collectDirPaths(entries: ProjectFileEntry[]): string[] {
  const dirs = new Set<string>()
  for (const f of entries) {
    const parts = f.relPath.split('/')
    let acc = ''
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      dirs.add(acc)
    }
  }
  return [...dirs]
}

async function refreshFiles(): Promise<void> {
  loading.value = true
  try {
    const result = await window.freeCodex.listProjectFiles()
    files.value = result.files
    noProject.value = result.noProject
    // 目录默认全部收起，只展开根级文件；用户手动展开的折叠状态在下次刷新时重置
    collapsedDirs.value = new Set(collectDirPaths(result.files))
  } catch (err) {
    files.value = []
    noProject.value = false
    toast.error('加载文件失败', { description: err instanceof Error ? err.message : String(err) })
  } finally {
    loading.value = false
  }
}

watch(open, async (opened) => {
  if (opened) {
    await refreshFiles()
    await nextTick()
    ensureEditor()
    if (selected.value) {
      const still = files.value.find((f) => f.relPath === selected.value)
      if (still) await openFile(still.relPath)
    }
  } else {
    closeCtxMenu()
    cm?.destroy()
    cm = null
    current.value = null
    kind.value = null
    errorMsg.value = ''
    dirty.value = false
    lastSavedContent.value = ''
    // 关闭工作区：取消进行中的搜索并复位搜索状态
    searchSeq++
    if (searchTimer) clearTimeout(searchTimer)
    searching.value = false
    searchResults.value = null
    searchError.value = ''
    cursorLine.value = 0
    void window.freeCodex.search.cancel()
  }
})

watch(
  () => props.dark,
  (dark) => cm?.setDark(dark),
)

// 编辑器容器挂载/卸载：
// - 挂载时若尚无实例则创建并回填内容（v-else 分支晚于 openFile 挂载的场景）
// - 卸载（切到二进制/错误占位/关闭对话框）时销毁实例——否则残留的已分离 CodeMirror
//   会让下次打开文本文件时空白（setContent 打到了脱离 DOM 的旧实例上）
watch(
  editorHost,
  (el) => {
    if (el && !cm) {
      ensureEditor()
      backfillEditor()
    } else if (!el && cm) {
      cm.destroy()
      cm = null
    }
  },
  { flush: 'post' },
)

/** 编辑器容器晚于 openFile 挂载时，把已读到的文件内容回填进编辑器 */
function backfillEditor(): void {
  if (!cm || !current.value || kind.value !== 'text' || lastSavedContent.value === '') return
  cm.setLanguage(detectLanguage(current.value.name))
  cm.setContent(lastSavedContent.value)
  cm.setReadOnly(readOnly.value)
}
</script>

<style scoped>
:deep(.cm-editor) {
  height: 100%;
  font-size: 12.5px;
}
:deep(.cm-editor.cm-focused) {
  outline: none;
}
:deep(.cm-scroller) {
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Courier New', monospace;
  line-height: 1.6;
}
/* 搜索结果跳转高亮（与结果列表的琥珀色一致） */
:deep(.cm-search-hit) {
  background: rgba(251, 191, 36, 0.35);
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.25);
}
</style>

<template>
  <aside
    class="flex shrink-0 flex-col border-l border-border bg-sidebar transition-[width] duration-200"
    :class="collapsed ? 'w-10' : 'w-[348px]'"
  >
    <!-- 收起态 -->
    <template v-if="collapsed">
      <button
        class="flex h-9 items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        aria-label="展开工具面板"
        @click="toggleCollapsed(false)"
      >
        <PanelRightOpenIcon class="size-4" />
      </button>
      <div class="flex flex-1 items-center justify-center">
        <span class="size-1.5 rounded-full bg-muted-foreground/30"></span>
      </div>
    </template>

    <!-- 展开态 -->
    <template v-else>
      <div class="flex min-h-0 flex-1">
        <!-- 内容区（左侧） -->
        <div class="flex min-w-0 flex-1 flex-col">
          <div class="flex h-9 shrink-0 items-center justify-between border-b border-border px-2">
            <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{{ activeNavLabel }}</span>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto">
        <!-- Tools -->
        <div v-show="activeTab === 'tools'" class="flex flex-col gap-1.5 p-2">
          <!-- 视图切换：调用记录（当前会话）/ 全部可用工具 -->
          <div class="flex items-center justify-between px-1 py-1">
            <div class="flex rounded-lg border border-border bg-background p-0.5">
              <button
                class="rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
                :class="toolsView === 'calls' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'"
                @click="toolsView = 'calls'"
              >
                调用记录
              </button>
              <button
                class="rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
                :class="toolsView === 'all' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'"
                @click="toolsView = 'all'"
              >
                全部工具
              </button>
            </div>
            <Badge variant="secondary" class="text-[10px]">{{ toolsView === 'calls' ? currentCalls.length : tools.length }}</Badge>
          </div>

          <!-- 调用记录：当前会话调用的工具（区分其他会话） -->
          <template v-if="toolsView === 'calls'">
            <div class="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5">
              <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">当前会话</span>
              <Badge variant="secondary" class="max-w-32 truncate font-mono text-[10px]" :title="toolCalls.currentConvId ?? undefined">
                {{ convLabel }}
              </Badge>
              <span class="ml-auto text-[10px] text-muted-foreground/70">{{ currentTools.length }} 工具 · {{ currentCalls.length }} 次</span>
            </div>

            <div v-if="!currentCalls.length" class="flex flex-col items-center gap-2 py-8 text-center">
              <span class="text-2xl">🔧</span>
              <p class="text-sm text-muted-foreground">当前会话尚未调用工具</p>
              <p class="max-w-48 text-xs text-muted-foreground/70">
                本会话通过引擎执行 read / write / bash 等工具后，这里实时显示调用记录。
              </p>
            </div>

            <div
              v-for="c in currentCalls"
              :key="c.id"
              class="rounded-lg border border-border bg-background p-2.5"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="min-w-0 truncate font-mono text-xs text-primary" :title="c.tool">{{ c.tool }}</span>
                <span class="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                  <span class="size-1.5 rounded-full" :class="statusDotClass(c.status)"></span>
                  <span v-if="c.durationMs != null">{{ c.durationMs }}ms</span>
                </span>
              </div>
              <div class="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/60">
                <span>{{ fmtTime(c.at) }}</span>
                <span v-if="c.status === 'error'" class="text-red-500">失败</span>
                <span v-else-if="c.status === 'pending'" class="text-sky-500">运行中</span>
                <span v-else class="text-emerald-500">成功</span>
              </div>
              <!-- 输入 / 输出：默认折叠 -->
              <details v-if="c.args || c.result != null" class="mt-1.5 group">
                <summary class="flex cursor-pointer select-none items-center gap-1 rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-[10px] text-muted-foreground transition hover:bg-muted/50 hover:text-foreground">
                  <span class="transition-transform group-open:rotate-90">▶</span>
                  <span>输入 / 输出</span>
                </summary>
                <div class="mt-1 space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-1.5">
                  <div v-if="c.args">
                    <div class="mb-0.5 text-[10px] font-medium text-muted-foreground">输入</div>
                    <pre class="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background/80 p-1.5 font-mono text-[10px] leading-relaxed text-foreground/90">{{ formatJson(c.args) }}</pre>
                  </div>
                  <div v-if="c.result != null">
                    <div class="mb-0.5 text-[10px] font-medium text-muted-foreground">{{ c.status === 'error' ? '错误' : '输出' }}</div>
                    <pre class="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-background/80 p-1.5 font-mono text-[10px] leading-relaxed" :class="c.status === 'error' ? 'text-red-500' : 'text-foreground/90'">{{ formatJson(c.result) }}</pre>
                  </div>
                </div>
              </details>
            </div>

            <!-- 其他会话（与当前对话区分） -->
            <template v-if="otherRows.length">
              <div class="mt-1 flex items-center gap-2 px-1 pt-2">
                <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">其他会话</span>
                <Badge variant="secondary" class="text-[10px]">{{ otherRows.length }}</Badge>
              </div>
              <div class="rounded-lg border border-border/70 bg-background/60">
                <div
                  v-for="(row, i) in otherRows"
                  :key="i"
                  class="flex items-center gap-1.5 border-b border-border/50 px-2 py-1.5 text-[10px] last:border-b-0"
                >
                  <span class="min-w-0 flex-1 truncate font-mono text-foreground/80" :title="row.tool">{{ row.tool }}</span>
                  <span class="shrink-0 text-muted-foreground/60">{{ shortId(row.sessionId) }}</span>
                  <span class="shrink-0 text-muted-foreground/40">{{ shortId(row.convId) }}</span>
                  <time class="shrink-0 text-muted-foreground/50">{{ fmtTime(row.at) }}</time>
                </div>
              </div>
            </template>
          </template>

          <!-- 全部工具：可用工具静态列表 -->
          <template v-else>
            <div class="flex items-center justify-between px-1 py-1">
              <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                可用工具
              </span>
              <Badge variant="secondary" class="text-[10px]">{{ tools.length }}</Badge>
            </div>

            <div v-if="!tools.length" class="flex flex-col items-center gap-2 py-10 text-center">
              <span class="text-2xl">🔧</span>
              <p class="text-sm text-muted-foreground">等待 MCP 工具</p>
              <p class="max-w-48 text-xs text-muted-foreground/70">
                工具来自 Free Codex 配置的下游 MCP，可在设置页管理。
              </p>
            </div>

            <div
              v-for="tool in tools"
              :key="`${tool.server}:${tool.name}`"
              class="rounded-lg border border-border bg-background p-2.5"
            >
              <div class="font-mono text-xs text-primary">{{ tool.name }}</div>
              <div class="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                {{ tool.description || 'MCP tool' }}
              </div>
              <div class="mt-1 text-[10px] text-muted-foreground/60">{{ tool.server === 'codex-mcp' ? '内置引擎' : tool.server }}</div>
            </div>
          </template>
        </div>

        <!-- Diff -->
        <div v-show="activeTab === 'diffs'" class="flex flex-col gap-1.5 p-2">
          <div class="flex items-center justify-between px-1 py-1">
            <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              文件变更
            </span>
            <Badge variant="secondary" class="text-[10px]">{{ diffs.length }}</Badge>
          </div>

          <div v-if="!diffs.length" class="flex flex-col items-center gap-2 py-10 text-center">
            <span class="text-2xl">📝</span>
            <p class="text-sm text-muted-foreground">暂无 diff</p>
            <p class="max-w-48 text-xs text-muted-foreground/70">
              ChatGPT 通过引擎执行 edit / write / apply_patch 修改文件后，这里实时显示变更。
            </p>
          </div>

          <div
            v-for="d in diffs"
            :key="d.id"
            class="rounded-lg border border-border bg-background p-2"
          >
            <div class="flex items-center justify-between gap-2">
              <button class="min-w-0 flex-1 text-left" title="查看 diff" @click="openDiff(d)">
                <div class="truncate font-mono text-xs">{{ d.path }}</div>
                <div class="mt-0.5 text-[10px] text-muted-foreground">
                  {{ d.toolName }}
                  <span class="text-emerald-500">+{{ d.additions }}</span>
                  <span class="text-red-500">-{{ d.deletions }}</span>
                </div>
              </button>
              <div class="flex shrink-0 items-center gap-0.5">
                <button
                  class="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  title="撤回此文件"
                  @click="revertDiff(d)"
                >
                  <Undo2Icon class="size-3.5" />
                </button>
                <button
                  class="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  title="确认变更"
                  @click="confirmDiff(d)"
                >
                  <CheckIcon class="size-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Injection（注入内容）：新会话首条请求注入的上下文块开关 -->
        <div v-show="activeTab === 'injection'" class="flex flex-col gap-1.5 p-2">
          <div class="flex items-center justify-between px-1 py-1">
            <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">注入内容</span>
            <Badge variant="secondary" class="text-[10px]">Injection</Badge>
          </div>

          <!-- 基础开关 -->
          <div class="rounded-lg border border-border bg-background">
            <div
              v-for="row in baseRows"
              :key="row.key"
              class="flex items-center justify-between gap-2 border-b border-border/60 px-2.5 py-2 last:border-b-0"
            >
              <div class="min-w-0">
                <div class="text-xs font-medium">{{ row.label }}</div>
                <div v-if="row.hint" class="mt-0.5 text-[10px] text-muted-foreground/70">{{ row.hint }}</div>
              </div>
              <Switch :checked="row.get()" @update:checked="(v: boolean) => row.set(v)" />
            </div>
          </div>

          <!-- 自动激活插件 -->
          <div class="rounded-lg border border-border bg-background px-2.5 py-2">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="text-xs font-medium">自动激活插件</div>
                <div class="mt-0.5 text-[10px] text-muted-foreground/70">新对话自动在 + 菜单选中 mycodex，让模型可调用其工具</div>
              </div>
              <Switch :checked="injections.autoSelectPlugin" @update:checked="(v: boolean) => saveInjection({ autoSelectPlugin: v })" />
            </div>
          </div>

          <!-- Skills 分组：每个技能一个开关 -->
          <div class="mt-1 flex items-center justify-between px-1 pt-1">
            <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Skills</span>
            <Badge variant="secondary" class="text-[10px]">{{ skillRows.length }}</Badge>
          </div>
          <div v-if="!skillRows.length" class="flex flex-col items-center gap-2 py-6 text-center">
            <span class="text-xl">🧩</span>
            <p class="text-xs text-muted-foreground">暂无技能</p>
          </div>
          <div v-else class="rounded-lg border border-border bg-background">
            <div
              v-for="s in skillRows"
              :key="s.name"
              class="flex items-center justify-between gap-2 border-b border-border/60 px-2.5 py-2 last:border-b-0"
            >
              <div class="min-w-0">
                <div class="truncate text-xs font-medium">{{ s.name }}</div>
                <div class="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground/70" :title="s.description">
                  {{ s.description || (s.scope === 'project' ? '项目级技能' : '用户级技能') }}
                </div>
              </div>
              <Switch :checked="s.on" @update:checked="(v: boolean) => toggleSkill(s.name, v)" />
            </div>
          </div>
        </div>

        <!-- Clean（会话清理）：临时清理当前会话 DOM + 真实删除聊天记录 -->
        <div v-show="activeTab === 'clean'" class="flex flex-col gap-1.5 p-2">
          <div class="flex items-center justify-between px-1 py-1">
            <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">会话清理</span>
            <Badge variant="secondary" class="text-[10px]">Clean</Badge>
          </div>

          <!-- 临时清理（当前会话，防卡顿） -->
          <div class="rounded-lg border border-border bg-background px-2.5 py-2">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="text-xs font-medium">临时清理当前会话</div>
                <div class="mt-0.5 text-[10px] text-muted-foreground/70">删除聊天记录 DOM（仅当前页），保留最新 N 条，防卡顿</div>
              </div>
              <Switch :checked="cleanup.autoTrim" @update:checked="(v: boolean) => saveCleanup({ autoTrim: v })" />
            </div>
            <div class="mt-2 flex items-center gap-2">
              <Input
                v-model="trimKeepInput"
                type="number"
                min="1"
                max="100"
                class="h-7 w-20 text-xs"
                @change="saveCleanup({ trimKeep: Number(trimKeepInput) || 3 })"
              />
              <span class="text-[10px] text-muted-foreground/70">保留条数（自动清理开启后生效）</span>
              <Button variant="outline" size="sm" class="ml-auto" :disabled="trimBusy" @click="doTrim">
                {{ trimBusy ? '清理中…' : '立即清理' }}
              </Button>
            </div>
            <p v-if="trimResult" class="mt-1.5 text-[10px] text-muted-foreground/70">
              已移除 {{ trimResult.removed }} 条（共 {{ trimResult.total }} 条，保留 {{ cleanup.trimKeep }}）
            </p>
          </div>

          <!-- 真实删除聊天记录 -->
          <div class="mt-1 rounded-lg border border-border bg-background px-2.5 py-2">
            <div class="min-w-0">
              <div class="text-xs font-medium">真实删除聊天记录</div>
              <div class="mt-0.5 text-[10px] text-muted-foreground/70">从 ChatGPT 服务端删除对话（不可恢复）</div>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <Button variant="outline" size="sm" :disabled="listBusy" @click="loadConversations">加载</Button>
              <Button
                variant="outline"
                size="sm"
                class="text-destructive"
                :disabled="listBusy || !selectedIds.size"
                @click="deleteSelected"
              >删除选中({{ selectedIds.size }})</Button>
              <Button
                variant="outline"
                size="sm"
                class="text-destructive"
                :disabled="listBusy || !conversations.length"
                @click="deleteAllConvs"
              >删除全部</Button>
            </div>
            <div v-if="!conversations.length" class="py-4 text-center text-[11px] text-muted-foreground/70">
              点击「加载」列出最近对话
            </div>
            <template v-else>
              <div class="mt-2 flex items-center gap-2 border-b border-border/60 pb-1.5">
                <label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                  <input type="checkbox" class="size-3.5 accent-primary" :checked="allSelected" @change="toggleSelectAll" />
                  全选
                </label>
                <span class="text-[10px] text-muted-foreground/60">已选 {{ selectedIds.size }} / {{ conversations.length }}</span>
              </div>
              <div class="mt-1.5 flex max-h-56 flex-col gap-1 overflow-y-auto">
                <div
                  v-for="c in conversations"
                  :key="c.id"
                  class="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5"
                  :class="selectedIds.has(c.id) ? 'border-primary/50 bg-accent/40' : ''"
                >
                  <input
                    type="checkbox"
                    class="size-3.5 shrink-0 accent-primary"
                    :checked="selectedIds.has(c.id)"
                    @change="toggleSelect(c.id)"
                  />
                  <div class="min-w-0 flex-1 cursor-pointer" @click="toggleSelect(c.id)">
                    <div class="truncate text-[11px] font-medium">{{ c.title || '（无标题）' }}</div>
                    <div class="text-[10px] text-muted-foreground/60">{{ fmtConvTime(c.updateTime) }}</div>
                  </div>
                  <button
                    class="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-40"
                    :title="`删除「${c.title || '无标题'}」`"
                    :disabled="deletingIds.has(c.id)"
                    @click="deleteConv(c)"
                  >
                    <span v-if="deletingIds.has(c.id)" class="size-3.5 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-transparent" />
                    <Trash2Icon v-else class="size-3.5" />
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Todos（进程内下游 server + 每轮注入快照 + 未更新提醒） -->
        <div v-show="activeTab === 'todos'" class="flex flex-col gap-1.5 p-2">
          <div class="flex items-center justify-between px-1 py-1">
            <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Todos</span>
            <Badge variant="secondary" class="text-[10px]">{{ todos.enabled ? '已开启' : '已关闭' }}</Badge>
          </div>

          <!-- 当前对话清单 -->
          <div class="flex items-center justify-between px-1 pt-1">
            <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">当前对话</span>
            <Badge variant="secondary" class="max-w-32 truncate font-mono text-[10px]" :title="todos.convId ?? undefined">
              {{ todos.convId ? shortId(todos.convId) : '新会话' }}
            </Badge>
          </div>

          <div v-if="!todos.enabled" class="flex flex-col items-center gap-2 py-8 text-center">
            <span class="text-2xl">✅</span>
            <p class="text-sm text-muted-foreground">todos 未开启</p>
            <p class="max-w-48 text-xs text-muted-foreground/70">请在 设置 → MCP 服务器 中开启 todos（系统 MCP），开启后 ChatGPT 每轮收到清单快照</p>
          </div>

          <template v-else-if="todos.list">
            <div class="rounded-lg border border-border bg-background p-2">
              <div v-if="todos.list.objective" class="mb-1.5 text-xs font-medium text-foreground/90">{{ todos.list.objective }}</div>
              <div class="flex items-center justify-between gap-2 text-[10px] text-muted-foreground/60">
                <span class="flex items-center gap-1">
                  <span class="size-1.5 rounded-full" :class="listStatusDotClass"></span>
                  {{ listStatusLabel }}
                  <span v-if="todosStale" class="flex items-center gap-1 rounded bg-red-500/10 px-1 py-px text-red-500">
                    <span class="size-1.5 animate-pulse rounded-full bg-red-500"></span>
                    ⚠️ 未更新 {{ todosStaleAgo }}
                  </span>
                </span>
                <span>上次更新 {{ fmtTime(todos.list.updatedAt) }}</span>
              </div>
            </div>

            <div v-if="!todos.list.items.length" class="flex flex-col items-center gap-2 py-6 text-center">
              <span class="text-xl">📋</span>
              <p class="text-xs text-muted-foreground">清单为空，让 ChatGPT 先调用 todos_create 建立任务</p>
            </div>
            <div v-else class="flex flex-col gap-1">
              <label
                v-for="item in todos.list.items"
                :key="item.id"
                class="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-background px-2.5 py-2"
                :class="item.status === 'done' ? 'opacity-60' : ''"
              >
                <input
                  type="checkbox"
                  class="mt-0.5 size-3.5 shrink-0 accent-primary"
                  :checked="item.status === 'done'"
                  :disabled="todos.list.status !== 'active'"
                  @change="toggleTodoItem(item)"
                />
                <div class="min-w-0 flex-1">
                  <div class="text-xs" :class="item.status === 'done' ? 'line-through text-muted-foreground' : ''">{{ item.title }}</div>
                  <div v-if="item.details" class="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground/70" :title="item.details">{{ item.details }}</div>
                  <div v-if="item.note" class="mt-0.5 text-[10px] text-amber-600/80"># {{ item.note }}</div>
                </div>
                <span v-if="item.status === 'in_progress'" class="shrink-0 text-[10px] text-sky-500">进行中</span>
              </label>
            </div>

            <Button
              variant="outline"
              size="sm"
              class="mt-1"
              :disabled="!todos.list || todos.list.status !== 'active'"
              @click="resetTodos"
            >
              清空清单
            </Button>
          </template>

          <div v-else class="flex flex-col items-center gap-2 py-8 text-center">
            <span class="text-2xl">📋</span>
            <p class="text-sm text-muted-foreground">尚未创建清单</p>
            <p class="max-w-48 text-xs text-muted-foreground/70">让 ChatGPT 处理多步任务时先调用 todos_create</p>
          </div>
        </div>

        <!-- Logs -->
        <div v-show="activeTab === 'logs'" class="flex flex-col p-2">
          <div class="flex items-center justify-between px-1 py-1">
            <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              实时日志
            </span>
            <Badge variant="secondary" class="text-[10px]">{{ logs.length }}</Badge>
          </div>
          <div v-if="!logs.length" class="flex flex-col items-center gap-2 py-10 text-center">
            <span class="text-2xl">📡</span>
            <p class="text-sm text-muted-foreground">暂无日志</p>
          </div>
          <div
            v-for="(item, i) in logs"
            :key="i"
            class="flex gap-2 border-b border-border/60 py-1.5 text-[10px] leading-relaxed"
          >
            <time class="shrink-0 text-muted-foreground/60">{{ item.time }}</time>
            <span :class="item.level === 'error' ? 'break-all text-destructive' : 'break-all text-foreground/80'">
              {{ item.text }}
            </span>
          </div>
        </div>
        </div>
        </div>

        <!-- 右侧：垂直 icon 导航菜单（分组） -->
        <nav class="flex w-10 shrink-0 flex-col items-center gap-1 border-l border-border py-1.5">
          <TooltipProvider :delay-duration="200">
            <template v-for="(group, gi) in navGroups" :key="gi">
              <Separator v-if="gi > 0" class="my-0.5 w-5" />
              <Tooltip v-for="item in group" :key="item.key">
                <TooltipTrigger as-child>
                  <button
                    class="flex size-8 items-center justify-center rounded-md transition-colors"
                    :class="activeTab === item.key
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'"
                    :aria-label="item.label"
                    :aria-current="activeTab === item.key ? 'page' : undefined"
                    @click="activeTab = item.key"
                  >
                    <component :is="item.icon" class="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">{{ item.label }}</TooltipContent>
              </Tooltip>
            </template>

            <div class="flex-1"></div>
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  class="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label="收起工具面板"
                  @click="toggleCollapsed(true)"
                >
                  <PanelRightCloseIcon class="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">收起</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </nav>
      </div>
    </template>

    <!-- Diff 详情在 overlay 子窗口打开（浮在 ChatGPT 原生视图之上） -->
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  CheckIcon,
  FileDiffIcon,
  ListTodoIcon,
  SyringeIcon,
  Trash2Icon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  ScrollTextIcon,
  Undo2Icon,
  WrenchIcon,
} from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { ChatCleanupSettings, ConversationEntry, FileDiffRecord, InjectionSettings, McpToolInfo, SkillEntry, ToolCallRecord, ToolCallsSnapshot, ToolCallStatus, TodosState, TodosStatus, TodosItem } from '../freecodex'

const collapsed = ref(localStorage.getItem('free-codex-panel-collapsed') === '1')
const activeTab = ref<'tools' | 'diffs' | 'injection' | 'clean' | 'todos' | 'logs'>('tools')

/** 左侧垂直导航菜单（分组：工具类 / 注入类 / 日志） */
const navGroups = [
  [
    { key: 'tools', label: 'Tools', icon: WrenchIcon },
    { key: 'diffs', label: 'Diff', icon: FileDiffIcon },
    { key: 'todos', label: 'Todos', icon: ListTodoIcon },
  ],
  [
    { key: 'injection', label: 'Inject', icon: SyringeIcon },
    { key: 'clean', label: 'Clean', icon: Trash2Icon },
  ],
  [
    { key: 'logs', label: 'Logs', icon: ScrollTextIcon },
  ],
] as const

/** 当前标签标题（内容区头部） */
const activeNavLabel = computed(() => {
  const key = activeTab.value as (typeof navGroups)[number][number]['key']
  for (const group of navGroups) {
    const item = group.find((g) => g.key === key)
    if (item) return item.label
  }
  return ''
})
const tools = ref<McpToolInfo[]>([])
const diffs = ref<FileDiffRecord[]>([])
const logs = ref<{ time: string; level: string; text: string }[]>([])
/** Tools 面板视图：调用记录（当前会话）/ 全部可用工具 */
const toolsView = ref<'calls' | 'all'>('calls')
/** 工具调用快照（按 MCP 会话分组 + 归属对话） */
const toolCalls = ref<ToolCallsSnapshot>({ currentConvId: null, sessions: {}, recent: [] })
let removeEvents: (() => void) | undefined
let removeDiffEvents: (() => void) | undefined
let removeDiffRemoved: (() => void) | undefined
let removeToolCallEvents: (() => void) | undefined
let removeConversationEvents: (() => void) | undefined
let removeDiffUpdated: (() => void) | undefined
let removeTodosEvents: (() => void) | undefined
let mountRefreshTimer: ReturnType<typeof setTimeout> | undefined

// ---------- 注入内容（Injection tab）----------
const injections = ref<InjectionSettings>({ projectPath: true, agentsMd: true, claudeMd: false, autoSelectPlugin: true, skills: {} })
const injectionSkills = ref<SkillEntry[]>([])
const projectFileNames = ref<Set<string>>(new Set())

/** 基础开关行（文件路径 / AGENTS.md / CLAUDE.md） */
const baseRows = computed(() => [
  {
    key: 'projectPath',
    label: '文件路径',
    hint: '注入项目根目录（相对路径解析基准）',
    get: () => injections.value.projectPath,
    set: (v: boolean) => void saveInjection({ projectPath: v }),
  },
  {
    key: 'agentsMd',
    label: 'AGENTS.md',
    hint: projectFileNames.value.has('AGENTS.md') ? '项目中有该文件' : '项目无此文件（开启也不注入）',
    get: () => injections.value.agentsMd,
    set: (v: boolean) => void saveInjection({ agentsMd: v }),
  },
  {
    key: 'claudeMd',
    label: 'CLAUDE.md',
    hint: projectFileNames.value.has('CLAUDE.md') ? '项目中有该文件' : '项目无此文件（开启也不注入）',
    get: () => injections.value.claudeMd,
    set: (v: boolean) => void saveInjection({ claudeMd: v }),
  },
])

/** skills 分组行（未配置视为开启） */
const skillRows = computed(() =>
  injectionSkills.value.map((s) => ({
    name: s.name,
    description: s.description,
    scope: s.scope,
    on: injections.value.skills[s.name] !== false,
  })),
)

async function saveInjection(patch: Partial<InjectionSettings>): Promise<void> {
  try {
    injections.value = await window.freeCodex.injections.save(patch)
  } catch {
    /* 忽略保存失败（开关保持本地状态） */
  }
}

async function toggleSkill(name: string, on: boolean): Promise<void> {
  await saveInjection({ skills: { [name]: on } })
}

// ---------- Todos（进程内下游 server + 软强制注入）----------
const todos = ref<TodosState>({ enabled: false, convId: null, list: null })
/** 实时计时（让"上次更新"与"未更新"红点随时间走动） */
const nowTick = ref(Date.now())
let todosTickTimer: ReturnType<typeof setInterval> | undefined

const listStatusLabel = computed(() => {
  const s = todos.value.list?.status
  if (s === 'completed') return '已完成'
  if (s === 'cancelled') return '已作废'
  return '进行中'
})

const listStatusDotClass = computed(() => {
  const s = todos.value.list?.status
  if (s === 'completed') return 'bg-emerald-500'
  if (s === 'cancelled') return 'bg-red-500'
  return 'bg-sky-500'
})

/** 清单"陈旧未更新"：active 且未全部完成，且超过 2 分钟没有 todos 活动 */
const todosStale = computed(() => {
  const l = todos.value.list
  if (!l || l.status !== 'active') return false
  if (l.items.length === 0 || l.items.every((i) => i.status === 'done')) return false
  return nowTick.value - l.updatedAt > 120_000
})

/** 距上次 todos 活动的时长（红点文案） */
const todosStaleAgo = computed(() => {
  const l = todos.value.list
  if (!l) return ''
  const sec = Math.max(0, Math.floor((nowTick.value - l.updatedAt) / 1000))
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m`
})

async function loadTodos(): Promise<void> {
  try {
    todos.value = await window.freeCodex.todos.get()
  } catch {
    /* 使用默认值 */
  }
}

/** 面板 checkbox 直接改任务状态（不经 ChatGPT，走主进程 store） */
async function toggleTodoItem(item: TodosItem): Promise<void> {
  const next: TodosStatus = item.status === 'done' ? 'pending' : 'done'
  try {
    todos.value = await window.freeCodex.todos.updateItem(item.id, next)
  } catch {
    /* 忽略 */
  }
}

async function resetTodos(): Promise<void> {
  if (!confirm('清空当前对话的 todos 清单？')) return
  try {
    todos.value = await window.freeCodex.todos.reset()
  } catch {
    /* 忽略 */
  }
}

async function loadInjectionState(): Promise<void> {
  try {
    injections.value = await window.freeCodex.injections.get()
  } catch {
    /* 使用默认值 */
  }
  try {
    const lib = await window.freeCodex.skills.list()
    injectionSkills.value = lib.skills
  } catch {
    injectionSkills.value = []
  }
  try {
    const files = await window.freeCodex.listProjectFiles()
    projectFileNames.value = new Set(files.files.map((f) => f.relPath))
  } catch {
    projectFileNames.value = new Set()
  }
}

// ---------- 会话清理（Clean tab）----------
const cleanup = ref<ChatCleanupSettings>({ trimKeep: 3, autoTrim: false })
const trimKeepInput = ref('3')
const trimBusy = ref(false)
const trimResult = ref<{ removed: number; total: number } | null>(null)
const conversations = ref<ConversationEntry[]>([])
const listBusy = ref(false)
const deletingIds = ref<Set<string>>(new Set())
const selectedIds = ref<Set<string>>(new Set())

const allSelected = computed(() => conversations.value.length > 0 && selectedIds.value.size === conversations.value.length)

function toggleSelect(id: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function toggleSelectAll(): void {
  selectedIds.value = allSelected.value ? new Set() : new Set(conversations.value.map((c) => c.id))
}

async function loadCleanup(): Promise<void> {
  try {
    const cfg = await window.freeCodex.getConfig()
    cleanup.value = cfg.chatCleanup
    trimKeepInput.value = String(cfg.chatCleanup.trimKeep ?? 3)
  } catch {
    /* 默认值 */
  }
}

async function saveCleanup(patch: Partial<ChatCleanupSettings>): Promise<void> {
  try {
    cleanup.value = await window.freeCodex.chatCleanup.save(patch)
  } catch {
    /* 忽略 */
  }
}

async function doTrim(): Promise<void> {
  trimBusy.value = true
  try {
    const r = await window.freeCodex.chatgpt.trimConversation(cleanup.value.trimKeep)
    if (r.ok) trimResult.value = { removed: r.removed ?? 0, total: r.total ?? 0 }
  } finally {
    trimBusy.value = false
  }
}

async function loadConversations(): Promise<void> {
  listBusy.value = true
  try {
    conversations.value = await window.freeCodex.chatgpt.conversations(30)
  } catch {
    conversations.value = []
  } finally {
    listBusy.value = false
  }
}

async function deleteConv(c: ConversationEntry): Promise<void> {
  if (!confirm(`确定从 ChatGPT 永久删除对话「${c.title || '无标题'}」？此操作不可恢复。`)) return
  deletingIds.value = new Set(deletingIds.value).add(c.id)
  try {
    const r = await window.freeCodex.chatgpt.deleteConversation(c.id)
    if (r.ok) {
      conversations.value = conversations.value.filter((x) => x.id !== c.id)
      log(`已删除对话: ${c.title || c.id.slice(0, 8)}`)
    } else {
      log(`删除失败: ${r.error ?? r.status ?? ''}`, 'error')
    }
  } finally {
    deletingIds.value = new Set([...deletingIds.value].filter((x) => x !== c.id))
  }
}

async function deleteAllConvs(): Promise<void> {
  if (!conversations.value.length) return
  if (!confirm(`确定永久删除列表中的 ${conversations.value.length} 个对话？此操作不可恢复。`)) return
  listBusy.value = true
  try {
    const r = await window.freeCodex.chatgpt.deleteAllConversations(50)
    if (r.ok > 0) {
      conversations.value = []
      selectedIds.value = new Set()
    }
    log(`已删除 ${r.ok} 个对话${r.failed ? `，失败 ${r.failed} 个` : ''}`)
  } finally {
    listBusy.value = false
  }
}

/** 多选删除：先逐条真实删除选中的对话，全部删完再统一刷新一次列表（不边删边刷） */
async function deleteSelected(): Promise<void> {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  if (!confirm(`确定永久删除选中的 ${ids.length} 个对话？此操作不可恢复。`)) return
  listBusy.value = true
  try {
    const deleting = new Set(deletingIds.value)
    let ok = 0
    let failed = 0
    for (const id of ids) {
      deleting.add(id)
      deletingIds.value = new Set(deleting)
      const r = await window.freeCodex.chatgpt.deleteConversation(id)
      deleting.delete(id)
      deletingIds.value = new Set(deleting)
      if (r.ok) ok++
      else failed++
    }
    selectedIds.value = new Set()
    log(`已删除选中 ${ok} 个对话${failed ? `，失败 ${failed} 个` : ''}`)
    // 全部删完后再刷新一次列表
    await loadConversations()
  } finally {
    listBusy.value = false
  }
}

function fmtConvTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function log(text: string, level = 'info'): void {
  logs.value.unshift({ time: new Date().toLocaleTimeString(), level, text })
  logs.value = logs.value.slice(0, 200)
}

async function refreshTools(): Promise<void> {
  const status = await window.freeCodex.status()
  tools.value = status.tools || []
}

/** 拉取工具调用快照（onToolCall / onConversationChanged 触发后刷新） */
async function refreshToolCalls(): Promise<void> {
  toolCalls.value = await window.freeCodex.getToolCalls()
}

/** 当前会话显示名（null = 首页/新会话） */
const convLabel = computed(() => (toolCalls.value.currentConvId ? shortId(toolCalls.value.currentConvId) : '新会话'))

/** 当前会话的全部调用（会话归属 === 当前对话 ID，最新在前） */
const currentCalls = computed(() => {
  const cur = toolCalls.value.currentConvId
  const calls: ToolCallRecord[] = []
  for (const s of Object.values(toolCalls.value.sessions)) {
    if ((s.convId ?? null) === cur) calls.push(...s.calls)
  }
  calls.sort((a, b) => b.at - a.at)
  return calls
})

/** 当前会话按工具聚合（次数 + 最后状态 + 参数键） */
const currentTools = computed(() => {
  const map = new Map<string, { tool: string; count: number; ok: number; error: number; pending: number; lastAt: number; lastStatus: ToolCallStatus; argsKeys: string[] }>()
  for (const c of currentCalls.value) {
    let e = map.get(c.tool)
    if (!e) {
      e = { tool: c.tool, count: 0, ok: 0, error: 0, pending: 0, lastAt: 0, lastStatus: 'pending', argsKeys: [] }
      map.set(c.tool, e)
    }
    e.count++
    if (c.status === 'ok') e.ok++
    else if (c.status === 'error') e.error++
    else e.pending++
    if (c.at >= e.lastAt) {
      e.lastAt = c.at
      e.lastStatus = c.status
      e.argsKeys = c.argsKeys
    }
  }
  return [...map.values()].sort((a, b) => b.lastAt - a.lastAt)
})

/** 其他会话的调用（与当前对话区分，最新在前，上限 30） */
const otherRows = computed(() => {
  const cur = toolCalls.value.currentConvId
  const rows: { tool: string; sessionId: string; convId: string | null; at: number }[] = []
  for (const [sid, s] of Object.entries(toolCalls.value.sessions)) {
    if ((s.convId ?? null) === cur) continue
    for (const c of s.calls) rows.push({ tool: c.tool, sessionId: sid, convId: s.convId, at: c.at })
  }
  rows.sort((a, b) => b.at - a.at)
  return rows.slice(0, 30)
})

function statusDotClass(status: ToolCallStatus): string {
  if (status === 'ok') return 'bg-emerald-500'
  if (status === 'error') return 'bg-red-500'
  return 'bg-sky-500 animate-pulse'
}

/** 短 ID（会话/对话长 ID 截断显示） */
function shortId(id: string | null): string {
  if (!id) return '新会话'
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

/** 相对时间 */
function fmtTime(at: number): string {
  const diff = Date.now() - at
  if (diff < 1000) return '刚刚'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  return new Date(at).toLocaleTimeString()
}

/** 格式化参数/结果为可读 JSON（过长截断） */
function formatJson(value: unknown): string {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    if (s.length > 12000) return s.slice(0, 12000) + '\n… (已截断)'
    return s
  } catch {
    return String(value)
  }
}

async function toggleCollapsed(v: boolean): Promise<void> {
  collapsed.value = v
  localStorage.setItem('free-codex-panel-collapsed', v ? '1' : '0')
  await window.freeCodex.setPanelCollapsed(v)
}

// ---------- Diff ----------
function openDiff(d: FileDiffRecord): void {
  // 跨进程 IPC 只能传纯数据：Vue 响应式 Proxy（含嵌套 hunks 数组）无法被结构化克隆，
  // 直接传 ref 里的记录会报 "An object could not be cloned" 导致 Diff 打不开，
  // 深拷贝成普通 JSON 结构再传。
  void window.freeCodex.openDiff(JSON.parse(JSON.stringify(d)))
}

function removeDiff(id?: string): void {
  if (!id) return
  diffs.value = diffs.value.filter((d) => d.id !== id)
}

async function revertDiff(d: FileDiffRecord): Promise<void> {
  if (!confirm(`确定撤回文件「${d.path}」到修改前内容？`)) return
  const result = await window.freeCodex.revertDiffFile(d.id)
  if (!result.ok) {
    alert(result.error ?? '撤回失败')
    return
  }
  removeDiff(d.id)
}

async function confirmDiff(d: FileDiffRecord): Promise<void> {
  await window.freeCodex.confirmDiffFile(d.id)
  removeDiff(d.id)
}

onMounted(async () => {
  await window.freeCodex.setPanelCollapsed(collapsed.value)
  await refreshTools()
  await refreshToolCalls()
  await loadInjectionState()
  await loadCleanup()
  await loadTodos()
  diffs.value = await window.freeCodex.listDiffs()
  removeEvents = window.freeCodex.onMcpEvent((event) => {
    log(event.payload ? `${event.method}: ${JSON.stringify(event.payload)}` : event.method)
    void refreshTools()
  })
  removeDiffEvents = window.freeCodex.onFileDiff((record) => {
    diffs.value = [record, ...diffs.value.filter((d) => d.id !== record.id)].slice(0, 100)
  })
  // diff 在 overlay 里被撤回/确认后，主进程推送 diff:removed 同步移除列表项
  removeDiffRemoved = window.freeCodex.onDiffRemoved((id) => {
    removeDiff(id)
  })
  // 整段撤销后 diff 重算 → 主进程推送更新，按 id 替换列表项
  removeDiffUpdated = window.freeCodex.onDiffUpdated((record) => {
    diffs.value = diffs.value.map((d) => (d.id === record.id ? record : d))
  })
  // 工具调用 / 对话切换 → 刷新调用记录
  removeToolCallEvents = window.freeCodex.onToolCall(() => void refreshToolCalls())
  removeConversationEvents = window.freeCodex.onConversationChanged(() => void refreshToolCalls())
  // todos 状态变更（开关 / 清单变化 / 工具调用打点）→ 刷新 Todos 面板
  removeTodosEvents = window.freeCodex.onTodosChanged((state) => {
    todos.value = state
  })
  // 实时计时：驱动"上次更新"时间与"未更新"红点（每 5s 一跳）
  todosTickTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 5000)
  // 兜底：面板挂载早于网关启动完成时（错过 gateway_started 事件），延迟一次刷新静态工具列表
  mountRefreshTimer = setTimeout(() => void refreshTools(), 2000)
})

onUnmounted(() => {
  if (mountRefreshTimer) clearTimeout(mountRefreshTimer)
  if (todosTickTimer) clearInterval(todosTickTimer)
  removeEvents?.()
  removeDiffEvents?.()
  removeDiffRemoved?.()
  removeDiffUpdated?.()
  removeToolCallEvents?.()
  removeConversationEvents?.()
  removeTodosEvents?.()
})
</script>

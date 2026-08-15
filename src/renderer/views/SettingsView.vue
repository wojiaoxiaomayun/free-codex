<template>
  <div class="flex h-full overflow-hidden">
    <!-- 左侧子菜单 -->
    <aside class="flex w-44 shrink-0 flex-col gap-1 border-r border-border bg-sidebar p-3">
      <Button variant="ghost" class="mb-1 justify-start gap-2.5" @click="goBack">
        <ArrowLeftIcon class="text-muted-foreground" />
        返回 AI 应用
      </Button>
      <p class="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        设置
      </p>
      <Button
        v-for="item in navItems"
        :key="item.id"
        :variant="activeSection === item.id ? 'secondary' : 'ghost'"
        class="justify-start gap-2.5"
        @click="switchSection(item.id)"
      >
        <component :is="item.icon" class="text-muted-foreground" />
        {{ item.label }}
      </Button>
    </aside>

    <!-- 内容区 -->
    <main class="min-w-0 flex-1 overflow-y-auto p-6">
      <!-- ==================== MCP 网关（自带引擎） ==================== -->
      <template v-if="activeSection === 'gateway' && config">
        <div class="mb-6 flex flex-col gap-1">
          <h1 class="text-xl font-semibold">MCP 网关</h1>
          <p class="text-sm text-muted-foreground">
            内嵌 codex-mcp 引擎的自带能力（Streamable HTTP、OAuth、cloudflared 公网、内置工具与下游 hub），配置归 Free Codex 自持。
          </p>
        </div>

        <!-- 网关状态 + 自动启动 -->
        <Card class="mb-4">
          <CardContent class="flex flex-wrap items-center justify-between gap-3 py-4">
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="size-2 shrink-0 rounded-full"
                :class="gateway.running ? 'bg-emerald-500' : 'bg-muted-foreground/40'"
              />
              <div class="flex min-w-0 flex-col gap-0.5">
                <p class="text-sm font-medium">Node MCP Gateway {{ gateway.running ? '运行中' : '未启动' }}</p>
                <code class="truncate text-xs text-muted-foreground">{{ gateway.publicUrl || gateway.endpoint }}</code>
              </div>
            </div>
            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <div class="flex items-center gap-2 pr-1">
                <Switch
                  :checked="!!config?.autoStart"
                  aria-label="自动启动 Gateway"
                  @update:checked="setAutoStart"
                />
                <span class="text-xs text-muted-foreground">自动启动</span>
              </div>
              <Button variant="ghost" size="sm" :disabled="!gateway.running" @click="refreshGateway">
                <RefreshCwIcon class="size-3.5" />
                刷新
              </Button>
              <Button size="sm" :variant="gateway.running ? 'outline' : 'default'" @click="toggleGateway">
                {{ gateway.running ? '停止' : '启动' }}
              </Button>
            </div>
          </CardContent>
        </Card>

        <!-- 连接配置（含连接密码） -->
        <Card class="mb-4">
          <CardHeader class="pb-3">
            <CardTitle class="text-base">连接配置</CardTitle>
            <CardDescription>本地监听地址与端口；公网模式通过 cloudflared 暴露给 ChatGPT，并需设置连接密码。</CardDescription>
          </CardHeader>
          <CardContent class="flex flex-col gap-3">
            <div class="grid max-w-2xl grid-cols-2 gap-3">
              <Field>
                <FieldLabel for="gw-host">Host</FieldLabel>
                <FieldContent>
                  <Input id="gw-host" v-model="config.gateway.host" placeholder="127.0.0.1" />
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel for="gw-port">Port</FieldLabel>
                <FieldContent>
                  <Input id="gw-port" v-model.number="config.gateway.port" type="number" placeholder="3291" />
                </FieldContent>
              </Field>
            </div>
            <!-- 连接密码（公网模式 ChatGPT 连接验证用） -->
            <div class="flex items-center gap-2 border-t border-border/60 pt-3">
              <Badge :variant="hasPassword ? 'default' : 'secondary'">
                {{ hasPassword ? '已设置' : '未设置' }}
              </Badge>
              <span class="text-xs text-muted-foreground">连接密码（公网模式下 ChatGPT 连接验证用）</span>
            </div>
            <div class="flex max-w-xl items-center gap-2">
              <div class="relative flex-1">
                <Input
                  v-model="passwordInput"
                  :type="showPasswordInput ? 'text' : 'password'"
                  placeholder="≥ 12 字符"
                  class="pr-9"
                  @keydown.enter="setPassword"
                />
                <Button
                  v-if="passwordInput"
                  variant="ghost"
                  size="icon-xs"
                  class="absolute top-1/2 right-1.5 -translate-y-1/2"
                  :title="showPasswordInput ? '隐藏密码' : '显示密码'"
                  @click="showPasswordInput = !showPasswordInput"
                >
                  <EyeOffIcon v-if="showPasswordInput" class="size-3.5" />
                  <EyeIcon v-else class="size-3.5" />
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                :disabled="!passwordInput"
                title="复制密码"
                @click="copyPasswordInput"
              >
                <CopyIcon class="size-3.5" />
                复制
              </Button>
              <Button variant="outline" size="sm" @click="setPassword">设置</Button>
              <Button variant="ghost" size="sm" @click="generatePassword">生成随机密码</Button>
            </div>
            <p class="text-xs text-muted-foreground">
              密码明文保存在本机（codex-mcp 侧为哈希校验），设置后这里始终可以查看/复制。
            </p>
            <FieldError v-if="passwordError" class="mt-1">{{ passwordError }}</FieldError>
            <div class="mt-1 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
              <span class="text-xs text-muted-foreground">Gateway 运行中保存会自动重启生效</span>
              <Button size="sm" @click="saveConfig">
                <SaveIcon class="size-3.5" />
                保存
              </Button>
            </div>
          </CardContent>
        </Card>

        <!-- 公网配置 -->
        <Card class="mb-4">
          <CardHeader class="pb-3">
            <div class="flex items-start justify-between gap-3">
              <div class="flex flex-col gap-1">
                <CardTitle class="text-base">公网配置</CardTitle>
                <CardDescription>
                  ChatGPT 远程连接需要公网域名 + Cloudflare Tunnel + 连接密码。
                </CardDescription>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted-foreground">启用公网</span>
                <Switch
                  :checked="!!config?.gateway.publicEnabled"
                  aria-label="启用公网模式"
                  @update:checked="setPublicEnabled"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent class="flex flex-col gap-3">
            <Field>
              <FieldLabel for="gw-cfbin">cloudflared 路径</FieldLabel>
              <FieldContent>
                <div class="flex gap-2">
                  <Input
                    id="gw-cfbin"
                    v-model="config.gateway.cloudflaredBin"
                    :disabled="!config?.gateway.publicEnabled"
                    placeholder="cloudflared"
                    class="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="!config?.gateway.publicEnabled || cfBusy"
                    title="已有则直接使用；没有则自动下载 codex-mcp 内置版本"
                    @click="downloadCloudflared"
                  >{{ cfBusy ? '下载中…' : '下载' }}</Button>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="!config?.gateway.publicEnabled"
                    @click="pickCloudflared"
                  >浏览…</Button>
                </div>
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel for="gw-domain">公网域名</FieldLabel>
              <FieldContent>
                <Input
                  id="gw-domain"
                  v-model="config.gateway.domain"
                  :disabled="!config?.gateway.publicEnabled"
                  placeholder="mcp.example.com"
                />
              </FieldContent>
            </Field>
            <div class="grid max-w-2xl grid-cols-2 gap-3">
              <Field>
                <FieldLabel for="gw-tunnelname">Tunnel 名称</FieldLabel>
                <FieldContent>
                  <Input
                    id="gw-tunnelname"
                    v-model="config.gateway.tunnelName"
                    :disabled="!config?.gateway.publicEnabled"
                    placeholder="codex-mcp"
                  />
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel for="gw-tunnelid">Tunnel ID</FieldLabel>
                <FieldContent>
                  <Input
                    id="gw-tunnelid"
                    v-model="config.gateway.tunnelId"
                    :disabled="!config?.gateway.publicEnabled"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </FieldContent>
              </Field>
            </div>
            <div class="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
              <span class="text-xs text-muted-foreground">
                填写后点「保存公网配置」生效；隧道配置文件由应用自动生成/复用，无需手动填写。
              </span>
              <div class="flex shrink-0 items-center gap-2">
                <Button v-if="!hasPublicConfig" size="sm" variant="outline" class="gap-1.5" @click="openTunnelWizard">
                  <RocketIcon class="size-3.5" />
                  一键创建
                </Button>
                <Button size="sm" @click="saveConfig">
                  <SaveIcon class="size-3.5" />
                  保存公网配置
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- 一键创建 Cloudflare Tunnel（Dialog 弹窗） -->
        <Dialog v-model:open="tunnelWizardOpen" @update:open="onTunnelDialogOpenChange">
          <DialogScrollContent class="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
            <DialogHeader class="shrink-0 border-b border-border px-6 py-4">
              <div class="flex items-center gap-3">
                <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <RocketIcon class="size-5" />
                </div>
                <div class="min-w-0 flex-1">
                  <DialogTitle class="text-base">一键创建 Cloudflare Tunnel</DialogTitle>
                  <DialogDescription>自动完成建隧道、DNS 路由与写配置，全程可视化。</DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
            <!-- 步骤进度条（运行/完成/失败时显示） -->
            <div v-if="tunnelPhase !== 'form'" class="flex items-start px-1">
              <template v-for="(step, i) in TUNNEL_STEPS" :key="step.id">
                <div
                  class="flex flex-col items-center gap-1.5"
                  :class="i === TUNNEL_STEPS.length - 1 ? 'flex-none' : 'flex-1'"
                >
                  <div
                    class="flex size-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors"
                    :class="stepCircleClass(i)"
                  >
                    <CircleCheckIcon v-if="stepState(i) === 'done'" class="size-4" />
                    <Loader2Icon v-else-if="stepState(i) === 'current'" class="size-4 animate-spin" />
                    <CircleXIcon v-else-if="stepState(i) === 'error'" class="size-4" />
                    <template v-else>{{ i + 1 }}</template>
                  </div>
                  <span class="text-center text-[11px] leading-tight" :class="stepLabelClass(i)">{{ step.label }}</span>
                </div>
                <div
                  v-if="i < TUNNEL_STEPS.length - 1"
                  class="mx-1.5 mt-[15px] h-0.5 min-w-4 flex-1 rounded-full transition-colors"
                  :class="connectorClass(i)"
                />
              </template>
            </div>

            <!-- 表单阶段：域名 + Tunnel 名称 -->
            <div v-if="tunnelPhase === 'form'" class="flex flex-col gap-4">
              <div class="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-muted-foreground">
                <GlobeIcon class="mt-0.5 size-4 shrink-0 text-primary" />
                <p>
                  域名需要已在 Cloudflare 接入（NS 指向 Cloudflare 的 Zone）。首次运行会打开浏览器要求登录 Cloudflare 授权，之后自动完成建隧道 + DNS 路由 + 写配置。
                </p>
              </div>
              <div class="flex flex-col gap-3">
                <Field>
                  <FieldLabel for="tunnel-domain">公网域名</FieldLabel>
                  <FieldContent>
                    <Input id="tunnel-domain" v-model="tunnelForm.domain" placeholder="mcp.example.com" />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel for="tunnel-name">Tunnel 名称</FieldLabel>
                  <FieldContent>
                    <Input id="tunnel-name" v-model="tunnelForm.tunnelName" placeholder="codex-mcp" />
                  </FieldContent>
                </Field>
              </div>
              <p v-if="tunnelError" class="text-sm text-red-600 dark:text-red-400">{{ tunnelError }}</p>
            </div>

            <!-- 运行阶段：步骤日志 + 确认框 -->
            <div v-else-if="tunnelPhase === 'running'" class="flex flex-col gap-3">
              <div
                ref="tunnelLogBox"
                class="flex max-h-52 flex-col gap-1.5 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3.5 font-mono text-xs leading-relaxed"
              >
                <div v-for="(log, i) in tunnelLogs" :key="i" class="flex items-start gap-2">
                  <span class="mt-[5px] size-1.5 shrink-0 rounded-full" :class="logDotClass(log.kind)" />
                  <p class="min-w-0 whitespace-pre-wrap" :class="tunnelLogClass(log.kind)">{{ log.message }}</p>
                </div>
                <p v-if="!tunnelLogs.length" class="text-muted-foreground/60">准备中…</p>
              </div>
              <div
                v-if="tunnelPendingAsk"
                class="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5"
              >
                <ShieldAlertIcon class="mt-0.5 size-4 shrink-0 text-amber-500" />
                <div class="min-w-0 flex-1">
                  <p class="text-sm leading-relaxed">{{ tunnelPendingAsk.question }}</p>
                  <div class="mt-3 flex justify-end gap-2">
                    <Button size="sm" variant="ghost" @click="answerTunnelAsk(false)">取消</Button>
                    <Button size="sm" variant="destructive" @click="answerTunnelAsk(true)">确认</Button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 完成阶段 -->
            <div v-else-if="tunnelPhase === 'done' && tunnelResult" class="flex flex-col gap-4">
              <div class="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-500">
                  <CircleCheckIcon class="size-5" />
                </div>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-emerald-600 dark:text-emerald-400">Tunnel 创建完成，配置已保存</p>
                  <p class="mt-0.5 text-xs text-muted-foreground">公网模式已自动启用；Gateway 运行中会自动重启应用公网配置。</p>
                </div>
              </div>
              <dl class="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border border-border bg-muted/30 p-4 text-xs">
                <div class="flex min-w-0 flex-col gap-0.5">
                  <dt class="text-muted-foreground">公网域名</dt>
                  <dd class="truncate font-mono text-foreground">{{ tunnelResult.domain }}</dd>
                </div>
                <div class="flex min-w-0 flex-col gap-0.5">
                  <dt class="text-muted-foreground">Tunnel ID</dt>
                  <dd class="truncate font-mono text-foreground">{{ tunnelResult.tunnelId }}</dd>
                </div>
                <div class="col-span-2 flex min-w-0 flex-col gap-0.5">
                  <dt class="text-muted-foreground">配置文件</dt>
                  <dd class="truncate font-mono text-foreground">{{ tunnelResult.configPath }}</dd>
                </div>
                <div class="col-span-2 flex min-w-0 flex-col gap-0.5">
                  <dt class="text-muted-foreground">cloudflared</dt>
                  <dd class="truncate font-mono text-foreground">{{ tunnelResult.cloudflaredBin }}</dd>
                </div>
              </dl>
            </div>

            <!-- 错误阶段 -->
            <div v-else class="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-500">
                <CircleXIcon class="size-4" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-red-600 dark:text-red-400">设置失败</p>
                <p class="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{{ tunnelError }}</p>
              </div>
            </div>
            </div>

          <DialogFooter class="shrink-0 gap-2 border-t border-border px-6 py-4">
            <template v-if="tunnelPhase === 'form'">
              <Button variant="ghost" @click="closeTunnelWizard">取消</Button>
              <Button @click="runTunnelSetup">
                <RocketIcon class="size-3.5" />
                开始创建
              </Button>
            </template>
            <template v-else-if="tunnelPhase === 'running' && !tunnelPendingAsk">
              <Button variant="ghost" :disabled="tunnelBusy" @click="cancelTunnelSetup">
                <Loader2Icon v-if="tunnelBusy" class="size-3.5 animate-spin" />
                取消
              </Button>
            </template>
            <template v-else-if="tunnelPhase === 'done'">
              <Button @click="closeTunnelWizard">完成</Button>
            </template>
            <template v-else>
              <Button variant="ghost" @click="closeTunnelWizard">关闭</Button>
              <Button @click="resetTunnelWizard">重试</Button>
            </template>
          </DialogFooter>
          </DialogScrollContent>
        </Dialog>

        <!-- UI 偏好 -->
        <Card class="mb-4">
          <CardHeader class="pb-3">
            <CardTitle class="text-base">ChatGPT 界面偏好</CardTitle>
            <CardDescription>控制注入到 ChatGPT 对话的自定义卡片显示（即时生效）。</CardDescription>
          </CardHeader>
          <CardContent class="flex flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-col gap-0.5">
                <p class="text-sm font-medium">工具卡片</p>
                <p class="text-xs text-muted-foreground">read / edit / bash 等编码工具</p>
              </div>
              <Switch :checked="!!config?.ui.tools" aria-label="工具卡片" @update:checked="(v) => setUi('tools', v)" />
            </div>
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-col gap-0.5">
                <p class="text-sm font-medium">状态卡片</p>
                <p class="text-xs text-muted-foreground">summary / goal 等状态进度工具</p>
              </div>
              <Switch :checked="!!config?.ui.status" aria-label="状态卡片" @update:checked="(v) => setUi('status', v)" />
            </div>
          </CardContent>
        </Card>

        <!-- ChatGPT 插件（连接器） -->
        <Card class="mb-4">
          <CardHeader class="pb-3">
            <CardTitle class="text-base">ChatGPT 插件</CardTitle>
            <CardDescription>在 ChatGPT 网页中管理开发者模式与 freecodex MCP 插件（连接器）。</CardDescription>
          </CardHeader>
          <CardContent class="flex flex-col gap-3">
            <!-- ChatGPT 登录状态：插件/开发者模式操作前置条件 -->
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
              <div class="flex min-w-0 flex-col gap-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium">ChatGPT 登录</span>
                  <Badge v-if="loginState" :variant="loginState.loggedIn ? 'default' : 'secondary'">
                    {{ loginState.loggedIn ? '已登录' : '未登录' }}
                  </Badge>
                  <Badge v-else variant="secondary">检测中…</Badge>
                </div>
                <p class="text-xs text-muted-foreground">
                  检测开发者模式与插件前需先登录 ChatGPT；未登录时无法读取账号状态。
                </p>
              </div>
              <Button v-if="!loginState?.loggedIn" variant="outline" size="sm" :disabled="loginBusy" @click="goLogin">
                {{ loginBusy ? '等待登录…' : '前往登录' }}
              </Button>
            </div>
            <!-- 开发者模式 -->
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
              <div class="flex min-w-0 flex-col gap-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium">开发者模式</span>
                  <Badge v-if="devMode" :variant="devMode.developerMode ? 'default' : 'secondary'">
                    {{ devMode.lockdownMode ? '被锁定模式禁用' : devMode.developerMode ? '已开启' : '未开启' }}
                  </Badge>
                  <Badge v-else variant="secondary">未知</Badge>
                </div>
                <p class="text-xs text-muted-foreground">
                  允许 ChatGPT 添加未经验证的连接器（自定义 MCP 插件）；「锁定模式」开启时会禁用。
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                :disabled="devModeBusy"
                :title="loginState?.loggedIn ? '' : '未登录时会先引导登录'"
                @click="ensureDevMode"
              >
                {{ devModeBusy ? '处理中…' : '确保开发者模式开启' }}
              </Button>
            </div>
            <!-- freecodex 插件 -->
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
              <div class="flex min-w-0 flex-col gap-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium">freecodex 插件</span>
                  <Badge v-if="pluginStatus" :variant="pluginStatus.found ? 'default' : 'secondary'">
                    {{ pluginStatus.found ? '已安装' : '未安装' }}
                  </Badge>
                  <Badge v-else variant="secondary">未知</Badge>
                </div>
                <p class="truncate font-mono text-xs text-muted-foreground" :title="FREECODEX_MCP_URL">{{ FREECODEX_MCP_URL }}</p>
                <p v-if="pluginStatus?.found" class="text-xs text-muted-foreground">
                  <span class="font-medium text-foreground/80">{{ pluginStatus.displayName }}</span>
                  · {{ shortAppId(pluginStatus.appId) }}
                </p>
              </div>
              <div class="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="pluginBusy || !FREECODEX_MCP_URL"
                  :title="!FREECODEX_MCP_URL ? '请先配置公网域名' : loginState?.loggedIn ? '' : '未登录时会先引导登录'"
                  @click="refreshPlugin"
                >检测</Button>
                <Button
                  size="sm"
                  :disabled="pluginBusy || !FREECODEX_MCP_URL"
                  :title="!FREECODEX_MCP_URL ? '请先配置公网域名' : loginState?.loggedIn ? '' : '未登录时会先引导登录'"
                  @click="installPlugin"
                >
                  {{ pluginStatus?.found ? '重新安装' : '安装' }}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- 授权连接密码（OAuth 安装需要；应用只存哈希，输入一次或自动生成） -->
        <Dialog v-model:open="installPasswordOpen">
          <DialogScrollContent class="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
            <DialogHeader class="shrink-0 border-b border-border px-6 py-4">
              <DialogTitle class="text-base">授权连接需要连接密码</DialogTitle>
              <DialogDescription>
                安装 OAuth 插件需要先通过本机网关的「连接密码」验证。密码只存哈希，请手动输入一次；忘了就自动生成新的。
              </DialogDescription>
            </DialogHeader>
            <div class="flex flex-col gap-3 px-6 py-4">
              <Input
                v-model="installPassword"
                type="password"
                placeholder="连接密码（≥ 12 字符）"
                :disabled="installPasswordBusy"
                @keydown.enter="confirmInstallPassword(false)"
              />
              <p v-if="installPasswordHint" class="text-xs text-destructive">{{ installPasswordHint }}</p>
              <p class="text-xs text-muted-foreground">
                提示：生成新密码会替换现有连接密码（旧密码失效）；应用会自动用它完成授权，无需你记住。
              </p>
            </div>
            <DialogFooter class="shrink-0 gap-2 border-t border-border px-6 py-4">
              <Button variant="ghost" :disabled="installPasswordBusy" @click="installPasswordOpen = false">取消</Button>
              <Button variant="outline" :disabled="installPasswordBusy" @click="confirmInstallPassword(true)">
                {{ installPasswordBusy ? '处理中…' : '自动生成并使用' }}
              </Button>
              <Button :disabled="installPasswordBusy || !installPassword.trim()" @click="confirmInstallPassword(false)">
                {{ installPasswordBusy ? '处理中…' : '确认授权' }}
              </Button>
            </DialogFooter>
          </DialogScrollContent>
        </Dialog>

        <!-- 内置工具 -->
        <Card class="mb-4">
          <CardHeader class="pb-3">
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-col gap-1">
                <CardTitle class="text-base">内置工具</CardTitle>
                <CardDescription>codex-mcp 引擎自带的 {{ builtinTools.length }} 个工具，可逐个启用/禁用（禁用后 ChatGPT 连接器不再暴露，保存即重启网关生效）</CardDescription>
              </div>
              <Badge variant="secondary">{{ builtinTools.length - disabledTools.length }} 启用 / {{ disabledTools.length }} 禁用</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div class="flex flex-col gap-3">
              <div class="relative max-w-sm">
                <SearchIcon class="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input v-model="toolSearch" placeholder="搜索工具…" class="pl-8" />
              </div>
              <div class="flex flex-col gap-2">
                <div
                  v-for="tool in filteredTools.slice(0, builtinToolsExpanded ? undefined : 8)"
                  :key="tool.name"
                  class="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
                >
                  <div class="flex min-w-0 flex-col gap-0.5">
                    <code class="truncate text-xs text-primary">{{ tool.name }}</code>
                    <span class="truncate text-[11px] text-muted-foreground">{{ tool.description }}</span>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" class="text-[10px]">{{ disabledTools.includes(tool.name) ? '已禁用' : '内置' }}</Badge>
                    <Switch
                      :checked="!disabledTools.includes(tool.name)"
                      :disabled="toolBusy"
                      @update:checked="(v: boolean) => toggleTool(tool.name, v)"
                    />
                  </div>
                </div>
                <div v-if="builtinTools.length === 0" class="py-6 text-center text-sm text-muted-foreground">
                  {{ gateway.running ? '内置工具列表获取失败，可点上方「刷新」重试' : '网关未启动，启动后可查看内置工具' }}
                </div>
                <div v-else-if="filteredTools.length === 0" class="py-6 text-center text-sm text-muted-foreground">
                  没有匹配「{{ toolSearch }}」的工具
                </div>
                <div v-if="toolBusy" class="text-center text-[11px] text-muted-foreground">保存中，网关重启后生效…</div>
                <Button
                  v-if="builtinTools.length > 8"
                  variant="ghost"
                  size="sm"
                  class="mt-1 w-full"
                  @click="builtinToolsExpanded = !builtinToolsExpanded"
                >
                  {{ builtinToolsExpanded ? '收起' : `展开全部 ${builtinTools.length} 个工具` }}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </template>

      <!-- ==================== MCP 服务器（下游） ==================== -->
      <template v-else-if="activeSection === 'servers'">
        <div class="mb-6 flex items-start justify-between gap-2">
          <div class="flex flex-col gap-1">
            <h1 class="text-xl font-semibold">MCP 服务器</h1>
            <p class="text-sm text-muted-foreground">
              下游服务器：连接成功后工具自动注册并注入到对话；以 Free Codex 配置为准，并自动与 ~/.codex-mcp/mcp.json 双向同步（首次运行导入，保存时写回，供独立 codex-mcp 复用）。
            </p>
          </div>
          <Button size="sm" @click="openMcpCreate">
            <PlusIcon class="size-4" />
            添加服务器
          </Button>
        </div>
        <div class="flex flex-col gap-3">
          <!-- 系统 MCP（不可删除，仅开关）：如 todos 任务清单 -->
          <Card v-for="sys in mcpData.system ?? []" :key="sys.name" class="border-primary/40">
            <CardHeader class="pb-2">
              <div class="flex flex-wrap items-center gap-2">
                <CardTitle class="flex items-center gap-2 text-base">{{ sys.name }}</CardTitle>
                <Badge variant="outline">系统 MCP</Badge>
                <Badge :variant="sysEnabled(sys.name) ? 'default' : 'secondary'">
                  {{ sysEnabled(sys.name) ? '已开启' : '已关闭' }}
                </Badge>
              </div>
              <CardDescription class="text-xs">{{ sys.description }}</CardDescription>
            </CardHeader>
            <CardFooter class="gap-2">
              <div class="flex w-full items-center justify-between gap-2">
                <span class="text-xs text-muted-foreground">开启 → 向 ChatGPT 注入 todos 工作流要求；关闭 → 不注入</span>
                <Switch
                  :checked="sysEnabled(sys.name)"
                  :disabled="todosToggling"
                  @update:checked="(v: boolean) => toggleSystemMcp(sys.name, v)"
                />
              </div>
            </CardFooter>
          </Card>

          <Card v-for="(server, name) in mcpData.mcpServers" :key="String(name)">
            <CardHeader class="pb-2">
              <div class="flex flex-wrap items-center gap-2">
                <CardTitle class="flex items-center gap-2 text-base">{{ name }}</CardTitle>
                <Badge :variant="server.disabled ? 'secondary' : 'default'">
                  {{ server.disabled ? '禁用' : '已配置' }}
                </Badge>
                <Badge variant="outline">{{ server.url ? 'HTTP' : 'STDIO' }}</Badge>
              </div>
              <CardDescription class="font-mono text-xs">
                {{ server.url || `${server.command || ''} ${(server.args ?? []).join(' ')}` }}
              </CardDescription>
            </CardHeader>
            <CardFooter class="gap-2">
              <Button variant="outline" size="sm" @click="editMcp(String(name), server)">编辑</Button>
              <Button variant="ghost" size="sm" class="text-destructive" @click="deleteMcp(String(name))">删除</Button>
            </CardFooter>
          </Card>

          <Card v-if="!Object.keys(mcpData.mcpServers).length" class="border-dashed">
            <CardContent class="flex flex-col items-center gap-2 py-10">
              <span class="text-2xl">🔌</span>
              <p class="text-sm text-muted-foreground">
                暂无 MCP 服务器，添加一个开始使用（支持 stdio 本地进程与 Streamable HTTP 远程服务器）。
              </p>
            </CardContent>
          </Card>
        </div>

        <p class="mt-4 text-xs text-muted-foreground">
          保存后若 Gateway 运行中会自动重启，以重新连接下游服务器。
        </p>
      </template>

      <!-- ==================== 技能 ==================== -->
      <template v-else-if="activeSection === 'skills'">
        <div class="flex h-full min-h-0 flex-col">
          <div class="mb-6 flex flex-col gap-1">
            <h1 class="text-xl font-semibold">技能</h1>
            <p class="text-sm text-muted-foreground">
              技能即文件（SKILL.md），来自用户级
              <code class="rounded bg-muted px-1 text-xs text-primary">{{ skillData?.userDir ?? '~/.agents/skills' }}</code>
              与项目级
              <code class="rounded bg-muted px-1 text-xs text-primary">{{ skillData?.projectDir ?? '（未激活项目）' }}</code>。
              在对话中发送 <code class="rounded bg-muted px-1 text-xs text-primary">/技能名 请求</code> 即触发。
            </p>
          </div>

          <div class="mb-4 flex flex-wrap items-center gap-2">
            <Input v-model="skillFilter" placeholder="搜索技能…" class="max-w-60" />
            <Button size="sm" @click="openSkillCreate('user')">
              <PlusIcon class="size-4" />
              新建技能
            </Button>
          </div>

          <Tabs v-model="skillTab" class="flex min-h-0 flex-1 flex-col gap-3">
            <TabsList class="w-fit">
              <TabsTrigger value="user">用户级（{{ userSkills.length }}）</TabsTrigger>
              <TabsTrigger value="project">项目级（{{ projectSkills.length }}）</TabsTrigger>
            </TabsList>

            <TabsContent
              v-for="tab in (['user', 'project'] as const)"
              :key="tab"
              :value="tab"
              class="mt-0 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1"
            >
              <Card v-for="skill in (tab === 'user' ? userSkills : projectSkills)" :key="skill.name">
                <CardContent class="flex flex-col gap-1 py-3">
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex min-w-0 items-center gap-2">
                      <code class="truncate text-sm text-primary">{{ skill.name }}</code>
                      <Badge v-if="skill.invalid" variant="destructive">解析失败</Badge>
                    </div>
                    <div class="flex shrink-0 items-center gap-1">
                      <Switch
                        :checked="skill.enabled"
                        :aria-label="`${skill.enabled ? '禁用' : '启用'}技能 ${skill.name}`"
                        @update:checked="() => toggleSkill(skill)"
                      />
                      <Button variant="ghost" size="icon" :aria-label="`编辑 ${skill.name}`" @click="openSkillEdit(skill)">
                        <PencilIcon class="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" class="text-destructive" :aria-label="`删除 ${skill.name}`" @click="deleteSkill(skill)">
                        <Trash2Icon class="size-4" />
                      </Button>
                    </div>
                  </div>
                  <span class="text-xs text-muted-foreground">
                    {{ skill.invalid ?? (skill.description || '（无描述）') }}
                  </span>
                </CardContent>
              </Card>
              <Card v-if="!(tab === 'user' ? userSkills : projectSkills).length" class="border-dashed">
                <CardContent class="flex flex-col items-center gap-2 py-10">
                  <span class="text-2xl">🧠</span>
                  <p class="text-sm text-muted-foreground">
                    {{ tab === 'user'
                      ? '用户级暂无技能（~/.agents/skills）。可新建技能，跨项目可用。'
                      : (skillData?.projectDir ? '当前项目 .agents/skills 暂无技能，可新建。' : '未激活项目。打开项目后，其 .agents/skills 下的技能会出现在这里。') }}
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </template>

      <!-- ==================== Webview 代理 ==================== -->
      <template v-else-if="activeSection === 'webview' && config">
        <div class="mb-6 flex flex-col gap-1">
          <h1 class="text-xl font-semibold">Webview 代理</h1>
          <p class="text-sm text-muted-foreground">
            为 ChatGPT 网页视图设置网络代理，用于访问受限网络。
          </p>
        </div>

        <Card class="mb-4">
          <CardHeader class="pb-3">
            <div class="flex items-start justify-between gap-3">
              <div class="flex flex-col gap-1">
                <CardTitle class="text-base">启用代理</CardTitle>
                <CardDescription>关闭时恢复系统代理设置。</CardDescription>
              </div>
              <Switch
                :checked="!!config?.proxy.enabled"
                aria-label="启用代理"
                @update:checked="(v) => { if (config) config.proxy.enabled = v }"
              />
            </div>
          </CardHeader>
          <CardContent class="flex flex-col gap-3">
            <Field>
              <FieldLabel for="proxy-url">代理地址</FieldLabel>
              <FieldContent>
                <Input
                  id="proxy-url"
                  v-model="config.proxy.url"
                  :disabled="!config?.proxy.enabled"
                  placeholder="127.0.0.1:7890 或 socks5://127.0.0.1:1080"
                />
              </FieldContent>
            </Field>
            <p class="text-xs text-muted-foreground">
              支持 http://、https://、socks5:// 前缀（http 前缀可省略）。点击「应用代理」后 ChatGPT 页面将自动刷新。
            </p>
            <div class="flex items-center gap-3">
              <Button @click="applyProxy">
                <GlobeIcon class="size-4" />
                应用代理
              </Button>
              <span class="text-xs text-muted-foreground">应用后 ChatGPT 页面自动刷新</span>
            </div>
          </CardContent>
        </Card>
      </template>

    </main>

    <!-- 添加/编辑 MCP 服务器（Dialog 弹窗） -->
    <Dialog v-model:open="showMcpForm">
      <DialogScrollContent class="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader class="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>{{ mcpForm.name ? '编辑 MCP 服务器' : '添加 MCP 服务器' }}</DialogTitle>
          <DialogDescription>连接成功后工具自动注册并注入到对话。</DialogDescription>
        </DialogHeader>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
          <FieldGroup class="flex flex-col gap-4">
            <Field orientation="horizontal" class="max-w-2xl">
              <FieldLabel for="mcp-name" class="w-16">名称</FieldLabel>
              <FieldContent>
                <Input id="mcp-name" v-model="mcpForm.name" placeholder="如 filesystem" />
              </FieldContent>
            </Field>

            <Field orientation="horizontal" class="max-w-2xl">
              <FieldLabel for="mcp-type" class="w-16">类型</FieldLabel>
              <FieldContent>
                <Select v-model="mcpForm.type">
                  <SelectTrigger id="mcp-type" class="w-full">
                    <SelectValue placeholder="连接类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="stdio">stdio（本地进程）</SelectItem>
                      <SelectItem value="http">http（远程 URL）</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>

            <template v-if="mcpForm.type === 'stdio'">
              <Field orientation="horizontal" class="max-w-2xl">
                <FieldLabel for="mcp-command" class="w-16">命令</FieldLabel>
                <FieldContent>
                  <Input id="mcp-command" v-model="mcpForm.command" placeholder="如 npx" />
                </FieldContent>
              </Field>
              <Field orientation="horizontal" class="max-w-2xl">
                <FieldLabel for="mcp-args" class="w-16">参数</FieldLabel>
                <FieldContent>
                  <Input
                    id="mcp-args"
                    v-model="mcpForm.args"
                    placeholder="空格分隔，如 -y @modelcontextprotocol/server-filesystem C:/"
                  />
                </FieldContent>
              </Field>
            </template>

            <template v-else>
              <Field orientation="horizontal" class="max-w-2xl">
                <FieldLabel for="mcp-url" class="w-16">URL</FieldLabel>
                <FieldContent>
                  <Input id="mcp-url" v-model="mcpForm.url" placeholder="如 https://mcp.example.com/mcp" />
                </FieldContent>
              </Field>
              <Field orientation="horizontal" class="max-w-2xl">
                <FieldLabel for="mcp-headers" class="w-16">请求头</FieldLabel>
                <FieldContent>
                  <Textarea
                    id="mcp-headers"
                    v-model="mcpForm.headers"
                    rows="3"
                    placeholder="每行一个，格式：Key: Value&#10;如：Authorization: Bearer sk-xxx"
                  />
                </FieldContent>
              </Field>
            </template>
          </FieldGroup>
          <FieldError v-if="mcpFormError" class="mt-2">{{ mcpFormError }}</FieldError>
        </div>
        <DialogFooter class="shrink-0 gap-2 border-t border-border px-6 py-4">
          <Button variant="ghost" @click="showMcpForm = false">取消</Button>
          <Button @click="saveMcp">保存</Button>
        </DialogFooter>
      </DialogScrollContent>
    </Dialog>

    <!-- 新建/编辑技能（Dialog 弹窗） -->
    <Dialog v-model:open="showSkillForm">
      <DialogScrollContent class="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader class="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>{{ editingSkill ? `编辑技能 ${editingSkill.name}` : '新建技能' }}</DialogTitle>
          <DialogDescription>
            {{ editingSkill ? '重写该技能的 SKILL.md（保留 frontmatter 其它字段）。' : '写入指定作用域的 <name>/SKILL.md，与其他 agent 通用。' }}
          </DialogDescription>
        </DialogHeader>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
          <FieldGroup class="flex flex-col gap-4">
            <Field orientation="horizontal" class="max-w-2xl">
              <FieldLabel for="skill-name" class="w-16">名称</FieldLabel>
              <FieldContent>
                <Input
                  id="skill-name"
                  v-model="skillForm.name"
                  :disabled="!!editingSkill"
                  placeholder="如 code-review（小写 + 连字符）"
                />
              </FieldContent>
            </Field>
            <Field orientation="horizontal" class="max-w-2xl">
              <FieldLabel for="skill-scope" class="w-16">位置</FieldLabel>
              <FieldContent>
                <Select v-model="skillScope" :disabled="!!editingSkill">
                  <SelectTrigger id="skill-scope" class="w-full">
                    <SelectValue placeholder="作用域" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="user">用户级（~/.agents/skills，跨项目）</SelectItem>
                      <SelectItem value="project" :disabled="!skillData?.projectDir">
                        项目级（.agents/skills{{ skillData?.projectDir ? '' : '，未激活项目' }}）
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>
            <Field orientation="horizontal" class="max-w-2xl">
              <FieldLabel for="skill-desc" class="w-16">描述</FieldLabel>
              <FieldContent>
                <Input id="skill-desc" v-model="skillForm.description" placeholder="技能作用的一句话说明" />
              </FieldContent>
            </Field>
            <Field orientation="horizontal" class="max-w-2xl">
              <FieldLabel for="skill-instr" class="w-16">指令</FieldLabel>
              <FieldContent>
                <Textarea
                  id="skill-instr"
                  v-model="skillForm.instructions"
                  rows="8"
                  placeholder="触发后注入给模型的指令（SKILL.md 正文）"
                />
              </FieldContent>
            </Field>
          </FieldGroup>
          <FieldError v-if="skillFormError" class="mt-2">{{ skillFormError }}</FieldError>
        </div>
        <DialogFooter class="shrink-0 gap-2 border-t border-border px-6 py-4">
          <Button variant="ghost" @click="showSkillForm = false">取消</Button>
          <Button @click="saveSkill">保存</Button>
        </DialogFooter>
      </DialogScrollContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from '@/lib/toast-bridge'
import {
  ArrowLeftIcon,
  CircleCheckIcon,
  CircleXIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  GlobeIcon,
  Loader2Icon,
  PencilIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  RocketIcon,
  SaveIcon,
  SearchIcon,
  Settings2Icon,
  ShieldAlertIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { FreeCodexConfig, McpListResult, McpServerEntry, SkillEntry, SkillLibraryResult, TunnelAsk, TunnelProgressEvent, TunnelSetupResult } from '../freecodex'

// ---------- 子菜单导航 ----------
type SectionId = 'gateway' | 'servers' | 'skills' | 'webview'

const navItems = [
  { id: 'gateway', label: 'MCP 网关', icon: Settings2Icon },
  { id: 'servers', label: 'MCP 服务器', icon: PlugIcon },
  { id: 'skills', label: '技能', icon: SparklesIcon },
  { id: 'webview', label: 'Webview 代理', icon: GlobeIcon },
] as const

const router = useRouter()
const activeSection = ref<SectionId>('gateway')

function switchSection(id: SectionId): void {
  activeSection.value = id
}

/** 返回 AI 应用：恢复隐藏的 ChatGPT 视图并回到首页 */
async function goBack(): Promise<void> {
  await window.freeCodex.showActiveView().catch(() => undefined)
  router.push('/')
}

// ---------- 配置（free-codex 自持）----------
const config = ref<FreeCodexConfig | null>(null)

/** 公网配置是否已就绪（域名 + Tunnel ID 都填了 → 不再需要「一键创建」） */
const hasPublicConfig = computed(() => !!config.value?.gateway?.domain?.trim() && !!config.value?.gateway?.tunnelId?.trim())

/** 全量保存连接/公网配置（Gateway 运行中 → 主进程自动重启生效） */
async function saveConfig(): Promise<void> {
  if (!config.value) return
  const domain = config.value.gateway?.domain?.trim()
  const publicHint = domain ? `公网入口 https://${domain}/mcp` : '当前为本地模式'
  try {
    // Vue 的 config.value 是响应式 Proxy，不能直接过 IPC → 先转成普通对象（结构化克隆要求）
    const result = await window.freeCodex.saveConfig(JSON.parse(JSON.stringify(config.value)))
    // 主进程可能自动生成了 cloudflared.yml 等 → 重载配置让字段显示真实值
    config.value = await window.freeCodex.getConfig()
    if (result.restartError) {
      toast.warning('配置已保存，但 Gateway 重启失败', { description: result.restartError })
    } else if (result.restarted) {
      toast.success('配置已保存，Gateway 已自动重启', { description: result.url || publicHint })
    } else {
      toast.success('配置已保存', { description: `${publicHint}；Gateway 未运行，下次启动时生效` })
    }
  } catch (e) {
    toast.error('保存失败', { description: e instanceof Error ? e.message : String(e) })
  }
}

/** 自动启动开关（运行中可改，仅影响下次启动） */
async function setAutoStart(value: boolean): Promise<void> {
  if (!config.value) return
  config.value.autoStart = value
  await window.freeCodex.setAutoStart(value)
}

/** 公网模式开关（随保存提交） */
function setPublicEnabled(value: boolean): void {
  if (!config.value) return
  config.value.gateway.publicEnabled = value
}

/** 确保 cloudflared 可用：已有 → 直接填入；没有 → 自动下载并填入（不立即保存，随「保存公网配置」提交） */
const cfBusy = ref(false)
async function downloadCloudflared(): Promise<void> {
  if (!config.value || cfBusy.value) return
  cfBusy.value = true
  try {
    const r = await window.freeCodex.ensureCloudflaredBin()
    if (r.ok && r.path) {
      config.value.gateway.cloudflaredBin = r.path
      if (r.downloaded) toast.success(`cloudflared 已下载（v${r.version ?? ''}）`, { description: r.path })
      else toast.success('cloudflared 已就绪', { description: r.path })
    } else {
      toast.error('获取 cloudflared 失败', { description: r.error ?? '请检查网络后重试' })
    }
  } catch (err) {
    toast.error('获取 cloudflared 失败', { description: err instanceof Error ? err.message : String(err) })
  } finally {
    cfBusy.value = false
  }
}

/** 系统文件选择器选 cloudflared 路径（不立即保存，随「保存公网配置」提交） */
async function pickCloudflared(): Promise<void> {
  if (!config.value) return
  try {
    const r = await window.freeCodex.pickCloudflaredBin()
    if (r.ok && r.path) {
      config.value.gateway.cloudflaredBin = r.path
      toast.success('已选择 cloudflared', { description: r.path })
    }
  } catch (err) {
    toast.error('选择失败', { description: err instanceof Error ? err.message : String(err) })
  }
}

/** UI 偏好（运行中即时生效） */
async function setUi(key: 'tools' | 'status', value: boolean): Promise<void> {
  if (!config.value) return
  config.value.ui[key] = value
  await window.freeCodex.saveUi({ [key]: value })
}

/** 应用 Webview 代理（保存 + 应用 + 刷新 ChatGPT 页面） */
async function applyProxy(): Promise<void> {
  if (!config.value) return
  try {
    const r = await window.freeCodex.applyProxy({
      enabled: config.value.proxy.enabled,
      url: config.value.proxy.url,
    })
    if (!r?.ok) {
      toast.error('应用代理失败')
      return
    }
    toast.success('代理已应用', { description: 'ChatGPT 页面已刷新' })
  } catch (e) {
    toast.error('应用代理失败', { description: e instanceof Error ? e.message : String(e) })
  }
}

// ---------- 网关状态 ----------
const gateway = ref({ endpoint: 'http://127.0.0.1:3291/mcp', publicUrl: '', running: false })
const builtinTools = ref<{ name: string; description: string }[]>([])
const builtinToolsExpanded = ref(false)
/** 工具搜索关键词（按名称/描述过滤） */
const toolSearch = ref('')
const filteredTools = computed(() => {
  const q = toolSearch.value.trim().toLowerCase()
  if (!q) return builtinTools.value
  return builtinTools.value.filter(
    (t) => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q),
  )
})
/** 禁用的内置工具短名（config.toolEnablement.disabledTools） */
const disabledTools = ref<string[]>([])
const toolBusy = ref(false)

/** 内置工具启用/禁用：更新禁用列表 → 保存 → 网关自动重启生效 */
async function toggleTool(name: string, enabled: boolean): Promise<void> {
  const next = enabled ? disabledTools.value.filter((t) => t !== name) : [...disabledTools.value, name]
  toolBusy.value = true
  try {
    const r = await window.freeCodex.toolEnablement.save(next)
    disabledTools.value = r.disabledTools ?? next
    toast.success(enabled ? `已启用 ${name}` : `已禁用 ${name}`, {
      description: r.restarted
        ? enabled
          ? '网关已重启，该工具已重新暴露给 ChatGPT'
          : '网关已重启，ChatGPT 连接器将不再暴露该工具'
        : r.restartError
          ? `网关重启失败：${r.restartError}`
          : '网关未运行，下次启动生效',
    })
    await refreshGateway()
  } catch (err) {
    toast.error('保存失败', { description: err instanceof Error ? err.message : String(err) })
  } finally {
    toolBusy.value = false
  }
}

/** 加载工具启用配置（refreshGateway 后同步禁用列表） */
async function loadToolEnablement(): Promise<void> {
  try {
    const cfg = await window.freeCodex.getConfig()
    disabledTools.value = cfg.toolEnablement?.disabledTools ?? []
  } catch {
    disabledTools.value = []
  }
}

async function refreshGateway(): Promise<void> {
  const status = await window.freeCodex.status()
  gateway.value = { endpoint: status.endpoint, publicUrl: status.publicUrl, running: status.running }
  // 可用内置工具（getTools 已过滤禁用）+ 补回禁用的（无描述，显示"已禁用"），禁用的排最前方便重新启用
  const usable = (status.tools || []).filter((t) => t.server === 'codex-mcp')
  const usableNames = new Set(usable.map((t) => t.name))
  const disabledMissing = disabledTools.value.filter((n) => !usableNames.has(n))
  builtinTools.value = [
    ...disabledMissing.map((n) => ({ name: n, description: '（已禁用）' })),
    ...usable,
  ]
}

async function toggleGateway(): Promise<void> {
  try {
    if (gateway.value.running) {
      await window.freeCodex.stop()
      gateway.value.running = false
      gateway.value.publicUrl = ''
      toast.success('MCP Gateway 已停止')
      return
    }
    const url = await window.freeCodex.start()
    await refreshGateway()
    toast.success('MCP Gateway 已启动', { description: url })
  } catch (e) {
    toast.error('启动失败', { description: e instanceof Error ? e.message : String(e) })
  }
}

// ---------- 一键创建 Cloudflare Tunnel（向导）----------
const tunnelWizardOpen = ref(false)
const tunnelPhase = ref<'form' | 'running' | 'done' | 'error'>('form')
const tunnelForm = ref({ domain: '', tunnelName: 'codex-mcp' })
const tunnelLogs = ref<TunnelProgressEvent[]>([])
const tunnelLogBox = ref<HTMLElement | null>(null)
const tunnelError = ref('')
const tunnelResult = ref<TunnelSetupResult | null>(null)
const tunnelPendingAsk = ref<TunnelAsk | null>(null)
const tunnelBusy = ref(false)
let removeTunnelProgress: (() => void) | undefined
let removeTunnelAsk: (() => void) | undefined

function openTunnelWizard(): void {
  const cfg = config.value
  const domain = (cfg?.gateway.domain || cfg?.cloudflare.hostname || '').trim()
  tunnelForm.value = {
    domain,
    tunnelName: cfg?.gateway.tunnelName || 'codex-mcp',
  }
  // 只打开弹窗并预填已有域名；真正创建需用户点「开始创建」再执行
  tunnelPhase.value = 'form'
  tunnelLogs.value = []
  tunnelError.value = ''
  tunnelResult.value = null
  tunnelPendingAsk.value = null
  tunnelBusy.value = false
  // 先注册监听再发起，确保进度/提问事件不漏
  removeTunnelProgress?.()
  removeTunnelAsk?.()
  removeTunnelProgress = window.freeCodex.onTunnelProgress((event) => {
    tunnelLogs.value.push(event as TunnelProgressEvent)
    void nextTick(() => {
      if (tunnelLogBox.value) tunnelLogBox.value.scrollTop = tunnelLogBox.value.scrollHeight
    })
  })
  removeTunnelAsk = window.freeCodex.onTunnelAsk((ask) => {
    tunnelPendingAsk.value = ask as TunnelAsk
  })
  tunnelWizardOpen.value = true
}

function closeTunnelWizard(): void {
  tunnelWizardOpen.value = false
  removeTunnelProgress?.()
  removeTunnelAsk?.()
  removeTunnelProgress = undefined
  removeTunnelAsk = undefined
}

/** 对话框被关闭（X / 遮罩 / 完成）：运行中先取消再清理监听 */
function onTunnelDialogOpenChange(open: boolean): void {
  if (!open) {
    if (tunnelPhase.value === 'running') void cancelTunnelSetup()
    closeTunnelWizard()
  }
}

async function runTunnelSetup(): Promise<void> {
  tunnelError.value = ''
  const domain = tunnelForm.value.domain.trim()
  if (!domain) {
    tunnelError.value = '请填写公网域名'
    return
  }
  tunnelPhase.value = 'running'
  tunnelLogs.value = []
  try {
    const result = (await window.freeCodex.startTunnelSetup({
      domain,
      tunnelName: tunnelForm.value.tunnelName.trim() || 'codex-mcp',
    })) as TunnelSetupResult
    tunnelResult.value = result
    tunnelPhase.value = 'done'
    // 主进程已写回配置；同步到本页表单（保留用户未保存的其它字段），并刷新网关状态
    if (config.value) {
      config.value.gateway = {
        ...config.value.gateway,
        publicEnabled: true,
        domain: result.domain,
        cloudflaredBin: result.cloudflaredBin,
        tunnelId: result.tunnelId,
        tunnelName: result.tunnelName,
        tunnelConfigPath: result.configPath,
      }
      config.value.cloudflare = {
        enabled: true,
        executable: result.cloudflaredBin,
        hostname: result.domain,
        tunnelId: result.tunnelId,
        configPath: result.configPath,
      }
    }
    await refreshGateway()
    if (result.gateway?.restartError) {
      toast.warning('Tunnel 创建完成，但 Gateway 重启失败', { description: result.gateway.restartError })
    } else if (result.gateway?.restarted) {
      toast.success('Tunnel 创建完成，Gateway 已自动重启', { description: `${result.domain} 已配置公网入口` })
    } else {
      toast.success('Tunnel 创建完成', { description: `${result.domain} 已配置公网入口` })
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message === '已取消') {
      closeTunnelWizard()
      return
    }
    tunnelError.value = message
    tunnelPhase.value = 'error'
  }
}

async function answerTunnelAsk(approved: boolean): Promise<void> {
  const ask = tunnelPendingAsk.value
  if (!ask) return
  tunnelPendingAsk.value = null
  try {
    await window.freeCodex.answerTunnelAsk(ask.id, approved)
  } catch (e) {
    tunnelError.value = e instanceof Error ? e.message : String(e)
    tunnelPhase.value = 'error'
  }
}

async function cancelTunnelSetup(): Promise<void> {
  tunnelBusy.value = true
  try {
    await window.freeCodex.cancelTunnelSetup()
  } catch {
    // 忽略：主进程侧以「已取消」拒绝 runTunnelSetup
  }
  tunnelBusy.value = false
}

function resetTunnelWizard(): void {
  tunnelPhase.value = 'form'
  tunnelLogs.value = []
  tunnelError.value = ''
  tunnelResult.value = null
}

function tunnelLogClass(kind: TunnelProgressEvent['kind']): string {
  switch (kind) {
    case 'success':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'warning':
      return 'text-amber-600 dark:text-amber-400'
    case 'error':
      return 'text-red-600 dark:text-red-400'
    default:
      return 'text-muted-foreground'
  }
}

// ---------- 向导步骤状态 ----------
const TUNNEL_STEPS = [
  { id: 'resolve-bin', label: '检查组件' },
  { id: 'login', label: '登录授权' },
  { id: 'tunnel', label: '创建隧道' },
  { id: 'dns', label: 'DNS 路由' },
  { id: 'write-config', label: '写配置' },
] as const

/** 当前执行到的步骤下标（按最后一条日志推导；-1 表示尚未开始） */
const tunnelStepIndex = computed(() => {
  const last = tunnelLogs.value[tunnelLogs.value.length - 1]
  if (!last) return -1
  return TUNNEL_STEPS.findIndex((s) => s.id === last.step)
})

function stepState(i: number): 'done' | 'current' | 'error' | 'pending' {
  if (tunnelPhase.value === 'done') return 'done'
  const current = tunnelStepIndex.value
  if (tunnelPhase.value === 'error') {
    if (i < current) return 'done'
    if (i === current) return 'error'
    return 'pending'
  }
  if (current < 0) return i === 0 ? 'current' : 'pending'
  if (i < current) return 'done'
  if (i === current) return 'current'
  return 'pending'
}

function stepCircleClass(i: number): string {
  switch (stepState(i)) {
    case 'done':
      return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-500'
    case 'current':
      return 'border-primary/50 bg-primary/10 text-primary'
    case 'error':
      return 'border-red-500/40 bg-red-500/10 text-red-500'
    default:
      return 'border-border bg-muted/40 text-muted-foreground'
  }
}

function stepLabelClass(i: number): string {
  return stepState(i) === 'pending' ? 'text-muted-foreground/70' : 'text-foreground'
}

/** 步骤 i 之后（i 与 i+1 之间）的连接线颜色 */
function connectorClass(i: number): string {
  if (tunnelPhase.value === 'done') return 'bg-emerald-500/50'
  return i < tunnelStepIndex.value ? 'bg-emerald-500/50' : 'bg-border'
}

/** 日志圆点颜色 */
function logDotClass(kind: TunnelProgressEvent['kind']): string {
  switch (kind) {
    case 'success':
      return 'bg-emerald-500'
    case 'warning':
      return 'bg-amber-500'
    case 'error':
      return 'bg-red-500'
    default:
      return 'bg-muted-foreground/50'
  }
}

// ---------- 连接密码（OAuth）----------
const hasPassword = ref(false)
const passwordInput = ref('')
const passwordError = ref('')
/** 输入框内密码默认星号显示，点击眼睛切换明文（供查看/复制） */
const showPasswordInput = ref(false)

async function refreshAuth(): Promise<void> {
  hasPassword.value = await window.freeCodex.auth.hasPassword()
  // 明文由 free-codex 本地保存，读出来展示/复制（codex-mcp 侧仍是哈希校验）
  const plain = await window.freeCodex.auth.getPassword()
  if (plain) passwordInput.value = plain
}

/** 复制输入框中的连接密码到剪贴板（Electron file:// 下 clipboard API 不可用时回退 execCommand） */
async function copyPasswordInput(): Promise<void> {
  const password = passwordInput.value
  if (!password) return
  try {
    await navigator.clipboard.writeText(password)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = password
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
  toast.success('密码已复制')
}

async function setPassword(): Promise<void> {
  passwordError.value = ''
  const password = passwordInput.value
  if (!password) {
    passwordError.value = '请输入连接密码'
    return
  }
  if (password.length < 12) {
    passwordError.value = '密码至少 12 个字符'
    return
  }
  try {
    await window.freeCodex.auth.setPassword(password)
    hasPassword.value = true
    // 设置成功后保留输入框明文，便于复制到 ChatGPT 连接设置
    toast.success('连接密码已设置')
  } catch (e) {
    passwordError.value = e instanceof Error ? e.message : String(e)
  }
}

async function generatePassword(): Promise<void> {
  passwordError.value = ''
  try {
    // 生成的密码直接填入输入框（默认星号，可点眼睛查看、复制）
    passwordInput.value = await window.freeCodex.auth.generatePassword()
  } catch (e) {
    passwordError.value = e instanceof Error ? e.message : String(e)
  }
}

// ---------- MCP 服务器管理 ----------
const mcpData = ref<McpListResult>({ mcpServers: {}, path: '', system: [] })
const showMcpForm = ref(false)
const mcpFormError = ref('')
const mcpForm = ref({ name: '', type: 'stdio' as 'stdio' | 'http', command: '', args: '', url: '', headers: '' })
/** 系统 MCP 开关状态（name → enabled） */
const systemMcpEnabled = ref<Record<string, boolean>>({})
const todosToggling = ref(false)

async function refreshMcp(): Promise<void> {
  mcpData.value = await window.freeCodex.mcp.list()
  systemMcpEnabled.value = Object.fromEntries((mcpData.value.system ?? []).map((s) => [s.name, s.enabled]))
}

function sysEnabled(name: string): boolean {
  return systemMcpEnabled.value[name] === true
}

/** 系统 MCP 开关（目前仅 todos）：启停 server + 热重载下游 + 注入开关 */
async function toggleSystemMcp(name: string, on: boolean): Promise<void> {
  if (name !== 'todos') return
  todosToggling.value = true
  try {
    const r = await window.freeCodex.todos.setEnabled(on)
    systemMcpEnabled.value[name] = r.enabled
    if (r.restartError) {
      toast.warning('todos 已保存，但 Gateway 未恢复', { description: r.restartError })
    } else if (r.enabled) {
      toast.success('todos 已开启：每轮向 ChatGPT 注入工作流要求')
    } else {
      toast.success('todos 已关闭：不再注入')
    }
  } catch (e) {
    toast.error('todos 切换失败', { description: e instanceof Error ? e.message : String(e) })
  } finally {
    todosToggling.value = false
  }
}

function openMcpCreate(): void {
  mcpForm.value = { name: '', type: 'stdio', command: '', args: '', url: '', headers: '' }
  mcpFormError.value = ''
  showMcpForm.value = true
}

function editMcp(name: string, server: McpServerEntry): void {
  mcpForm.value = {
    name,
    type: server.url ? 'http' : 'stdio',
    command: server.command || '',
    args: (server.args ?? []).join(' '),
    url: server.url || '',
    headers: Object.entries(server.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n'),
  }
  mcpFormError.value = ''
  showMcpForm.value = true
}

function parseHeaders(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return Object.keys(out).length ? out : undefined
}

async function saveMcp(): Promise<void> {
  mcpFormError.value = ''
  const name = mcpForm.value.name.trim()
  if (!name) {
    mcpFormError.value = '请填写名称'
    return
  }
  const server: McpServerEntry = {}
  if (mcpForm.value.type === 'http') {
    server.url = mcpForm.value.url.trim()
    server.headers = parseHeaders(mcpForm.value.headers)
  } else {
    server.command = mcpForm.value.command.trim()
    const args = mcpForm.value.args.trim().split(/\s+/).filter(Boolean)
    if (args.length) server.args = args
  }
  if (!server.url && !server.command) {
    mcpFormError.value = mcpForm.value.type === 'http' ? '请填写 URL' : '请填写命令'
    return
  }
  try {
    const result = await window.freeCodex.mcp.set(name, server)
    showMcpForm.value = false
    await refreshMcp()
    if (result.restartError) {
      toast.warning(`MCP 服务器「${name}」已保存，但 Gateway 重启失败`, { description: result.restartError })
    } else if (result.restarted) {
      toast.success(`MCP 服务器「${name}」已保存，Gateway 已自动重启`)
    } else {
      toast.success(`MCP 服务器「${name}」已保存`)
    }
  } catch (e) {
    mcpFormError.value = e instanceof Error ? e.message : String(e)
  }
}

async function deleteMcp(name: string): Promise<void> {
  if (!confirm(`确定删除 MCP 服务器「${name}」？`)) return
  try {
    const result = await window.freeCodex.mcp.delete(name)
    await refreshMcp()
    if (result.restartError) {
      toast.warning(`已删除「${name}」，但 Gateway 重启失败`, { description: result.restartError })
    } else if (result.restarted) {
      toast.success(`已删除「${name}」，Gateway 已自动重启`)
    } else {
      toast.success(`已删除「${name}」`)
    }
  } catch (e) {
    toast.error('删除失败', { description: e instanceof Error ? e.message : String(e) })
  }
}

// ---------- 技能管理 ----------
const skillData = ref<SkillLibraryResult | null>(null)
const skillFilter = ref('')
const skillTab = ref<'user' | 'project'>('user')
const showSkillForm = ref(false)
const editingSkill = ref<SkillEntry | null>(null)
const skillFormError = ref('')
const skillScope = ref<'user' | 'project'>('user')
const skillForm = ref({ name: '', description: '', instructions: '' })

const userSkills = computed(() => (skillData.value?.skills ?? []).filter(
  (s) => s.scope === 'user' && (!skillFilter.value || `${s.name} ${s.description}`.toLowerCase().includes(skillFilter.value.toLowerCase())),
))
const projectSkills = computed(() => (skillData.value?.skills ?? []).filter(
  (s) => s.scope === 'project' && (!skillFilter.value || `${s.name} ${s.description}`.toLowerCase().includes(skillFilter.value.toLowerCase())),
))

async function refreshSkills(): Promise<void> {
  skillData.value = await window.freeCodex.skills.list()
}

async function toggleSkill(skill: SkillEntry): Promise<void> {
  await window.freeCodex.skills.setEnabled([skill.name], !skill.enabled)
  await refreshSkills()
}

async function deleteSkill(skill: SkillEntry): Promise<void> {
  if (!confirm(`确定删除技能「${skill.name}」？\n（${skill.path}）`)) return
  await window.freeCodex.skills.delete(skill.name)
  await refreshSkills()
}

function openSkillCreate(scope: 'user' | 'project'): void {
  editingSkill.value = null
  skillScope.value = scope
  skillForm.value = { name: '', description: '', instructions: '' }
  skillFormError.value = ''
  showSkillForm.value = true
}

async function openSkillEdit(skill: SkillEntry): Promise<void> {
  try {
    const value = await window.freeCodex.skills.read(skill.name)
    skillForm.value = { name: skill.name, description: skill.description, instructions: value.instructions }
    editingSkill.value = skill
    skillScope.value = skill.scope
    skillFormError.value = ''
    showSkillForm.value = true
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

async function saveSkill(): Promise<void> {
  skillFormError.value = ''
  if (!skillForm.value.name.trim()) {
    skillFormError.value = '请填写技能名称'
    return
  }
  if (!skillForm.value.instructions.trim()) {
    skillFormError.value = '请填写指令（触发后注入给模型）'
    return
  }
  try {
    const input = {
      name: skillForm.value.name.trim(),
      description: skillForm.value.description.trim(),
      instructions: skillForm.value.instructions,
    }
    if (editingSkill.value) {
      await window.freeCodex.skills.update(editingSkill.value.name, {
        description: input.description,
        instructions: input.instructions,
      })
    } else {
      await window.freeCodex.skills.create(input, skillScope.value)
    }
    showSkillForm.value = false
    await refreshSkills()
  } catch (e) {
    skillFormError.value = e instanceof Error ? e.message : String(e)
  }
}

// ---------- ChatGPT 插件（连接器）：开发者模式 + freecodex 插件安装 ----------
/** 目标插件 = 本应用的 MCP 网关公网地址（取配置的 gateway.domain，与主进程 refreshDetectedPluginName 一致，不再写死） */
const FREECODEX_MCP_URL = computed(() => {
  const domain = config.value?.gateway?.domain?.trim()
  return domain ? `https://${domain}/mcp` : ''
})
const devMode = ref<{ developerMode: boolean; lockdownMode: boolean } | null>(null)
const devModeBusy = ref(false)
const pluginStatus = ref<{ found: boolean; name?: string; displayName?: string; appId?: string } | null>(null)
const pluginBusy = ref(false)
/** ChatGPT 登录状态（插件/开发者模式操作的前置条件） */
const loginState = ref<{ loggedIn: boolean; reason?: string } | null>(null)
const loginBusy = ref(false)
let loginTimer: ReturnType<typeof setInterval> | undefined

async function refreshLogin(): Promise<void> {
  try {
    loginState.value = await window.freeCodex.chatgpt.loginStatus()
  } catch {
    loginState.value = null
  }
}

/** 未登录 → 回到 AI 应用视图并打开登录页，轮询等待登录完成，成功后自动刷新开发者模式与插件状态 */
async function goLogin(): Promise<void> {
  loginBusy.value = true
  // 设置页里 ChatGPT 视图是隐藏的（原生 WebContentsView，见 App.vue 路由 watcher），
  // 必须恢复视图并切回首页，否则登录页在后台加载，用户看不到任何反应。
  await window.freeCodex.showActiveView().catch(() => undefined)
  await router.push('/').catch(() => undefined)
  const r = (await window.freeCodex.chatgpt.openLogin().catch(() => null)) as { ok?: boolean; error?: string } | null
  if (!r || r.ok !== true) {
    loginBusy.value = false
    toast.error('无法打开登录页', { description: r?.error ?? 'ChatGPT 视图不可用' })
    return
  }
  if (loginTimer) clearInterval(loginTimer)
  loginTimer = setInterval(async () => {
    try {
      const s = await window.freeCodex.chatgpt.loginStatus()
      loginState.value = s
      if (s.loggedIn) {
        if (loginTimer) clearInterval(loginTimer)
        loginTimer = undefined
        loginBusy.value = false
        toast.success('已登录 ChatGPT')
        void refreshDevMode()
        void refreshPlugin()
      }
    } catch {
      /* 继续轮询 */
    }
  }, 3000)
}

async function refreshDevMode(): Promise<void> {
  try {
    devMode.value = await window.freeCodex.chatgpt.devModeStatus()
  } catch (err) {
    devMode.value = null
  }
}

/** 未登录 → 引导登录（应用内 ChatGPT 视图）并返回 false；已登录返回 true */
async function ensureLoggedIn(): Promise<boolean> {
  if (loginState.value?.loggedIn) return true
  toast.info('请先在 ChatGPT 视图登录', { description: '正在为你打开登录页…' })
  await goLogin()
  return false
}

async function ensureDevMode(): Promise<void> {
  if (!(await ensureLoggedIn())) return
  devModeBusy.value = true
  try {
    const r = await window.freeCodex.chatgpt.ensureDevMode()
    if (r.ok) toast.success(r.developerMode ? '开发者模式已开启' : '开发者模式已就绪')
    else toast.warning(r.message ?? '无法开启开发者模式')
    await refreshDevMode()
  } catch (err) {
    toast.error('开启开发者模式失败', { description: err instanceof Error ? err.message : String(err) })
  } finally {
    devModeBusy.value = false
  }
}

async function refreshPlugin(): Promise<void> {
  if (!(await ensureLoggedIn())) return
  pluginBusy.value = true
  try {
    await silentRefreshPlugin()
  } catch (err) {
    pluginStatus.value = null
    toast.warning('无法检测插件状态', { description: err instanceof Error ? err.message : String(err) })
  } finally {
    pluginBusy.value = false
  }
}

/** 静默刷新插件状态（定时轮询用，不弹登录引导、不打扰） */
async function silentRefreshPlugin(): Promise<void> {
  if (!loginState.value?.loggedIn || !FREECODEX_MCP_URL.value) return
  try {
    const p = await window.freeCodex.chatgpt.findPlugin({ url: FREECODEX_MCP_URL.value })
    pluginStatus.value = p
      ? { found: true, name: p.name, displayName: p.displayName, appId: p.canonicalAppId }
      : { found: false }
  } catch {
    /* 静默失败，等下一轮 */
  }
}

/** 一键安装插件：无 OAuth 自动直连；OAuth 自动打开授权页填密码提交，需要密码时弹窗让用户输入/自动生成 */
async function installPlugin(): Promise<void> {
  if (!(await ensureLoggedIn())) return
  pluginBusy.value = true
  try {
    const r = await window.freeCodex.chatgpt.installMcp({ url: FREECODEX_MCP_URL.value, name: 'free-codex' })
    await handleInstallResult(r)
  } catch (err) {
    toast.error('安装失败', { description: err instanceof Error ? err.message : String(err) })
  } finally {
    pluginBusy.value = false
  }
}

type InstallResult = {
  ok?: boolean
  installed?: boolean
  oauthUrl?: string
  needPassword?: boolean
  wrongPassword?: boolean
  message?: string
}

/** 处理安装结果：需要密码 → 弹窗；授权页没走通 → 切回首页让用户看到已打开的页面；成功/失败 → toast */
async function handleInstallResult(r: InstallResult | null): Promise<void> {
  if (!r) {
    toast.error('安装失败', { description: '无响应' })
    return
  }
  if (r.ok && r.installed) {
    toast.success('freecodex 插件已安装')
  } else if (r.ok) {
    toast.success('连接已建立，正在同步插件状态…')
  } else if (r.needPassword) {
    installPasswordHint.value = ''
    installPasswordOpen.value = true
    return
  } else if (r.wrongPassword) {
    installPasswordHint.value = '连接密码不正确，请重试'
    installPasswordOpen.value = true
    return
  } else if (r.oauthUrl) {
    // 授权页没走通 → 切回首页，让用户看到已打开的页面手动完成
    await window.freeCodex.showActiveView().catch(() => undefined)
    await router.push('/').catch(() => undefined)
    toast.warning(r.message ?? '授权页没有走通，请在打开的页面手动完成')
  } else {
    toast.error('安装失败', { description: r.message ?? '未知错误' })
  }
  await refreshPlugin()
}

// ---------- 授权连接密码弹窗（OAuth 需要；密码只存哈希，需用户输入一次，或自动生成新密码） ----------
const installPasswordOpen = ref(false)
const installPassword = ref('')
const installPasswordHint = ref('')
const installPasswordBusy = ref(false)

/** 弹窗确认：输入密码或自动生成新密码，然后用它继续自动授权 */
async function confirmInstallPassword(generateNew: boolean): Promise<void> {
  if (installPasswordBusy.value) return
  installPasswordBusy.value = true
  try {
    let password = installPassword.value.trim()
    if (generateNew) {
      password = await window.freeCodex.auth.generatePassword()
      await window.freeCodex.auth.setPassword(password)
      toast.success('已生成新的连接密码（用于本次自动授权）')
    }
    if (!password) {
      installPasswordHint.value = '请填写连接密码，或点击「自动生成并使用」'
      return
    }
    installPasswordOpen.value = false
    const r = await window.freeCodex.chatgpt.installMcp({ url: FREECODEX_MCP_URL.value, name: 'free-codex', password })
    await handleInstallResult(r)
  } catch (err) {
    toast.error('安装失败', { description: err instanceof Error ? err.message : String(err) })
  } finally {
    installPasswordBusy.value = false
  }
}

function shortAppId(id?: string): string {
  return id && id.length > 20 ? `${id.slice(0, 20)}…` : (id ?? '')
}

/** 插件状态定时轮询（10 分钟静默刷新；点「检测」随时手动查） */
let pluginTimer: ReturnType<typeof setInterval> | undefined

onMounted(async () => {
  // 各加载独立兜底：单个 IPC 失败不把整个设置页刷白（此前任一 await 抛错会跳过全部后续加载）
  await window.freeCodex
    .getConfig()
    .then((c) => { config.value = c })
    .catch(() => toast.error('读取配置失败'))
  await refreshMcp().catch(() => toast.error('读取 MCP 服务器失败'))
  await refreshSkills().catch(() => toast.error('读取技能失败'))
  await loadToolEnablement().catch(() => undefined) // 先加载禁用列表，refreshGateway 合并显示被禁用的工具
  await refreshGateway().catch(() => undefined)
  await refreshAuth().catch(() => undefined)
  // 先确认登录，已登录才拉开发者模式/插件状态
  await refreshLogin().catch(() => undefined)
  if (loginState.value?.loggedIn) {
    void refreshDevMode().catch(() => undefined)
    void refreshPlugin().catch(() => undefined)
  }
  if (!pluginTimer) {
    pluginTimer = setInterval(() => void silentRefreshPlugin(), 600_000)
  }
})

onUnmounted(() => {
  if (loginTimer) clearInterval(loginTimer)
  if (pluginTimer) {
    clearInterval(pluginTimer)
    pluginTimer = undefined
  }
  // 向导监听器泄漏：页面卸载时若有进行中的向导（主进程 tunnel:setup 仍在跑），先取消再清理监听
  if (tunnelWizardOpen.value) {
    if (tunnelPhase.value === 'running') void cancelTunnelSetup()
    closeTunnelWizard()
  }
})
</script>


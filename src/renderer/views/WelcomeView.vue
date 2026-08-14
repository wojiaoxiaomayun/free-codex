<template>
  <div class="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-10">
    <div class="w-full max-w-xl">
      <!-- 头部 -->
      <div class="mb-6 text-center">
        <h1 class="text-2xl font-semibold">欢迎使用 Free Codex</h1>
        <p class="mt-1 text-sm text-muted-foreground">四步完成首次配置，让 ChatGPT 连接你电脑上的 MCP 网关。</p>
      </div>

      <!-- 步骤指示 -->
      <div class="mb-6 flex items-center justify-center gap-2">
        <template v-for="(s, i) in steps" :key="s.key">
          <div class="flex items-center gap-2">
            <div
              class="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium"
              :class="
                currentStep === i
                  ? 'bg-primary text-primary-foreground'
                  : i < currentStep
                    ? 'bg-emerald-500 text-white'
                    : 'bg-muted text-muted-foreground'
              "
            >
              {{ i < currentStep ? '✓' : i + 1 }}
            </div>
            <span class="text-xs" :class="currentStep === i ? 'font-medium text-foreground' : 'text-muted-foreground'">
              {{ s.label }}
            </span>
          </div>
          <div v-if="i < steps.length - 1" class="h-px w-8 bg-border" />
        </template>
      </div>

      <!-- Step 1: 选择项目（网关运行需要项目目录） -->
      <Card v-if="currentStep === 0" class="mb-6">
        <CardHeader class="pb-3">
          <CardTitle class="text-base">选择项目</CardTitle>
          <CardDescription>选择一个项目目录作为工作区。MCP 网关启动、文件读写与工具调用都基于它。</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          <div class="flex items-center gap-2">
            <Button @click="pickProject">
              <FolderOpenIcon class="mr-1 size-4" />
              选择项目文件夹
            </Button>
            <span v-if="projectPath" class="truncate font-mono text-xs text-muted-foreground">{{ projectPath }}</span>
          </div>
          <p v-if="projectPath" class="text-sm font-medium text-emerald-600 dark:text-emerald-400">项目已选择 ✓</p>
        </CardContent>
      </Card>

      <!-- Step 2: 连接配置 -->
      <Card v-else-if="currentStep === 1" class="mb-6">
        <CardHeader class="pb-3">
          <CardTitle class="text-base">连接配置</CardTitle>
          <CardDescription>本地网关监听的地址与端口，以及 ChatGPT 连接时验证用的连接密码。</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="welcome-host" class="text-xs font-medium">监听地址</label>
              <Input id="welcome-host" v-model="form.host" class="mt-1" placeholder="127.0.0.1" />
            </div>
            <div>
              <label for="welcome-port" class="text-xs font-medium">端口</label>
              <Input id="welcome-port" v-model.number="form.port" class="mt-1" type="number" placeholder="3291" />
            </div>
          </div>
          <div>
            <label for="welcome-password" class="text-xs font-medium">连接密码</label>
            <div class="mt-1 flex gap-2">
              <Input id="welcome-password" v-model="form.password" type="password" class="flex-1" placeholder="≥ 12 字符" />
              <Button variant="outline" size="sm" @click="generatePassword">生成随机</Button>
              <Button variant="outline" size="sm" :disabled="!form.password" title="复制密码" @click="copyPassword">
                <CopyIcon class="size-3.5" />
              </Button>
            </div>
            <p class="mt-1 text-xs text-muted-foreground">
              密码仅保存在本机，可随时在设置里查看/复制；已生成或设置的密码会在此展示。
            </p>
          </div>
        </CardContent>
      </Card>

      <!-- Step 3: Cloudflare 公网 -->
      <Card v-else-if="currentStep === 2" class="mb-6">
        <CardHeader class="pb-3">
          <CardTitle class="text-base">公网连接（Cloudflare）</CardTitle>
          <CardDescription>用 Cloudflare Tunnel 把本地网关暴露到公网，ChatGPT 才能远程连上。首次运行会打开浏览器登录 Cloudflare 授权。</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          <div>
            <label for="welcome-domain" class="text-xs font-medium">公网域名</label>
            <div class="mt-1 flex gap-2">
              <Input id="welcome-domain" v-model="form.domain" class="flex-1" placeholder="mcp.example.com" />
              <Button :disabled="tunnelBusy || !form.domain.trim()" @click="runTunnelSetup">
                <RocketIcon class="mr-1 size-3.5" />
                {{ tunnelBusy ? '创建中…' : '一键创建' }}
              </Button>
            </div>
            <p class="mt-1 text-xs text-muted-foreground">域名需要已在你的 Cloudflare 账号里接入（NS 指向 Cloudflare）。</p>
          </div>

          <!-- 向导进度 -->
          <div v-if="tunnelLogs.length" class="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-border/60 bg-muted/40 p-3">
            <div v-for="(log, i) in tunnelLogs" :key="i" class="text-xs" :class="logColor(log.kind)">
              {{ log.message }}
            </div>
          </div>

          <!-- 向导确认问题 -->
          <div v-if="pendingAsk" class="flex flex-col gap-2 rounded-md border border-border/60 p-3">
            <p class="text-sm">{{ pendingAsk.question }}</p>
            <div class="flex justify-end gap-2">
              <Button variant="ghost" size="sm" @click="answerAsk(false)">取消</Button>
              <Button size="sm" @click="answerAsk(true)">确认</Button>
            </div>
          </div>

          <p v-if="publicReady" class="text-sm font-medium text-emerald-600 dark:text-emerald-400">公网配置已完成 ✓</p>
        </CardContent>
      </Card>

      <!-- Step 3: ChatGPT 登录 -->
      <Card v-else class="mb-6">
        <CardHeader class="pb-3">
          <CardTitle class="text-base">登录 ChatGPT</CardTitle>
          <CardDescription>在应用内置的 ChatGPT 视图中登录，供插件安装与工具调用使用。</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <div class="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
            <div class="flex items-center gap-2">
              <Badge :variant="loggedIn ? 'default' : 'secondary'">{{ loggedIn ? '已登录' : '未登录' }}</Badge>
              <span class="text-xs text-muted-foreground">登录后即可安装 freecodex 插件</span>
            </div>
            <Button v-if="!loggedIn" size="sm" :disabled="loginBusy" @click="goLogin">{{ loginBusy ? '等待登录…' : '前往登录' }}</Button>
          </div>
          <p class="text-xs text-muted-foreground">
            💡 <span class="font-medium text-foreground/80">登录完成后，请到「设置 → ChatGPT 插件」中安装 freecodex 插件</span>，并在「公网配置」里确保网关已启动。
          </p>
        </CardContent>
      </Card>

      <!-- 底部按钮 -->
      <div class="flex items-center justify-between">
        <button class="text-xs text-muted-foreground hover:underline" @click="finish">跳过引导，直接进入</button>
        <div class="flex gap-2">
          <Button v-if="currentStep > 0" variant="ghost" @click="currentStep--">上一步</Button>
          <Button v-if="currentStep === 0" :disabled="!projectPath" @click="currentStep++">下一步</Button>
          <Button v-else-if="currentStep === 1" :disabled="!form.password.trim()" @click="saveStep1">保存并继续</Button>
          <Button v-else-if="currentStep === 2" :disabled="!publicReady" @click="currentStep++">下一步</Button>
          <Button v-else @click="finish">开始使用</Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { CopyIcon, FolderOpenIcon, RocketIcon } from 'lucide-vue-next'
import { toast } from '@/lib/toast-bridge'

const router = useRouter()

const steps = [
  { key: 'project', label: '项目' },
  { key: 'ip', label: '连接配置' },
  { key: 'cloudflare', label: '公网' },
  { key: 'chatgpt', label: 'ChatGPT' },
]
const currentStep = ref(0)

// ---------- 表单 ----------
const form = ref({ host: '127.0.0.1', port: 3291, password: '', domain: '' })
const projectPath = ref('')
const plainPassword = ref('')
const publicReady = ref(false)
const loggedIn = ref(false)
const loginBusy = ref(false)

onMounted(async () => {
  const cfg = await window.freeCodex.getConfig()
  projectPath.value = cfg.projectRoot || ''
  form.value.host = cfg.gateway.host || '127.0.0.1'
  form.value.port = cfg.gateway.port || 3291
  form.value.domain = cfg.gateway.domain || ''
  plainPassword.value = (await window.freeCodex.auth.getPassword()) ?? ''
  form.value.password = plainPassword.value
  publicReady.value = !!cfg.gateway.domain && !!cfg.gateway.tunnelId
  // 登录状态
  await refreshLogin()
  void refreshPublicReady()
})

async function refreshLogin(): Promise<void> {
  try {
    loggedIn.value = (await window.freeCodex.chatgpt.loginStatus()).loggedIn
  } catch {
    loggedIn.value = false
  }
}

async function refreshPublicReady(): Promise<void> {
  const cfg = await window.freeCodex.getConfig()
  publicReady.value = !!cfg.gateway.domain && !!cfg.gateway.tunnelId
}

// ---------- Step 1: 连接配置 ----------
async function generatePassword(): Promise<void> {
  form.value.password = await window.freeCodex.auth.generatePassword()
  plainPassword.value = form.value.password
}

async function copyPassword(): Promise<void> {
  if (!form.value.password) return
  try {
    await navigator.clipboard.writeText(form.value.password)
    toast.success('密码已复制')
  } catch {
    toast.error('复制失败，请手动复制')
  }
}

/** 选择项目目录（网关运行需要） */
async function pickProject(): Promise<void> {
  const path = await window.freeCodex.chooseProject()
  if (path) {
    projectPath.value = path
    const cfg = await window.freeCodex.getConfig()
    cfg.projectRoot = path
    const result = await window.freeCodex.saveConfig(cfg)
    if (result.restartError) toast.warning('配置已保存，但网关重启失败', { description: result.restartError })
    toast.success('项目已选择')
  }
}

async function saveStep1(): Promise<void> {
  try {
    const cfg = await window.freeCodex.getConfig()
    cfg.gateway.host = form.value.host.trim() || '127.0.0.1'
    cfg.gateway.port = Number(form.value.port) || 3291
    const result = await window.freeCodex.saveConfig(cfg)
    if (result.restartError) toast.warning('配置已保存，但网关重启失败', { description: result.restartError })
    // 密码：生成/设置后明文已在主进程保存
    await window.freeCodex.auth.setPassword(form.value.password)
    plainPassword.value = form.value.password
    currentStep.value = 2
    toast.success('连接配置已保存')
  } catch (e) {
    toast.error('保存失败', { description: e instanceof Error ? e.message : String(e) })
  }
}

// ---------- Step 2: Cloudflare 一键创建 ----------
const tunnelBusy = ref(false)
const tunnelLogs = ref<{ kind: string; message: string }[]>([])
const pendingAsk = ref<{ id: number; question: string } | null>(null)
let unsubscribeProgress: (() => void) | undefined
let unsubscribeAsk: (() => void) | undefined

onMounted(() => {
  unsubscribeProgress = window.freeCodex.onTunnelProgress((ev) => {
    const e = ev as { kind: string; message: string }
    tunnelLogs.value.push({ kind: e.kind, message: e.message })
  })
  unsubscribeAsk = window.freeCodex.onTunnelAsk((ask) => {
    pendingAsk.value = ask as { id: number; question: string }
  })
})

onUnmounted(() => {
  unsubscribeProgress?.()
  unsubscribeAsk?.()
})

function logColor(kind: string): string {
  if (kind === 'error') return 'text-red-500'
  if (kind === 'success') return 'text-emerald-500'
  if (kind === 'warning') return 'text-yellow-500'
  return 'text-muted-foreground'
}

async function runTunnelSetup(): Promise<void> {
  tunnelBusy.value = true
  tunnelLogs.value = []
  try {
    const result = await window.freeCodex.startTunnelSetup({
      domain: form.value.domain.trim(),
      tunnelName: 'codex-mcp',
    })
    tunnelLogs.value.push({ kind: 'success', message: `Tunnel 创建完成：${result.domain}` })
    publicReady.value = true
    toast.success('公网配置已完成')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg !== '已取消') tunnelLogs.value.push({ kind: 'error', message: msg })
  } finally {
    tunnelBusy.value = false
  }
}

async function answerAsk(approved: boolean): Promise<void> {
  if (!pendingAsk.value) return
  await window.freeCodex.answerTunnelAsk(pendingAsk.value.id, approved)
  pendingAsk.value = null
}

// ---------- Step 3: ChatGPT 登录 ----------
/** 前往登录：欢迎页上 ChatGPT 原生视图是隐藏的，必须切回首页才能看到登录页；登录即视为完成引导 */
async function goLogin(): Promise<void> {
  loginBusy.value = true
  await window.freeCodex.showActiveView().catch(() => undefined)
  await router.push('/').catch(() => undefined)
  await window.freeCodex.onboardingDone().catch(() => undefined)
  await window.freeCodex.chatgpt.openLogin().catch(() => undefined)
}

/** 跳过或完成 → 标记引导完成、启动 MCP 网关（已选项目）并进入主界面 */
async function finish(): Promise<void> {
  await window.freeCodex.onboardingDone().catch(() => undefined)
  // 配置完成 → 自动启动 MCP 网关（需要项目目录；已运行则 start 幂等）
  if (projectPath.value) {
    try {
      await window.freeCodex.start()
      toast.success('MCP 网关已启动')
    } catch (e) {
      toast.error('网关启动失败', { description: e instanceof Error ? e.message : String(e) })
    }
  }
  router.push('/')
}
</script>

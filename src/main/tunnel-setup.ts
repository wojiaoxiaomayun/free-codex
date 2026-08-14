/**
 * 一键创建 Cloudflare Tunnel（free-codex 版）
 *
 * 复用 codex-mcp 的 dist 模块（bin 探测 / 命令执行 / yml 读写 / managed-tool 安装），
 * 只把终端交互（确认对话框）换成 IPC 往返，其余流程与 codex-mcp `codex-mcp tunnel` 一致：
 *   1. 找/装 cloudflared 二进制（找不到时自动下载 codex-mcp 内置的 pinned 版本）
 *   2. 登录 Cloudflare（cert.pem 落在 codex-mcp 的 managed 目录 ~/.codex-mcp/cloudflare/.cloudflared/）
 *   3. 创建/复用 Tunnel（同名复用，缺凭据时确认后重建）
 *   4. 域名 DNS 路由（冲突时确认后 --overwrite-dns）
 *   5. 写 cloudflared.yml 到 free-codex 的 userData（Tunnel 凭据/证书仍由 codex-mcp 运行模块托管在 managed 目录）
 *
 * 注意：codex-mcp 的 runCloudflared 会把 HOME/USERPROFILE 指到 managed 目录（~/.codex-mcp/cloudflare），
 * 所以管理命令必须像 codex-mcp 自身 CLI 一样显式带 --origincert，登录也必须把 cert.pem 写进 managed 目录，
 * 否则 cloudflared 找不到 origin cert（"Cannot determine default origin certificate path"）。
 */

import { app } from 'electron'
import { spawn } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveCname } from 'node:dns/promises'

// ------------------------------------------------------------
// codex-mcp 运行时模块（宽松类型，与 mcp-gateway.ts 同款做法）
// ------------------------------------------------------------

type CloudflaredBinModule = {
  suggestCloudflaredBin: (configured?: string) => Promise<string>
  probeCloudflaredVersion: (bin: string) => Promise<string>
}

type CloudflaredExecModule = {
  runCloudflared: (
    bin: string,
    args: string[],
    options?: { timeoutMs?: number; allowFailure?: boolean },
  ) => Promise<{ code: number | null; stdout: string; stderr: string }>
  /** 与 runCloudflared 一致的子进程环境：HOME/USERPROFILE 指到 managed 目录、剔除 TUNNEL_* 变量 */
  cloudflaredChildEnv: () => Record<string, string | undefined>
}

type CloudflaredYmlModule = {
  getCredentialsPath: (tunnelId: string) => string
  writeCloudflaredYml: (
    input: { tunnelId: string; credentialsFile: string; hostname: string; serviceUrl: string },
    filePath?: string,
  ) => void
}

type ManagedToolsModule = {
  ensureManagedTool: (tool: 'cloudflared') => Promise<{ tool: string; label: string; version: string; path: string; installed: boolean }>
}

/** Cloudflare 账号/登录凭据管理（managed 目录 ~/.codex-mcp/cloudflare/.cloudflared） */
type CloudflareAccountModule = {
  /** managed 目录里的 cert.pem 路径（--origincert 指向这里） */
  getCloudflareOriginCertPath: () => string
  /** managed cert.pem 是否存在且可解析（有效登录） */
  hasManagedCloudflareLogin: () => boolean
  /** 旧版系统级 ~/.cloudflared/cert.pem */
  getLegacyCloudflareOriginCertPath: () => string
  /** 把旧 ~/.cloudflared/<id>.json 凭据（连同 cert，同账号才迁移）搬到 managed 目录 */
  migrateLegacyCloudflareState: (tunnelId?: string) => { certMigrated: boolean; credentialsMigrated: boolean }
}

type TunnelModules = {
  bin: CloudflaredBinModule
  exec: CloudflaredExecModule
  yml: CloudflaredYmlModule
  tools: ManagedToolsModule
  cloudflareAccount: CloudflareAccountModule
}

const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>

async function loadTunnelModules(): Promise<TunnelModules> {
  const [bin, exec, yml, tools, cloudflareAccount] = await Promise.all([
    nativeImport('@meesii/codex-mcp/dist/tunnel/bin.js'),
    nativeImport('@meesii/codex-mcp/dist/tunnel/exec.js'),
    nativeImport('@meesii/codex-mcp/dist/tunnel/yml.js'),
    nativeImport('@meesii/codex-mcp/dist/managed-tools/install.js'),
    nativeImport('@meesii/codex-mcp/dist/tunnel/cloudflare-account.js'),
  ])
  return { bin, exec, yml, tools, cloudflareAccount }
}

/**
 * 手动配置公网时，公网字段齐全但没有隧道配置文件 → 自动生成 userData/cloudflared.yml
 * （内容与「一键创建」向导第 5 步一致；Tunnel 凭据缺失时抛错，由调用方决定保留原路径）。
 */
export async function generateTunnelConfigFile(input: {
  domain: string
  tunnelId: string
  serviceHost: string
  servicePort: number
}): Promise<string> {
  const modules = await loadTunnelModules()
  const configPath = join(app.getPath('userData'), 'cloudflared.yml')
  const credentialsFile = modules.yml.getCredentialsPath(input.tunnelId)
  if (!existsSync(credentialsFile)) {
    throw new Error(`没有找到 Tunnel 凭据：${credentialsFile}，请先用「一键创建」或手动创建 Tunnel`)
  }
  modules.yml.writeCloudflaredYml(
    {
      tunnelId: input.tunnelId,
      credentialsFile,
      hostname: input.domain,
      serviceUrl: `http://${input.serviceHost || '127.0.0.1'}:${input.servicePort}`,
    },
    configPath,
  )
  return configPath
}

/** 探测可用的 cloudflared（managed 目录 → PATH → codex-mcp 包内）；用于设置页「自动检测」，找不到抛错 */
export async function detectCloudflaredBin(configured?: string): Promise<string> {
  const modules = await loadTunnelModules()
  const found = await modules.bin.suggestCloudflaredBin(configured)
  if (found) return found
  throw new Error('未找到 cloudflared，可点「一键创建」自动下载，或用「浏览」手动选择')
}

/** 确保 cloudflared 可用：已有 → 直接返回；没有 → 自动下载 codex-mcp pinned 版本（设置页「下载」按钮） */
export async function ensureCloudflaredBin(configured?: string): Promise<{ path: string; downloaded: boolean; version?: string }> {
  const found = await detectCloudflaredBin(configured).catch(() => '')
  if (found) return { path: found, downloaded: false }
  const modules = await loadTunnelModules()
  const installed = await modules.tools.ensureManagedTool('cloudflared')
  return { path: installed.path, downloaded: true, version: installed.version }
}

// ------------------------------------------------------------
// 类型定义
// ------------------------------------------------------------

/** 向导进度日志（推送给渲染层） */
export type TunnelProgressEvent = {
  kind: 'info' | 'success' | 'warning' | 'error'
  /** 阶段标识：resolve-bin / login / tunnel / dns / write-config */
  step: string
  message: string
}

/** 需要用户确认的问题（渲染层弹确认框后回传） */
export type TunnelAsk = {
  id: number
  question: string
  defaultValue: boolean
}

export type TunnelSetupInput = {
  /** 公网域名（mcp.example.com） */
  domain: string
  /** Tunnel 名称 */
  tunnelName: string
  /** 本机服务地址（来自 gateway 配置） */
  serviceHost: string
  servicePort: number
  /** 已有 cloudflared 路径（可选，用于探测复用） */
  configuredBin?: string
}

export type TunnelSetupResult = {
  domain: string
  cloudflaredBin: string
  tunnelId: string
  tunnelName: string
  /** 写好的 cloudflared.yml 路径 */
  configPath: string
}

const TUNNEL_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** 域名规范化：去协议/去尾点/去大小写，非法域名抛错 */
export function normalizeHostname(value: string): string {
  const text = value.trim()
  if (!text) throw new Error('请填写公网域名')
  let parsed: URL
  try {
    parsed = text.includes('://') ? new URL(text) : new URL(`https://${text}`)
  } catch {
    throw new Error(`域名格式不正确：${value}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`域名格式不正确：${value}`)
  }
  if (parsed.username || parsed.password) {
    throw new Error(`域名格式不正确：${value}`)
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname || !hostname.includes('.') || hostname.length > 253) {
    throw new Error(`域名格式不正确：${value}`)
  }
  for (const label of hostname.split('.')) {
    if (label.length === 0 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) {
      throw new Error(`域名格式不正确：${value}`)
    }
  }
  return hostname
}

// ------------------------------------------------------------
// 向导协调器
// ------------------------------------------------------------

export class TunnelSetupCoordinator {
  private askSeq = 0
  private aborted = false
  /** 登录阶段的 cloudflared 子进程（取消时清理） */
  private loginChild?: ReturnType<typeof spawn>

  constructor(
    private deps: {
      /** 向用户确认（GUI：IPC 往返弹确认框） */
      ask: (ask: TunnelAsk) => Promise<boolean>
      /** 进度日志推送 */
      onProgress: (event: TunnelProgressEvent) => void
    },
  ) {}

  /** 请求中止（下一个检查点抛出「已取消」；登录中的子进程会被终止） */
  cancel(): void {
    this.aborted = true
    this.loginChild?.kill()
  }

  private checkAborted(): void {
    if (this.aborted) throw new Error('已取消')
  }

  async run(input: TunnelSetupInput): Promise<TunnelSetupResult> {
    const domain = normalizeHostname(input.domain)
    const tunnelName = input.tunnelName.trim() || 'codex-mcp'
    const modules = await loadTunnelModules()

    // 1) cloudflared 二进制：已有 → 探测；没有 → 自动下载 pinned 版本
    const bin = await this.resolveBin(modules, input.configuredBin)
    this.checkAborted()

    // 2) 登录 Cloudflare（浏览器 OAuth；cert.pem 落到 managed 目录，与后续命令的 HOME 覆盖一致）
    await this.ensureLogin(modules, bin)
    this.checkAborted()

    // 2.5) 迁移旧 ~/.cloudflared 的 Tunnel 凭据到 managed 目录（同名 Tunnel 可直接复用，免删除重建）
    await this.migrateLegacyCredentials(modules)

    // 3) 创建/复用 Tunnel
    const tunnelId = await this.ensureTunnelCreated(modules, bin, tunnelName)
    this.checkAborted()

    // 4) 域名 DNS 路由
    await this.ensureDnsRoute(modules, bin, tunnelName, domain, tunnelId)
    this.checkAborted()

    // 5) 写 cloudflared.yml（free-codex userData 自持）
    const configPath = join(app.getPath('userData'), 'cloudflared.yml')
    const credentialsFile = modules.yml.getCredentialsPath(tunnelId)
    if (!existsSync(credentialsFile)) {
      throw new Error(`没有找到 Tunnel 凭据：${credentialsFile}，请重试`)
    }
    modules.yml.writeCloudflaredYml(
      {
        tunnelId,
        credentialsFile,
        hostname: domain,
        serviceUrl: `http://${input.serviceHost || '127.0.0.1'}:${input.servicePort}`,
      },
      configPath,
    )
    this.progress('write-config', 'success', `Tunnel 配置已保存：${configPath}`)

    return { domain, cloudflaredBin: bin, tunnelId, tunnelName, configPath }
  }

  // ------------------------------------------------------------

  private progress(step: string, kind: TunnelProgressEvent['kind'], message: string) {
    this.deps.onProgress({ kind, step, message })
  }

  /** 确认式提问（拒绝即中止整个向导，与 codex-mcp CLI 行为一致） */
  private async confirm(question: string, defaultValue = false): Promise<void> {
    const approved = await this.deps.ask({ id: ++this.askSeq, question, defaultValue })
    if (!approved) throw new Error('已取消')
  }

  /**
   * 管理命令公共前缀。runCloudflared 会把 HOME/USERPROFILE 指到 managed 目录（~/.codex-mcp/cloudflare），
   * 所以必须像 codex-mcp CLI 一样显式传 --origincert，否则 cloudflared 找不到 cert.pem。
   */
  private managementArgs(modules: TunnelModules, ...rest: string[]): string[] {
    return ['tunnel', '--origincert', modules.cloudflareAccount.getCloudflareOriginCertPath(), ...rest]
  }

  private async resolveBin(modules: TunnelModules, configured?: string): Promise<string> {
    this.progress('resolve-bin', 'info', '正在检查 cloudflared…')
    const found = await modules.bin.suggestCloudflaredBin(configured)
    if (found) {
      const version = await modules.bin.probeCloudflaredVersion(found)
      this.progress('resolve-bin', 'success', `cloudflared 已就绪：${version}`)
      return found
    }
    this.progress('resolve-bin', 'info', '未找到 cloudflared，正在自动下载…')
    const installed = await modules.tools.ensureManagedTool('cloudflared')
    this.progress('resolve-bin', 'success', `cloudflared 已准备：${installed.version}`)
    return installed.path
  }

  /**
   * 登录 Cloudflare：managed 目录有有效 cert.pem 跳过；旧 ~/.cloudflared/cert.pem 有则复用；
   * 否则跑 `cloudflared tunnel login`（自动打开浏览器，写进 managed 目录）。
   */
  private async ensureLogin(modules: TunnelModules, bin: string): Promise<void> {
    const certPath = modules.cloudflareAccount.getCloudflareOriginCertPath()
    if (modules.cloudflareAccount.hasManagedCloudflareLogin()) {
      this.progress('login', 'success', '已登录 Cloudflare，无需重复登录')
      return
    }
    // 旧系统级登录凭据 → 复制到 managed 目录（后续管理命令用 --origincert 指向它，避免重复 OAuth）
    const legacyCert = modules.cloudflareAccount.getLegacyCloudflareOriginCertPath()
    if (existsSync(legacyCert) && !existsSync(certPath)) {
      mkdirSync(dirname(certPath), { recursive: true })
      copyFileSync(legacyCert, certPath)
      if (process.platform !== 'win32') chmodSync(certPath, 0o600)
      if (modules.cloudflareAccount.hasManagedCloudflareLogin()) {
        this.progress('login', 'success', '已复用 ~/.cloudflared 的现有登录凭据')
        return
      }
      // 旧证书无效 → 删掉，走重新登录
      rmSync(certPath, { force: true })
    }
    this.progress('login', 'info', '正在打开浏览器，请登录 Cloudflare 并完成授权…')

    await new Promise<void>((resolve, reject) => {
      // 与 runCloudflared 一致的环境（HOME/USERPROFILE 指向 managed 目录），登录凭据落到 --origincert 同路径
      const child = spawn(bin, ['tunnel', 'login'], { windowsHide: true, env: modules.exec.cloudflaredChildEnv() })
      this.loginChild = child
      const forward = (chunk: Buffer) => {
        const line = chunk.toString('utf8').trim()
        if (line) this.progress('login', 'info', line)
      }
      child.stdout?.on('data', forward)
      child.stderr?.on('data', forward)
      child.on('error', reject)
      child.on('close', (code) => {
        this.loginChild = undefined
        if (code !== 0 || !existsSync(certPath)) {
          reject(new Error('Cloudflare 登录没有完成，请重试'))
          return
        }
        resolve()
      })
    })
    this.progress('login', 'success', 'Cloudflare 登录完成')
  }

  /**
   * 把旧系统级 ~/.cloudflared/<id>.json 凭据迁移到 managed 目录（migrateLegacyCloudflareState 只搬同账号的），
   * 这样 Cloudflare 上已有同名 Tunnel 时能直接复用，不再要求"删除重建"。
   */
  private async migrateLegacyCredentials(modules: TunnelModules): Promise<void> {
    const legacyDir = dirname(modules.cloudflareAccount.getLegacyCloudflareOriginCertPath())
    let migrated = 0
    try {
      for (const entry of readdirSync(legacyDir)) {
        const id = entry.match(TUNNEL_ID_RE)?.[0]
        if (!id || !entry.endsWith('.json')) continue
        const result = modules.cloudflareAccount.migrateLegacyCloudflareState(id)
        if (result.certMigrated || result.credentialsMigrated) migrated++
      }
    } catch {
      // 旧目录不存在/不可读 → 忽略
    }
    if (migrated > 0) this.progress('tunnel', 'info', `已迁移 ${migrated} 个旧 Tunnel 凭据`)
  }

  /** 按名称找/建 Tunnel；同名缺凭据时需确认后删除重建（凭据在 ~/.cloudflared/<id>.json） */
  private async ensureTunnelCreated(
    modules: TunnelModules,
    bin: string,
    tunnelName: string,
  ): Promise<string> {
    const existing = await this.findTunnelIdByName(modules, bin, tunnelName)
    if (existing && existsSync(modules.yml.getCredentialsPath(existing))) {
      this.progress('tunnel', 'success', `继续使用现有 Tunnel：${tunnelName}`)
      return existing
    }

    if (existing) {
      this.progress('tunnel', 'warning', `Cloudflare 上已有同名 Tunnel“${tunnelName}”，但这台电脑没有它的凭据`)
      await this.confirm(
        `Cloudflare 上已有同名 Tunnel“${tunnelName}”，但这台电脑没有它的凭据。要删除并重新创建吗？这可能影响其它正在使用它的电脑。`,
      )
      await this.deleteTunnel(modules, bin, tunnelName, existing)
    }

    this.progress('tunnel', 'info', `正在创建 Tunnel：${tunnelName}…`)
    const result = await modules.exec.runCloudflared(bin, this.managementArgs(modules, 'create', tunnelName), { allowFailure: true })
    const combined = `${result.stdout}\n${result.stderr}`
    const created = combined.match(TUNNEL_ID_RE)?.[0]
    if (result.code === 0 && created) {
      if (!existsSync(modules.yml.getCredentialsPath(created))) {
        throw new Error('Tunnel 已创建，但这台电脑没有拿到对应凭据，请重试')
      }
      this.progress('tunnel', 'success', 'Tunnel 已创建')
      return created
    }

    const again = await this.findTunnelIdByName(modules, bin, tunnelName)
    if (again && existsSync(modules.yml.getCredentialsPath(again))) {
      this.progress('tunnel', 'success', `使用现有 Tunnel：${tunnelName}`)
      return again
    }
    throw new Error(`创建 Tunnel 失败：${(result.stderr || result.stdout).trim()}`)
  }

  /** 按名称解析 Tunnel UUID（先 JSON 输出，失败退化成文本表格） */
  private async findTunnelIdByName(
    modules: TunnelModules,
    bin: string,
    tunnelName: string,
  ): Promise<string | undefined> {
    const jsonAttempt = await modules.exec.runCloudflared(bin, this.managementArgs(modules, 'list', '--output', 'json'), {
      allowFailure: true,
      timeoutMs: 60_000,
    })
    if (jsonAttempt.code === 0 && jsonAttempt.stdout.trim()) {
      try {
        const rows = JSON.parse(jsonAttempt.stdout) as Array<{ id?: string; name?: string }>
        const hit = rows.find((row) => row.name === tunnelName)
        if (hit?.id) return hit.id
      } catch {
        // 退化成文本表格解析
      }
    }
    const list = await modules.exec.runCloudflared(bin, this.managementArgs(modules, 'list'), {
      allowFailure: true,
      timeoutMs: 60_000,
    })
    const text = `${list.stdout}\n${list.stderr}`
    const exactName = new RegExp(`(?:^|\\s)${escapeRegExp(tunnelName)}(?:\\s|$)`)
    for (const line of text.split(/\r?\n/)) {
      if (!exactName.test(line)) continue
      const id = line.match(TUNNEL_ID_RE)?.[0]
      if (id) return id
    }
    return undefined
  }

  private async deleteTunnel(modules: TunnelModules, bin: string, tunnelName: string, tunnelId: string): Promise<void> {
    const byName = await modules.exec.runCloudflared(bin, this.managementArgs(modules, 'delete', '-f', tunnelName), {
      allowFailure: true,
      timeoutMs: 120_000,
    })
    if (byName.code === 0) return
    const byId = await modules.exec.runCloudflared(bin, this.managementArgs(modules, 'delete', '-f', tunnelId), {
      allowFailure: true,
      timeoutMs: 120_000,
    })
    if (byId.code !== 0) {
      throw new Error(`删除 Tunnel ${tunnelName} (${tunnelId}) 失败：${(byId.stderr || byName.stderr || byId.stdout || byName.stdout).trim()}`)
    }
  }

  /** 域名 DNS 路由；冲突时若已指向本 Tunnel 则跳过，否则需确认后覆盖 */
  private async ensureDnsRoute(
    modules: TunnelModules,
    bin: string,
    tunnelName: string,
    domain: string,
    tunnelId: string,
  ): Promise<void> {
    this.progress('dns', 'info', `正在把域名 ${domain} 连接到 Tunnel…`)
    const create = await modules.exec.runCloudflared(bin, this.managementArgs(modules, 'route', 'dns', tunnelName, domain), {
      allowFailure: true,
      timeoutMs: 120_000,
    })
    if (create.code === 0) {
      this.progress('dns', 'success', '域名连接已配置。启动时会再做一次真实连通检查')
      return
    }
    if (!isDnsRecordConflict(create.stderr, create.stdout)) {
      throw new Error(`配置域名失败：${(create.stderr || create.stdout).trim()}`)
    }
    const pointsHere = await dnsPointsToTunnel(domain, tunnelId)
    if (pointsHere) {
      this.progress('dns', 'success', '这个域名已经连接到当前 Tunnel')
      return
    }
    this.progress('dns', 'warning', `域名 ${domain} 已经有其它 DNS 记录，需要确认是否替换`)
    await this.confirm(`要把 ${domain} 现有的 DNS 记录改成当前 Tunnel 吗？这会改变这个域名现在指向的位置。`)
    const overwrite = await modules.exec.runCloudflared(bin, this.managementArgs(modules, 'route', 'dns', '--overwrite-dns', tunnelName, domain), {
      allowFailure: true,
      timeoutMs: 120_000,
    })
    if (overwrite.code === 0) {
      this.progress('dns', 'success', 'DNS 已更新。启动时会再做一次真实连通检查')
      return
    }
    throw new Error(`更新域名 DNS 失败：${(overwrite.stderr || overwrite.stdout).trim()}`)
  }
}

// ------------------------------------------------------------
// 小工具
// ------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** cloudflared 报告"该主机名 DNS 记录已存在"的错误判定 */
function isDnsRecordConflict(stderr: string, stdout: string): boolean {
  const detail = `${stderr}\n${stdout}`.toLowerCase()
  return (
    detail.includes('already exists') ||
    detail.includes('record with that host already exists') ||
    detail.includes('code: 1003')
  )
}

/** 域名 CNAME 是否已指向 `<tunnelId>.cfargotunnel.com`（Cloudflare 可能扁平化成 A 记录，失败返回 false） */
async function dnsPointsToTunnel(domain: string, tunnelId: string): Promise<boolean> {
  const expected = `${tunnelId}.cfargotunnel.com`.toLowerCase()
  try {
    const names = await resolveCname(domain)
    return names.some((name) => name.toLowerCase().replace(/\.$/, '') === expected)
  } catch {
    return false
  }
}

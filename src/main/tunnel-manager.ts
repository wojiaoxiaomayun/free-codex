/**
 * cloudflared 隧道管理器（app 层能力，独立于网关生命周期）
 *
 * 网关 start/stop 不再拉起/停止隧道（见 mcp-gateway.ts），由本管理器持有 CloudflaredSidecar 常驻。
 * ensure()：先判断公网可达性（用网关的随机探针 verify），可达 → no-op；
 * 不可达/未启动 → 拉起 cloudflared 并再次验证。网关重启不触碰隧道。
 */

const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>

type CloudflaredTunnelLike = {
  start: () => Promise<unknown>
  stop: () => Promise<void>
}

export type TunnelProbe = { path: string; expectedBody: string }

export type TunnelManagerOptions = {
  /** cloudflared 可执行文件路径 */
  bin: string
  /** Cloudflare Named Tunnel ID */
  tunnelId: string
  /** cloudflared.yml 路径（含 service URL，指向网关本地端口） */
  configPath?: string
  /** 公网域名（https://<domain>/mcp） */
  domain: string
  /** 网关探针（网关未运行时返回 null → 只能保证隧道进程在跑，无法校验可达） */
  getProbe: () => TunnelProbe | null
}

type TunnelModules = {
  sidecar: {
    CloudflaredSidecar: new (options: Record<string, unknown>) => CloudflaredTunnelLike
  }
  verify: {
    verifyTunnelRoute: (publicMcpUrl: string, probe: unknown, options?: Record<string, unknown>) => Promise<void>
  }
}

async function loadTunnelModules(): Promise<TunnelModules> {
  const [sidecar, verify] = await Promise.all([
    nativeImport('@meesii/codex-mcp/dist/tunnel/sidecar.js'),
    nativeImport('@meesii/codex-mcp/dist/tunnel/verify.js'),
  ])
  return { sidecar, verify }
}

export class TunnelManager {
  private sidecar?: CloudflaredTunnelLike
  private modules?: TunnelModules
  private busy: Promise<{ ok: boolean; message: string }> | null = null
  /** stop() 后置位：进行中的 ensure 不得再拉起/保留 sidecar */
  private stopped = false

  constructor(private readonly opts: TunnelManagerOptions) {}

  get running(): boolean {
    return !!this.sidecar
  }

  /**
   * 确保公网可达：
   * - 隧道在跑且可达 → no-op
   * - 隧道没跑 → 拉起 cloudflared
   * - 隧道在跑但不可达 → 重启后再次验证
   * 不抛错，返回 { ok, message }。
   */
  async ensure(): Promise<{ ok: boolean; message: string }> {
    if (this.busy) return this.busy
    this.busy = this.runEnsure()
    try {
      return await this.busy
    } finally {
      this.busy = null
    }
  }

  /**
   * 只读可达性检测：用网关探针验证公网可达，不拉起/不重启隧道。
   * 返回 true=可达, false=不可达, null=无探针（网关未运行，无法校验）。
   */
  async checkReachable(): Promise<boolean | null> {
    const probe = this.opts.getProbe()
    if (!probe) return null
    const modules = (this.modules ??= await loadTunnelModules())
    return this.tryVerify(modules, `https://${this.opts.domain}/mcp`, probe)
  }

  private async runEnsure(): Promise<{ ok: boolean; message: string }> {
    // 新一次 ensure 视为实例仍在用：允许 stop() 后重新拉起隧道；
    // stop() 与进行中 ensure 的竞态仍由启动完成后的 stopped 检查拦截
    this.stopped = false
    const modules = (this.modules ??= await loadTunnelModules())
    const probe = this.opts.getProbe()
    const publicUrl = `https://${this.opts.domain}/mcp`

    // 1) 先验可达性（隧道可能由系统服务/其他实例托管，可达就绝不多拉起一个 cloudflared）
    if (probe && (await this.tryVerify(modules, publicUrl, probe))) {
      return { ok: true, message: '公网可达（隧道运行中）' }
    }

    // 2) 不可达 → 停掉自己拉起的（若有）→ 拉起 cloudflared
    if (this.sidecar) {
      console.warn('[tunnel] 公网不可达，重启 cloudflared')
      await this.stopSidecar()
    }
    try {
      this.sidecar = new modules.sidecar.CloudflaredSidecar({
        bin: this.opts.bin,
        tunnelId: this.opts.tunnelId,
        configPath: this.opts.configPath,
        mirrorLogs: false,
      })
      await this.sidecar.start()
      // stop() 与 ensure() 并发：启动完成后若已请求停止，立即回收，不再继续验证/保留
      if (this.stopped) {
        await this.stopSidecar()
        return { ok: false, message: '隧道已停止' }
      }
      console.log('[tunnel] cloudflared 已启动')
    } catch (err) {
      this.sidecar = undefined
      const message = err instanceof Error ? err.message : String(err)
      console.error('[tunnel] cloudflared 启动失败:', message)
      return { ok: false, message: `cloudflared 启动失败: ${message}` }
    }

    // 3) 再验可达性（网关运行中才有探针）
    if (probe) {
      const ok = await this.tryVerify(modules, publicUrl, probe)
      if (ok) return { ok: true, message: '公网已就绪' }
      return { ok: false, message: 'cloudflared 已启动，但公网仍不可达（请检查域名 DNS / Tunnel 配置）' }
    }
    return { ok: true, message: 'cloudflared 已启动（网关未运行，待验证）' }
  }

  private async tryVerify(modules: TunnelModules, publicUrl: string, probe: TunnelProbe): Promise<boolean> {
    try {
      await modules.verify.verifyTunnelRoute(publicUrl, probe, {
        attempts: 3,
        requestTimeoutMs: 5000,
        retryDelayMs: 2000,
      })
      return true
    } catch (err) {
      console.warn('[tunnel] 可达性校验失败:', err instanceof Error ? err.message : String(err))
      return false
    }
  }

  private async stopSidecar(): Promise<void> {
    const s = this.sidecar
    this.sidecar = undefined
    if (s) await s.stop().catch(() => undefined)
  }

  async stop(): Promise<void> {
    this.stopped = true
    await this.stopSidecar()
    this.modules = undefined
  }
}

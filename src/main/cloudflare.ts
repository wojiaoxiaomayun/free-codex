import { spawn, type ChildProcess } from 'node:child_process'
import type { Config } from './config'

/** Legacy compatibility wrapper. The active MCP tunnel is now managed by NodeMcpGateway. */
export class CloudflareTunnel {
  private process?: ChildProcess
  private publicUrl = ''
  constructor(private config: Config) {}
  update(config: Config) { this.config = config }
  get url() { return this.publicUrl }
  async start(): Promise<string> {
    if (this.process) return this.publicUrl
    const c = this.config.cloudflare
    if (!c.hostname) throw new Error('请配置 Cloudflare hostname')
    const args = ['tunnel', '--url', `http://${this.config.gateway.host}:${this.config.gateway.port}`]
    this.process = spawn(c.executable, args, { windowsHide: true })
    this.process.stdout?.on('data', (b) => this.parse(String(b)))
    this.process.stderr?.on('data', (b) => this.parse(String(b)))
    await new Promise(r => setTimeout(r, 1200))
    return this.publicUrl || `https://${c.hostname}/mcp`
  }
  async stop() { this.process?.kill(); this.process = undefined; this.publicUrl = '' }
  private parse(text: string) {
    const m = text.match(/https:\/\/[-\w]+\.trycloudflare\.com/)
    if (m) this.publicUrl = `${m[0]}/mcp`
  }
}

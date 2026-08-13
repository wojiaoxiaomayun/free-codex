/**
 * OAuth 连接密码管理（封装 codex-mcp 的 password-store）
 *
 * codex-mcp 引擎内部将密码哈希持久化到 ~/.codex-mcp/auth.json（无公开注入点），
 * 这里由 free-codex 设置页全权封装操作：查询 / 设置 / 生成随机密码。
 */

const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>

async function loadPasswordStore(): Promise<{
  hasAdminPassword: () => Promise<boolean>
  setAdminPassword: (password: string) => Promise<void>
  generateAdminPassword: () => string
}> {
  return await nativeImport('@meesii/codex-mcp/dist/auth/password-store.js')
}

/** 是否已设置连接密码 */
export async function hasAdminPassword(): Promise<boolean> {
  const store = await loadPasswordStore()
  return await store.hasAdminPassword()
}

/** 设置连接密码（≥12 字符，校验由引擎执行） */
export async function setAdminPassword(password: string): Promise<void> {
  const store = await loadPasswordStore()
  await store.setAdminPassword(password)
}

/** 生成随机连接密码（调用方负责展示给用户） */
export async function generateAdminPassword(): Promise<string> {
  const store = await loadPasswordStore()
  return store.generateAdminPassword()
}

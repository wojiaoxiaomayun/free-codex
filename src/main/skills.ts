import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'

export type SkillScope = 'user' | 'project'
export interface SkillEntry {
  name: string
  description: string
  instructions: string
  scope: SkillScope
  path: string
  enabled: boolean
  invalid?: string
}

const userDir = () => join(app.getPath('home'), '.agents', 'skills')
const projectDir = (root: string | null) => root ? join(root, '.agents', 'skills') : null
const overridesFile = () => join(app.getPath('home'), '.freehub', 'skill-overrides.json')

/** 技能目录约定（用户级 + 项目级），供引擎 SkillRegistry 与 SkillManager 共用 */
export function getSkillDirectories(projectRoot: string | null): { userDir: string; projectDir: string | null } {
  return { userDir: userDir(), projectDir: projectDir(projectRoot) }
}

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}
function parseFrontmatter(raw: string) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!m) return { meta: {} as Record<string, string>, lines: [] as string[], body: raw }
  const meta: Record<string, string> = {}; const lines = m[1].split(/\r?\n/)
  for (const line of lines) {
    const i = line.indexOf(':'); if (i <= 0) continue
    let value = line.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    meta[line.slice(0, i).trim()] = value
  }
  return { meta, lines, body: raw.slice(m[0].length) }
}
function parseSkill(dir: string, scope: SkillScope, disabled: Set<string>): SkillEntry | null {
  const file = join(dir, 'SKILL.md'); if (!existsSync(file)) return null
  try {
    const raw = readFileSync(file, 'utf8'); const { meta, body } = parseFrontmatter(raw)
    const name = normalizeName(meta.name || basename(dir))
    return { name, description: meta.description || '', instructions: body.trimStart(), scope, path: dir, enabled: !disabled.has(name), invalid: meta.name ? undefined : 'SKILL.md 缺少 name（使用目录名作为名称）' }
  } catch { return null }
}
function scan(root: string | null, scope: SkillScope, disabled: Set<string>) {
  if (!root || !existsSync(root)) return [] as SkillEntry[]
  const out: SkillEntry[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const item = parseSkill(join(root, entry.name), scope, disabled); if (item) out.push(item)
  }
  return out
}
function loadDisabled() {
  try { const data = JSON.parse(readFileSync(overridesFile(), 'utf8')); return new Set<string>(Array.isArray(data.disabled) ? data.disabled : []) } catch { return new Set<string>() }
}
function saveDisabled(disabled: Set<string>) {
  const file = overridesFile(); mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ disabled: [...disabled] }, null, 2), 'utf8')
}
function quote(value: string) { return /^[A-Za-z0-9_\-\s.]+$/.test(value) ? value : JSON.stringify(value) }
function render(name: string, description: string, instructions: string) { return `---\nname: ${name}\ndescription: ${quote(description)}\n---\n\n${instructions.trimStart()}\n` }

export class SkillManager {
  constructor(private readonly getProjectRoot: () => string | null) {}
  list() {
    const disabled = loadDisabled(); const { userDir, projectDir } = getSkillDirectories(this.getProjectRoot())
    const users = scan(userDir, 'user', disabled); const projects = scan(projectDir, 'project', disabled)
    const merged = new Map<string, SkillEntry>(); for (const s of users) merged.set(s.name, s); for (const s of projects) merged.set(s.name, s)
    return { skills: [...merged.values()], userDir, projectDir, projectRoot: this.getProjectRoot() }
  }
  setEnabled(names: string[], enabled: boolean) { const disabled = loadDisabled(); for (const name of names) enabled ? disabled.delete(name) : disabled.add(name); saveDisabled(disabled) }
  create(input: { name: string; description: string; instructions: string }, scope: SkillScope) {
    const name = normalizeName(input.name); if (!name) throw new Error('技能名称不能为空')
    const root = scope === 'user' ? userDir() : projectDir(this.getProjectRoot()); if (!root) throw new Error('未激活项目，无法创建项目级技能')
    const dir = join(root, name); if (existsSync(dir)) throw new Error(`技能 "${name}" 已存在`)
    mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'SKILL.md'), render(name, input.description, input.instructions), 'utf8')
  }
  update(name: string, patch: { description?: string; instructions?: string }) {
    const skill = this.list().skills.find(s => s.name === name); if (!skill) throw new Error(`技能 "${name}" 不存在`)
    const file = join(skill.path, 'SKILL.md'); const raw = readFileSync(file, 'utf8'); const { meta } = parseFrontmatter(raw)
    writeFileSync(file, render(name, patch.description ?? meta.description ?? skill.description, patch.instructions ?? skill.instructions), 'utf8')
  }
  delete(name: string) { const skill = this.list().skills.find(s => s.name === name); if (!skill) throw new Error(`技能 "${name}" 不存在`); rmSync(skill.path, { recursive: true, force: true }); const disabled = loadDisabled(); disabled.delete(name); saveDisabled(disabled) }
  read(name: string) { const skill = this.list().skills.find(s => s.name === name); if (!skill) throw new Error(`技能 "${name}" 不存在`); return { ...skill, instructions: readFileSync(join(skill.path, 'SKILL.md'), 'utf8') } }
}

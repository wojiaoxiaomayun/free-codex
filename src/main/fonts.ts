/**
 * 枚举系统已安装字体（终端字体选择器用）
 *
 * 方案：扫描 C:\Windows\Fonts + 用户字体目录 + 注册表指向的自定义目录，
 * 直接解析 TTF/OTF/TTC 的 name 表（Font Family 名），编码安全（UTF-16BE），
 * 不依赖控制台代码页（中文 Windows 上 reg 输出 GBK 会乱码）。
 */

import { app } from 'electron'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

/** UTF-16BE 解码（TTF name 表是 BE 字节序；Node Buffer 只有 utf16le） */
const utf16be = new TextDecoder('utf-16be')

/** 从 TTF/OTF/TTC 二进制解析 Font Family 名（name table, nameID=1） */
function readFontFamilyName(buf: Buffer): string | null {
  if (!buf || buf.length < 4) return null
  const tag = buf.toString('latin1', 0, 4)
  let offset = 0
  if (tag === 'ttcf') {
    // TTC 头：version(4) + numFonts(4) + offset[0]
    if (buf.length < 12) return null
    offset = buf.readUInt32BE(8)
  } else if (tag !== 'OTTO' && !(buf[0] === 0 && buf[1] === 1 && buf[2] === 0 && buf[3] === 0)) {
    return null
  }
  if (offset + 12 > buf.length) return null
  const numTables = buf.readUInt16BE(offset + 4)
  let nameOffset = -1
  for (let i = 0; i < numTables; i++) {
    const rec = offset + 12 + i * 16
    if (rec + 16 > buf.length) break
    if (buf.toString('latin1', rec, rec + 4) === 'name') {
      nameOffset = buf.readUInt32BE(rec + 8)
      break
    }
  }
  if (nameOffset < 0 || nameOffset + 6 > buf.length) return null
  const count = buf.readUInt16BE(nameOffset + 2)
  const stringOffset = nameOffset + buf.readUInt16BE(nameOffset + 4)
  let best: { name: string; score: number } | null = null
  for (let i = 0; i < count; i++) {
    const rec = nameOffset + 6 + i * 12
    if (rec + 12 > buf.length) break
    const platformID = buf.readUInt16BE(rec)
    const encodingID = buf.readUInt16BE(rec + 2)
    const nameID = buf.readUInt16BE(rec + 6)
    const length = buf.readUInt16BE(rec + 8)
    const strOff = stringOffset + buf.readUInt16BE(rec + 10)
    if (nameID !== 1) continue // 1 = Font Family
    if (strOff + length > buf.length) continue
    let text = ''
    if (platformID === 3 || platformID === 0) {
      // Windows / Unicode：UTF-16BE
      try {
        text = utf16be.decode(buf.subarray(strOff, strOff + length)).replace(/^\uFEFF/, '')
      } catch {
        continue
      }
    } else if (platformID === 1) {
      // Mac Roman（近似拉丁）
      text = buf.toString('latin1', strOff, strOff + length)
    } else {
      continue
    }
    if (!text.trim()) continue
    // Windows/UCS-2 的家族名最可信
    const score = platformID === 3 && encodingID === 1 ? 3 : platformID === 3 ? 2 : platformID === 1 ? 2 : 1
    if (!best || score > best.score) best = { name: text, score }
  }
  return best?.name ?? null
}

/** 从字体文件路径解析家族名；解析失败回退文件名 */
function fontNameFromFile(file: string): string | null {
  try {
    const buf = readFileSync(file)
    const name = readFontFamilyName(buf)
    if (name && name.trim()) return name.trim()
  } catch {
    /* 读取失败走文件名兜底 */
  }
  const base = file.replace(/\\/g, '/').split('/').pop() ?? ''
  return base.replace(/\.(ttf|otf|ttc)$/i, '') || null
}

/** 注册表字体项 → 文件路径列表（不依赖名称文本，规避 GBK 乱码） */
function registryFontFiles(): string[] {
  const out: string[] = []
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
  ]
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
  for (const key of keys) {
    try {
      const raw = execFileSync('reg.exe', ['query', key], {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
        timeout: 5000,
      })
      for (const line of raw.split(/\r?\n/)) {
        // 名称(可能乱码)  REG_SZ  路径 —— 只取路径
        const m = line.match(/\s+REG_[A-Z_]+\s+(.+)$/)
        if (!m) continue
        const value = m[1].trim().replace(/^"(.*)"$/, '$1')
        if (/\.(ttf|otf|ttc|fon)$/i.test(value)) out.push(value)
      }
    } catch {
      /* 注册表不可读则忽略 */
    }
  }
  return out
}

/** 优先使用的 Nerd Font 候选（按喜好顺序；与枚举结果精确匹配） */
const NERD_PREFERRED = [
  'CaskaydiaCove Nerd Font',
  'CaskaydiaCove NF',
  'JetBrainsMono Nerd Font',
  'JetBrainsMono NF',
  'MesloLGM Nerd Font',
  'MesloLGM NF',
  'FiraCode Nerd Font',
  'FiraCode NF',
  'Hack Nerd Font',
  'Hack NF',
  'UbuntuMono Nerd Font',
  'SauceCodePro Nerd Font',
  'Cousine Nerd Font',
  'DejaVu Sans Mono Nerd Font',
  'VictorMono Nerd Font',
  'Iosevka Nerd Font',
  'SpaceMono Nerd Font',
  'Mononoki Nerd Font',
  'Terminess Nerd Font',
  'RobotoMono Nerd Font',
  '0xProto Nerd Font',
  'GeistMono Nerd Font',
]

/** 枚举全部已安装字体家族名（去重排序） */
export function listInstalledFonts(): string[] {
  const names = new Set<string>()
  const seen = new Set<string>()

  const addFile = (file: string): void => {
    if (!existsSync(file) || seen.has(file)) return
    seen.add(file)
    const name = fontNameFromFile(file)
    if (name) names.add(name)
  }

  // 标准字体目录
  for (const dir of [
    process.env.windir ? join(process.env.windir, 'Fonts') : 'C:\\Windows\\Fonts',
    join(app.getPath('home'), 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts'),
  ]) {
    let files: string[] = []
    try {
      files = readdirSync(dir)
    } catch {
      continue
    }
    for (const f of files) {
      if (/\.(ttf|otf|ttc)$/i.test(f)) addFile(join(dir, f))
    }
  }

  // 注册表指向的自定义目录（用户手动装的字体可能不在标准目录）
  for (const file of registryFontFiles()) addFile(file)

  return [...names].sort((a, b) => a.localeCompare(b, 'zh'))
}

/**
 * 自动选择终端字体：优先常见 Nerd Font（精确匹配枚举结果），
 * 其次任意名称含 nerd / powerline 的字体，都没有返回 null。
 */
export function pickAutoTerminalFont(fonts: string[]): string | null {
  const set = new Set(fonts)
  for (const name of NERD_PREFERRED) {
    if (set.has(name)) return name
  }
  return fonts.find((f) => /nerd|powerline|for powerline/i.test(f)) ?? null
}
